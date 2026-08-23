import { randomUUID } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  ACCOUNT_CONFIRM_TTL_DAYS,
  PASSWORD_RESET_TTL_HOURS,
  SESSION_INACTIVITY_DAYS,
  type AccountConfirmationStatus,
  type CurrentUserResponse,
  type LoginResponse,
  type PasswordResetStatus,
} from '@mon-sinistre/contracts';
import { awaitingConfirmation } from 'src/common/confirmation-window';
import { generateSecureToken, hashSecureToken } from 'src/common/secure-token';
import { addDays, addHours } from 'src/common/time';
import type { EnvironmentVariables } from 'src/config/env.validation';
import { fr } from 'src/i18n/fr';
import { MailService } from 'src/mail/mail.service';
import type { Prisma } from 'src/generated/prisma/client';
import {
  isForeignKeyViolation,
  isUniqueViolationOn,
} from 'src/prisma/prisma-error';
import { PrismaService } from 'src/prisma/prisma.service';
import { alreadyRegisteredMailFor } from './account-already-registered-mail';
import { confirmationMailFor } from './account-confirmation-mail';
import type { RegisterDto } from './dto/register.dto';
import { passwordResetMailFor } from './password-reset-mail';

const nextConfirmExpiresAt = (): Date => addDays(ACCOUNT_CONFIRM_TTL_DAYS);
const nextPasswordResetExpiresAt = (): Date =>
  addHours(PASSWORD_RESET_TTL_HOURS);

/**
 * `typ` claim: the two token kinds share a signer and a payload shape, and
 * `JwtStrategy` must be able to refuse a refresh token presented as a bearer
 * even if the two secrets were ever the same (`env.validation.ts` refuses
 * that too — this is the second lock, not the first).
 */
export const TOKEN_TYPE = { access: 'access', refresh: 'refresh' } as const;
export type TokenType = (typeof TOKEN_TYPE)[keyof typeof TOKEN_TYPE];

export interface TokenPayload {
  sub: string;
  typ: TokenType;
}

/**
 * How long after a rotation the rotated-out token is still honoured. Two
 * tabs whose access tokens expire together both refresh with the same
 * cookie within milliseconds; a client retrying a request the network
 * dropped presents the same cookie again seconds later. Neither is theft,
 * and treating them as theft (`refresh` below) logs the person out of every
 * device. Within this window a second presentation gets its own fresh pair;
 * after it, it kills the chain. Exported for the spec, not for tuning.
 */
