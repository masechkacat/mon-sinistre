import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  ACCOUNT_CONFIRM_TTL_DAYS,
  type AccountConfirmationStatus,
  type LoginResponse,
} from '@mon-sinistre/contracts';
import { generateSecureToken, hashSecureToken } from 'src/common/secure-token';
import { addDays } from 'src/common/time';
import type { EnvironmentVariables } from 'src/config/env.validation';
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
 * measurably faster than an existing one.
 */
@Injectable()
export class AuthService {
  private readonly saltRounds: number;
  private readonly dummyPasswordHash: string;
  private readonly jwtSecret: string;
  private readonly jwtRefreshSecret: string;
  /**
   * `ACCESS_TOKEN_EXPIRY`/`REFRESH_TOKEN_EXPIRY` are validated as plain
   * strings (`env.validation.ts` has no reason to depend on `ms`'s type); the
   * cast to `ms`'s branded `StringValue` happens once here, not at every
   * `sign` call below.
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
    this.dummyPasswordHash = bcrypt.hashSync(
      'no-account-uses-this-password',
      this.saltRounds,
    );
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
   * either way. Response *timing* still differs between the two branches
   * (the new-address branch additionally awaits `mail.send()`) until phase 3
   * gives the duplicate branch mail of its own to send — CLAUDE.md, «Anti-
   * enumeration: временная асимметрия по времени ответа».
   */
  async register(dto: RegisterDto): Promise<void> {
    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);
    const confirm = generateSecureToken();

    try {
      await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          confirmTokenHash: confirm.hash,
          confirmExpiresAt: nextConfirmExpiresAt(),
        },
      });
    } catch (error) {
      if (isUniqueViolationOn(error, 'email')) return;
      throw error;
    }

    // Sent after the row is written: a delivery failure must not undo an
    // account the caller will otherwise never see again.
    await this.mail.send(confirmationMailFor(dto.email, confirm.token));
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
      where: {
        confirmTokenHash: tokenHash,
        confirmedAt: null,
        confirmExpiresAt: { gte: new Date() },
      },
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
   * never disagree with the token it stores the hash of.
   */
  async login(userId: string): Promise<LoginResult> {
    const payload = { sub: userId };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.jwtSecret,
      expiresIn: this.accessTokenExpiry,
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.jwtRefreshSecret,
      expiresIn: this.refreshTokenExpiry,
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
}
