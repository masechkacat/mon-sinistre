import { randomUUID } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  ACCOUNT_CONFIRM_TTL_DAYS,
  type AccountConfirmationStatus,
  type LoginResponse,
} from '@mon-sinistre/contracts';
import { awaitingConfirmation } from 'src/common/confirmation-window';
import { generateSecureToken, hashSecureToken } from 'src/common/secure-token';
import { addDays } from 'src/common/time';
import type { EnvironmentVariables } from 'src/config/env.validation';
import { fr } from 'src/i18n/fr';
import { MailService } from 'src/mail/mail.service';
import { isUniqueViolationOn } from 'src/prisma/prisma-error';
import { PrismaService } from 'src/prisma/prisma.service';
import { confirmationMailFor } from './account-confirmation-mail';
import type { RegisterDto } from './dto/register.dto';

const nextConfirmExpiresAt = (): Date => addDays(ACCOUNT_CONFIRM_TTL_DAYS);

/** What `LocalStrategy` attaches to the request as `req.user`. */
export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface RefreshTokenIssued {
  token: string;
  expiresAt: Date;
}

export interface LoginResult {
  access: LoginResponse;
  refresh: RefreshTokenIssued;
}

/**
 * Never a real account's hash — `bcrypt.compare` against it always fails, and
 * runs anyway so an unknown address costs the same wall-clock time as a wrong
 * password (`src/auth/CLAUDE.md`, anti-enumeration): skipping the compare
 * entirely for a missing row would make a nonexistent address answer
 * measurably faster than an existing one. The salt and digest are fixed
 * bytes; only the cost prefix follows `SALT_ROUNDS`, which is what sets the
 * compare's duration — hashing one at bootstrap would block the event loop
 * for the same ~250 ms on every start and in every integration spec.
 */
const dummyPasswordHashFor = (saltRounds: number): string =>
  `$2b$${String(saltRounds).padStart(2, '0')}$Sl5dUvnMCS0DyTZ0ed19W.cKAQkPrP5TbTPsYIqXEfP63Ahn8RLsu`;

@Injectable()
export class AuthService {
  private readonly saltRounds: number;
  private readonly dummyPasswordHash: string;
  private readonly jwtSecret: string;
  private readonly jwtRefreshSecret: string;
  /**
   * `env.validation.ts` guarantees the `ms` shape without depending on `ms`'s
   * type; the cast to its branded `StringValue` happens once here, not at
   * every `sign` call below.
   */
  private readonly accessTokenExpiry: JwtSignOptions['expiresIn'];
  private readonly refreshTokenExpiry: JwtSignOptions['expiresIn'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.saltRounds = config.get('SALT_ROUNDS', { infer: true });
    this.dummyPasswordHash = dummyPasswordHashFor(this.saltRounds);
    this.jwtSecret = config.get('JWT_SECRET', { infer: true });
    this.jwtRefreshSecret = config.get('JWT_REFRESH_SECRET', { infer: true });
    this.accessTokenExpiry = config.get('ACCESS_TOKEN_EXPIRY', {
      infer: true,
    });
    this.refreshTokenExpiry = config.get('REFRESH_TOKEN_EXPIRY', {
      infer: true,
    });
  }