export const REFRESH_ROTATION_GRACE_MS = 10_000;

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
  private readonly refreshTokenExpiry: JwtSignOptions['expiresIn'] = `${SESSION_INACTIVITY_DAYS}d`;

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
  }

  /**
   * Anti-enumeration (PRD, «Ограничения»): whatever the address turns out to
   * be, this resolves without throwing, same shape as veille's
   * `upsertSubscription` (`src/veille/veille.service.ts`) — nothing → create;
   * unconfirmed → rewrite the password with the last form's, extend the
   * deadline and resend the confirmation mail with a rotated token; confirmed
   * → the row is left untouched and mailed the "vous avez déjà un compte"
   * notice instead (`alreadyRegisteredMailFor`, its own doc comment). The
   * branch is decided by `claimUnconfirmedAccount`'s own write, so a row is
   * never rewritten — or resurrected — on the strength of a lookup it has
   * since outlived (the timing gap between the branches is the accepted
   * anti-enumeration channel: `src/auth/CLAUDE.md`, «Anti-enumeration:
   * временная асимметрия по времени ответа»).
   *
   * For a brand-new address, the row and the mail are one transaction: a
   * delivery failure rolls the account back, so the retry the caller makes
   * once mail is up again registers normally instead of hitting the
   * duplicate branch — 204 and no link, for an address whose only token is
   * unreachable. The address already in `User` — the only constraint a
   * caller-supplied value can violate here, the token hash being 256 random
   * bits apart (`isUniqueViolationOn`, not the global Prisma mapping: a 409
   * here would tell a caller the address is already registered) — this
   * create can still meet is one lost race against a concurrent submission
   * for the same brand-new address; that caller keeps its 204 and gets no
   * mail, the same acceptance as before this issue.
   */
  async register(dto: RegisterDto): Promise<void> {
    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);
    const claim = await this.claimUnconfirmedAccount(dto.email, passwordHash);
    if (claim === 'confirmed') {
      await this.mail.send(alreadyRegisteredMailFor(dto.email));
      return;
    }
    if (claim === 'rewritten') {
      await this.resendConfirmationMail(dto.email);
      return;
    }

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
   * Decides `register`'s branch by taking it, same shape as veille's
   * `claimUnconfirmed`: the conditional `updateMany` rewrites the password
   * and extends the deadline in the same statement that claims the row, so a
   * concurrent confirmation and this call can't land in the wrong order —
   * whichever commits first is what the other sees. The deadline is
   * deliberately not part of the condition: reviving a row whose window has
   * already lapsed but that the hourly cleanup (phase 4) hasn't swept yet is
   * what this branch exists for. `count === 0` leaves two states worth
   * telling apart, and the read that follows names them: a confirmed row (the
   * caller's write matched nothing to claim), or nothing at all — deleted
   * before the claim, or never created — which `register` treats the same as
   * a brand-new address.
   */
  private async claimUnconfirmedAccount(
    email: string,
    passwordHash: string,
  ): Promise<'confirmed' | 'rewritten' | 'absent'> {
    const claimed = await this.prisma.user.updateMany({
      where: { email, confirmedAt: null },
      data: { passwordHash, confirmExpiresAt: nextConfirmExpiresAt() },
    });
    if (claimed.count > 0) return 'rewritten';

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { confirmedAt: true },
    });
    return existing?.confirmedAt ? 'confirmed' : 'absent';
  }

  /**
   * Only reached once `claimUnconfirmedAccount` has already rewritten the
   * password and the deadline — this rotates the confirmation token and
   * mails it, same gating as veille's `resendConfirmationMail`: the rotation
   * is conditioned on `confirmedAt: null` again, so a confirmation landing in
   * the gap between the claim above and this call keeps the link it was
   * already mailed working instead of this silently invalidating it with a
   * resend nobody asked for.
   */
  private async resendConfirmationMail(email: string): Promise<void> {
    const confirm = generateSecureToken();
    const rotated = await this.prisma.user.updateMany({
      where: { email, confirmedAt: null },
      data: { confirmTokenHash: confirm.hash },
    });
    if (rotated.count === 0) return;
    await this.mail.send(confirmationMailFor(email, confirm.token));
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

  /** Anti-enumeration (PRD, «Ограничения») — behaviour, the `P2003` race and
   * the accepted timing gap are all `src/auth/CLAUDE.md`. */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) return;

    const reset = generateSecureToken();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.passwordReset.create({
          data: {
            userId: user.id,
            tokenHash: reset.hash,
            expiresAt: nextPasswordResetExpiresAt(),
          },
        });
        await this.mail.send(passwordResetMailFor(email, reset.token));
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) return;
      throw error;
    }
  }

  /**
   * Atomic claim, same shape as `VeilleService.applyChange`: a `findUnique`
   * gets `userId` for the write that follows, then a conditional
   * `updateMany` (`usedAt: null`, `expiresAt` in the future, in the `where`,
   * not read-then-update) is the actual one-time-use capture — a repeat
   * submission of the same token, an expired one and an unknown one all
   * resolve through that single `count`, no `P2025` in sight. Only a
   * genuine claim reaches the password write and `endAllSessions`, so a
   * losing race never touches either. The new password is hashed only after
   * the claim succeeds — an invalid token costs one indexed lookup, not a
   * ~250 ms bcrypt hash. Runs in one transaction: a failure past the claim
   * (hash, write, revoke) rolls the claim back too, leaving the token usable
   * for a retry instead of burning it on a 500.
   */
  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<PasswordResetStatus> {
    const tokenHash = hashSecureToken(token);
    return this.prisma.$transaction(async (tx) => {
      const reset = await tx.passwordReset.findUnique({
        where: { tokenHash },
        select: { userId: true },
      });
      if (!reset) return 'invalid';

      const claimed = await tx.passwordReset.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gte: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) return 'invalid';

      const passwordHash = await bcrypt.hash(newPassword, this.saltRounds);
      await tx.user.update({
        where: { id: reset.userId },
        data: { passwordHash },
      });
      await this.endAllSessions(reset.userId, tx);
      return 'reset';
    });
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
   * not recomputed from `SESSION_INACTIVITY_DAYS` a second time — the row can
   * never disagree with the token it stores the hash of. The `jti` is what
   * keeps two logins (or refreshes) of one user within the same second from
   * signing the identical token: `iat`/`exp` have second resolution, and
   * `RefreshToken.tokenHash` is unique. Shared by `login` and `refresh` —
   * the only two places that ever mint a fresh pair; `refresh` hands in its
   * transaction so the revoke of the old row and the insert of the new one
   * commit together.
   *
   * `P2003` on the insert means the account was deleted between the caller's
   * read and this write (`DELETE /auth/me` racing a refresh) — for the caller
   * that is a session that no longer exists, the same 401 as any other.
   */
  private async issueTokens(
    userId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<LoginResult> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, typ: TOKEN_TYPE.access } satisfies TokenPayload,
      { secret: this.jwtSecret, expiresIn: this.accessTokenExpiry },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, typ: TOKEN_TYPE.refresh } satisfies TokenPayload,
      {
        secret: this.jwtRefreshSecret,
        expiresIn: this.refreshTokenExpiry,
        jwtid: randomUUID(),
      },
    );
    const { exp } = this.jwt.decode<{ exp: number }>(refreshToken);
    const expiresAt = new Date(exp * 1000);

    try {
      await db.refreshToken.create({
        data: {
          userId,
          tokenHash: hashSecureToken(refreshToken),
          expiresAt,
        },
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new UnauthorizedException(fr.auth.session.expired);
      }
      throw error;
    }

    return {
      access: { accessToken },
      refresh: { token: refreshToken, expiresAt },
    };
  }

  async login(userId: string): Promise<LoginResult> {
    return this.issueTokens(userId);
  }

  /**
   * Rotation is one transaction: the conditional `updateMany` (`revokedAt:
   * null` in `where`, not read-then-update) and the insert of the
   * replacement. Two concurrent presentations of the same token race for
   * that `count` in the database and at most one wins; the loser's
   * `updateMany` waits on the winner's row lock, so by the time it reads
   * zero the winner's replacement row is committed and visible — the
   * reuse branch below can never miss it. A failed insert rolls the revoke
   * back: the presented token stays valid rather than the session vanishing.
   *
   * `revokedAt` is set by rotation and by nothing else — `logout` and the
   * reuse sweep delete rows outright (`src/auth/CLAUDE.md`). That is what
   * lets the loser's branch tell a harmless second presentation (two tabs, a
   * retry: revoked seconds ago, `REFRESH_ROTATION_GRACE_MS`) from a replay of
   * a token that had been rotated out long before, which is the signal of
   * theft and kills the whole chain.
   */
  async refresh(token: string): Promise<LoginResult> {
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token, {
        secret: this.jwtRefreshSecret,
      });
    } catch {
      throw new UnauthorizedException(fr.auth.session.expired);
    }
    if (payload.typ !== TOKEN_TYPE.refresh) {
      throw new UnauthorizedException(fr.auth.session.expired);
    }

    const tokenHash = hashSecureToken(token);
    const rotated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return count === 0 ? null : this.issueTokens(payload.sub, tx);
    });
    if (rotated) return rotated;

    const reused = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true, revokedAt: true },
    });
    if (!reused) {
      throw new UnauthorizedException(fr.auth.session.expired);
    }
    const sinceRotation = Date.now() - (reused.revokedAt?.getTime() ?? 0);
    if (sinceRotation < REFRESH_ROTATION_GRACE_MS) {
      return this.issueTokens(reused.userId);
    }
    await this.endAllSessions(reused.userId);
    throw new UnauthorizedException(fr.auth.session.expired);
  }

  /**
   * Deletes every still-live `RefreshToken` of a user — same invariant as
   * `logout` (`revokedAt` is set only by rotation, everything else that ends
   * a token deletes the row). Shared by the reuse-detected branch of
   * `refresh` above and by `resetPassword` below, the two places a whole
   * account's sessions end at once outside `deleteAccount` (which needs no
   * separate call — the cascade takes the rows with it).
   */
  private endAllSessions(
    userId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    return db.refreshToken.deleteMany({
      where: { userId, revokedAt: null },
    });
  }

  /**
   * Deletes the row rather than marking it revoked — why: `refresh` above.
   * Idempotent by construction: a token hash that is unknown, already
   * rotated out or already logged out matches zero rows, and repeat logout
   * is not an error. Only the presented token goes, not the whole chain —
   * unlike refresh's reuse case, presenting a token at `/auth/logout` is not
   * itself a signal of theft, and neither is its later replay at
   * `/auth/refresh`: with the row gone, that replay is an unknown token.
   */
  async logout(token: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { tokenHash: hashSecureToken(token) },
    });
  }

  /** `findUniqueOrThrow` over a manual null check — why: `src/auth/CLAUDE.md`. */
  async currentUser(userId: string): Promise<CurrentUserResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    return { email: user.email };
  }

  /** Why this is the whole operation — `src/auth/CLAUDE.md`. */
  async deleteAccount(userId: string): Promise<void> {
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