  /**
   * Anti-enumeration (PRD, «Ограничения»): whatever the address turns out to
   * be, this resolves without throwing. An address already in `User` — the
   * only constraint a caller-supplied value can violate here, the token hash
   * being 256 random bits apart (`isUniqueViolationOn`, not the global Prisma
   * mapping: a 409 here would tell a caller the address is already
   * registered) — is left untouched: rewriting an unconfirmed account's
   * password and re-mailing it, or mailing a confirmed one its "vous avez
   * déjà un compte" link, is docs/plan/user-account.md phase 3. This issue
   * only guarantees the row stays unique and the caller never sees an error
   * either way (the timing gap between the branches: `src/auth/CLAUDE.md`,
   * «Anti-enumeration: временная асимметрия по времени ответа»).
   *
   * The row and the mail are one transaction, as in veille's
   * `upsertChangeRequest`: a delivery failure rolls the account back, so the
   * retry the caller makes once mail is up again registers normally instead
   * of hitting the duplicate branch — 204 and no link, for an address whose
   * only token is unreachable until phase 3 adds the re-send.
   */
  async register(dto: RegisterDto): Promise<void> {
    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);
    const confirm = generateSecureToken();

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            email: dto.email,
            passwordHash,
            confirmTokenHash: confirm.hash,
            confirmExpiresAt: nextConfirmExpiresAt(),
          },
        });
        await this.mail.send(confirmationMailFor(dto.email, confirm.token));
      });
    } catch (error) {
      if (isUniqueViolationOn(error, 'email')) return;
      throw error;
    }
  }

  /**
   * One conditional `updateMany`, not read-then-update — same reason as
   * veille's `VeilleService.confirm`: a concurrent call with the same token
   * must answer "confirmed" too, not throw `P2025` the way a plain `update`
   * would once the first call already won the race. `confirmTokenHash` is
   * never cleared on activation, so a repeat call still finds the row and
   * answers "confirmed" regardless of `confirmExpiresAt` — an already-active
   * account never expires back to "invalid".
   */
  async confirm(token: string): Promise<AccountConfirmationStatus> {
    const tokenHash = hashSecureToken(token);
    const activated = await this.prisma.user.updateMany({
      where: { confirmTokenHash: tokenHash, ...awaitingConfirmation() },
      data: { confirmedAt: new Date() },
    });
    if (activated.count > 0) return 'confirmed';

    const user = await this.prisma.user.findUnique({
      where: { confirmTokenHash: tokenHash },
      select: { confirmedAt: true },
    });
    return user?.confirmedAt ? 'confirmed' : 'invalid';
  }

  /**
   * `null` covers three causes — unknown address, wrong password, unconfirmed
   * account — on purpose: `LocalStrategy` answers all three with the same 401
   * (`src/auth/CLAUDE.md`, anti-enumeration), so telling them apart here would
   * only invite the caller to do it there.
   */
  async validateCredentials(
    email: string,
    password: string,
  ): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const passwordMatches = await bcrypt.compare(
      password,
      user?.passwordHash ?? this.dummyPasswordHash,
    );
    if (!user || !user.confirmedAt || !passwordMatches) return null;
    return { id: user.id, email: user.email };
  }

  /**
   * Issues both tokens and records the refresh one. `expiresAt` of the
   * `RefreshToken` row is read off the freshly signed JWT's own `exp` claim,
   * not recomputed from `REFRESH_TOKEN_EXPIRY` a second time — the row can
   * never disagree with the token it stores the hash of. The `jti` is what
   * keeps two logins (or refreshes) of one user within the same second from
   * signing the identical token: `iat`/`exp` have second resolution, and
   * `RefreshToken.tokenHash` is unique. Shared by `login` and `refresh` —
   * the only two places that ever mint a fresh pair.
   */
  private async issueTokens(userId: string): Promise<LoginResult> {
    const payload = { sub: userId };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.jwtSecret,
      expiresIn: this.accessTokenExpiry,
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.jwtRefreshSecret,
      expiresIn: this.refreshTokenExpiry,
      jwtid: randomUUID(),
    });
    const { exp } = this.jwt.decode<{ exp: number }>(refreshToken);
    const expiresAt = new Date(exp * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashSecureToken(refreshToken),
        expiresAt,
      },
    });

    return {
      access: { accessToken },
      refresh: { token: refreshToken, expiresAt },
    };
  }

  async login(userId: string): Promise<LoginResult> {
    return this.issueTokens(userId);
  }

  /**
   * The revoke is the conditional `updateMany` itself, not read-then-update:
   * it can only ever revoke a row that is still `revokedAt: null`, so two
   * concurrent presentations of the same token race for that `count`, and at
   * most one wins — the loser falls into the reuse branch below exactly like
   * an attacker replaying an already-rotated token would (`src/auth/CLAUDE.md`).
   */
  async refresh(token: string): Promise<LoginResult> {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: this.jwtRefreshSecret,
      });
    } catch {
      throw new UnauthorizedException(fr.auth.session.expired);
    }

    const tokenHash = hashSecureToken(token);
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (rotated.count === 0) {
      const reused = await this.prisma.refreshToken.findUnique({
        where: { tokenHash },
      });
      if (reused) {
        await this.prisma.refreshToken.updateMany({
          where: { userId: reused.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException(fr.auth.session.expired);
    }

    return this.issueTokens(payload.sub);
  }

  /**
   * Idempotent by construction, not by checking the result: revoking a token
   * hash that is unknown or already revoked simply matches zero rows in the
   * conditional `updateMany` (`revokedAt: null` in `where`) — repeat logout,
   * or logout after the session already died some other way, is not an
   * error. Only the one presented token is revoked, not the whole chain —
   * unlike refresh's reuse case, presenting a token at `/auth/logout` is not
   * itself a signal of theft.
   */
  async logout(token: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashSecureToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
