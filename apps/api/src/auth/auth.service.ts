import { randomUUID } from 'node:crypto';

import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import {
  ACCOUNT_CONFIRM_TTL_DAYS,
  ACCOUNT_EMAIL_LIMIT,
  ACCOUNT_REGISTRATION_MAIL_LIMIT,
  LOGIN_ATTEMPT_LIMIT,
  PASSWORD_RESET_TTL_HOURS,
  SESSION_INACTIVITY_DAYS,
  type AccountConfirmationStatus,
  type CurrentUserResponse,
  type LoginResponse,
  type PasswordResetStatus,
} from '@mon-sinistre/contracts';
import { withAddressLock } from 'src/common/address-lock';
import {
  awaitingConfirmation,
  expiredUnconfirmed,
} from 'src/common/time/confirmation-window';
import { hashEmail } from 'src/common/security/email-hash';
import { runGuarded } from 'src/common/scheduled-cleanup';
import { generateSecureToken, hashSecureToken } from 'src/common/security/secure-token';
import { addDays, addHours, DAY_MS, HOUR_MS } from 'src/common/time/time';
import type { EnvironmentVariables } from 'src/config/env.validation';
import { fr } from 'src/i18n/fr';
import { MailCompositionError } from 'src/mail/mail-composition.error';
import type { ComposeMailInput } from 'src/mail/mail-message';
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
  private readonly logger = new Logger(AuthService.name);
  private readonly saltRounds: number;
  private readonly dummyPasswordHash: string;
  private readonly jwtSecret: string;
  private readonly jwtRefreshSecret: string;
  private readonly emailHashSecret: string;
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
    this.emailHashSecret = config.get('ACCOUNT_EMAIL_HASH_SECRET', {
      infer: true,
    });
  }

  /**
   * Single limit gate and single exit for the feature's three account mails
   * (confirmation, "already have an account", password reset) — one counter
   * shared by every kind, the `AccountFormEmail` row written *before*
   * `send()` so a failed delivery still costs an attempt rather than handing
   * out a free retry, refunded only on `MailCompositionError` — a
   * deterministic bug in the mail itself, not a transport failure. Same
   * shape as veille's `sendFormMail` (`src/veille/veille.service.ts`), *not*
   * extracted into one shared implementation: `src/mail/CLAUDE.md` — "лимит
   * частоты конкретной фичи живёт у фичи, которая его считает" — only the
   * HMAC primitive (`hashEmail`) is common, the counting logic stays with
   * whichever feature owns the table.
   *
   * `limit` is the caller's share of `ACCOUNT_EMAIL_LIMIT`, not a second
   * limit: registration mails stop at `ACCOUNT_REGISTRATION_MAIL_LIMIT` so
   * that five of them — which anybody can trigger for somebody else's
   * address — cannot starve the password-reset mail (the constant's own
   * docblock in contracts). One counter, one daily total.
   *
   * `compose` runs behind the limit check and inside its transaction, so a
   * write made for the mail's own sake (rotating a confirmation token) never
   * commits for a mail that is then suppressed, and returning `null` (the row
   * vanished mid-flight) aborts without costing an attempt. `send()` is the
   * one step left outside: the transport's own delivery budget
   * (`SCALEWAY_TEM_TIMEOUT_MS`, 10 s) outlives Prisma's 5 s
   * interactive-transaction default, so a slow-but-successful send inside
   * would abort the row it announces.
   */
  private async sendAccountMail(
    email: string,
    limit: number,
    compose: (
      tx: Prisma.TransactionClient,
    ) => ComposeMailInput | null | Promise<ComposeMailInput | null>,
  ): Promise<void> {
    const emailHash = hashEmail(email, this.emailHashSecret);
    const charged = await withAddressLock(
      this.prisma,
      emailHash,
      async (tx) => {
        const sentRecently = await tx.accountFormEmail.count({
          where: { emailHash, sentAt: { gte: new Date(Date.now() - DAY_MS) } },
        });
        if (sentRecently >= limit) return null;

        const input = await compose(tx);
        if (!input) return null;

        const row = await tx.accountFormEmail.create({ data: { emailHash } });
        return { id: row.id, input };
      },
    );
    if (!charged) return;

    try {
      await this.mail.send(charged.input);
    } catch (error) {
      if (error instanceof MailCompositionError) {
        await this.prisma.accountFormEmail.delete({
          where: { id: charged.id },
        });
      }
      throw error;
    }
  }

  /**
   * Anti-enumeration (PRD, «Ограничения»): whatever the address turns out to
   * be, this resolves without throwing, same shape as veille's
   * `upsertSubscription` (`src/veille/veille.service.ts`) — nothing → create;
   * unconfirmed → rewrite the password with the last form's and extend the
   * deadline in `claimUnconfirmedAccount`'s single statement, then mail a
   * freshly rotated confirmation link; confirmed → the row is left untouched
   * and mailed the "vous avez déjà un compte" notice instead
   * (`alreadyRegisteredMailFor`, its own doc comment). The branch is decided
   * by `claimUnconfirmedAccount`'s own write, so a row is never rewritten —
   * or resurrected — on the strength of a lookup it has since outlived (the
   * timing gap between the branches is the accepted anti-enumeration
   * channel: `src/auth/CLAUDE.md`, «Anti-enumeration: временная асимметрия
   * по времени ответа»).
   *
   * The confirmation token of the rewritten branch is rotated inside
   * `sendAccountMail`'s `compose`, not by the claim — same rule as veille's
   * `resendConfirmationMail`: only a mail that actually goes out gets to
   * invalidate the link of the mail before it. Rotating in the claim would
   * mean a registration past the limit kills the link of the last mail that
   * did go out and then sends nothing of its own, leaving the person unable
   * to confirm until the 24h window rolls off — six requests, from anybody
   * who knows the address is pending. The deadline is extended either way — a
   * suppressed mail leaves the link from the previous one working, and
   * working for longer, which is the point.
   *
   * The mail goes out after the write, never inside a transaction with it —
   * why: `sendAccountMail`. A delivery failure therefore leaves the account
   * behind with a token nobody holds — a state that heals itself: the retry
   * lands in the rewritten branch, which rotates the token and mails the
   * fresh link. The address already in `User` — the only constraint a
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
      await this.sendAccountMail(
        dto.email,
        ACCOUNT_REGISTRATION_MAIL_LIMIT,
        () => alreadyRegisteredMailFor(dto.email),
      );
      return;
    }
    if (claim === 'rewritten') {
      await this.sendAccountMail(
        dto.email,
        ACCOUNT_REGISTRATION_MAIL_LIMIT,
        async (tx) => {
          const confirm = generateSecureToken();
          const rotated = await tx.user.updateMany({
            where: { email: dto.email, confirmedAt: null },
            data: { confirmTokenHash: confirm.hash },
          });
          // The account was confirmed between the claim and this rotation:
          // the link it holds must keep working, and there is nothing left
          // to confirm anyway.
          if (rotated.count === 0) return null;
          return confirmationMailFor(dto.email, confirm.token);
        },
      );
      return;
    }

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
    // Nothing to rotate here — the token this mails was created with the row
    // and has never been mailed before, so a suppressed mail costs no link.
    await this.sendAccountMail(dto.email, ACCOUNT_REGISTRATION_MAIL_LIMIT, () =>
      confirmationMailFor(dto.email, confirm.token),
    );
  }

  /**
   * Decides `register`'s branch by taking it, same shape as veille's
   * `claimUnconfirmed`: the conditional `updateMany` rewrites the password
   * and the deadline in the same statement that claims the row — one write,
   * so no failure or concurrent confirmation can land between them. The
   * confirmation token is deliberately not part of it (`register`'s
   * docblock): it rotates only for a mail that goes out. The deadline is
   * deliberately not part of the condition either: reviving a row whose
   * window has already lapsed but that the hourly cleanup (phase 4) hasn't
   * swept yet is what this branch exists for. `count === 0` leaves two states
   * worth telling apart, and the read that follows names them: a confirmed
   * row (the caller's write matched nothing to claim), or nothing at all —
   * deleted before the claim, or never created — which `register` treats the
   * same as a brand-new address.
   */
  private async claimUnconfirmedAccount(
    email: string,
    passwordHash: string,
  ): Promise<'confirmed' | 'rewritten' | 'absent'> {
    const claimed = await this.prisma.user.updateMany({
      where: { email, confirmedAt: null },
      data: {
        passwordHash,
        confirmExpiresAt: nextConfirmExpiresAt(),
      },
    });
    if (claimed.count > 0) return 'rewritten';

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { confirmedAt: true },
    });
    return existing?.confirmedAt ? 'confirmed' : 'absent';
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
      await this.prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: reset.hash,
          expiresAt: nextPasswordResetExpiresAt(),
        },
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) return;
      throw error;
    }
    // The full `ACCOUNT_EMAIL_LIMIT`, not the registration share: this is the
    // mail the reserve exists for (contracts, `ACCOUNT_REGISTRATION_MAIL_LIMIT`).
    await this.sendAccountMail(email, ACCOUNT_EMAIL_LIMIT, () =>
      passwordResetMailFor(email, reset.token),
    );
  }

  /**
   * The `findUnique` outside the transaction is not the guard — the
   * conditional `updateMany` (`usedAt: null`, `expiresAt` in the future, in
   * the `where`, not read-then-update) is the one-time-use capture, and a
   * race is settled only by its `count`, no `P2025` in sight. The read
   * exists so the two slow steps stay off the invalid path and out of the
   * transaction: an unknown, spent or expired token costs one indexed
   * lookup — no ~250 ms bcrypt hash — and the hash of the new password runs
   * before the transaction opens, so no pool connection or row lock is held
   * under it. Only a genuine claim reaches the writes. Every other
   * outstanding `PasswordReset` of the account is spent with the claimed
   * one: a link from an earlier mail must not stay able to overwrite the
   * password the person just chose (and revoke their sessions through
   * `endAllSessions`). The account is confirmed if it wasn't yet — spending
   * a token that was mailed to the address proves the mailbox the same way
   * the confirmation link would, and without this the reset would set a
   * password that `validateCredentials` still refuses. The address's
   * `LoginAttempt` counter is cleared with the rest — an owner whose counter
   * an attacker filled must be able to come back through the one route the
   * attacker has no access to. A failure past the claim rolls the claim back too,
   * leaving the token usable for a retry instead of burning it on a 500.
   */
  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<PasswordResetStatus> {
    const tokenHash = hashSecureToken(token);
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash },
      select: { userId: true, usedAt: true, expiresAt: true },
    });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      return 'invalid';
    }

    const passwordHash = await bcrypt.hash(newPassword, this.saltRounds);
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordReset.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gte: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) return 'invalid';

      await tx.passwordReset.updateMany({
        where: { userId: reset.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      const { email } = await tx.user.update({
        where: { id: reset.userId },
        data: { passwordHash },
        select: { email: true },
      });
      await tx.user.updateMany({
        where: { id: reset.userId, confirmedAt: null },
        data: { confirmedAt: new Date() },
      });
      await this.endAllSessions(reset.userId, tx);
      await tx.loginAttempt.deleteMany({
        where: { emailHash: hashEmail(email, this.emailHashSecret) },
      });
      return 'reset';
    });
  }

  /**
   * `null` covers three causes — unknown address, wrong password, unconfirmed
   * account — on purpose: `LocalStrategy` answers all three with the same 401
   * (`src/auth/CLAUDE.md`, anti-enumeration), so telling them apart here would
   * only invite the caller to do it there. Every one of the three writes a
   * `LoginAttempt` row counted toward `LOGIN_ATTEMPT_LIMIT`
   * (`packages/contracts/src/password.ts` has the limit and its source), same
   * shape as `sendAccountMail`'s `AccountFormEmail` gate above.
   *
   * The password is checked before the counter is, and a correct one is let
   * through however many failures precede it — the limit gates *failures*,
   * which is what a brute-force attempt is made of. Checking the counter
   * first would hand an attacker a rolling lockout of any address they know:
   * ten wrong passwords an hour, trivially spread across IPs, and the owner
   * is refused with the right password too. That is the DoS-on-the-victim the
   * research rejected account lockout for (`docs/research/user-account.md`,
   * «Ограничение попыток входа»), only rolling. A success clears the
   * address's counter outright, and so does a completed password reset
   * (`resetPassword`) — the two ways of proving the address is yours.
   *
   * The cost of checking first is one bcrypt (~250 ms) for a caller already
   * over the limit; the per-IP `AUTH_FORM_RATE_LIMIT` is what bounds that,
   * and the compare runs for an unknown address anyway (`dummyPasswordHash`).
   */
  async validateCredentials(
    email: string,
    password: string,
  ): Promise<AuthenticatedUser | null> {
    const emailHash = hashEmail(email, this.emailHashSecret);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const passwordMatches = await bcrypt.compare(
      password,
      user?.passwordHash ?? this.dummyPasswordHash,
    );
    if (!user || !user.confirmedAt || !passwordMatches) {
      await this.chargeFailedLogin(emailHash);
      return null;
    }

    await this.prisma.loginAttempt.deleteMany({ where: { emailHash } });
    return { id: user.id, email: user.email };
  }

  /**
   * Counts one failure and refuses everything past the limit. The count and
   * the insert share one transaction and one address lock (`withAddressLock`,
   * `src/common/address-lock.ts`) — unlocked, a pipelined burst all reads the
   * same pre-limit count and buys itself that many extra guesses. A request
   * already over the limit is not recorded: the window has to be able to roll
   * off while an attacker keeps knocking, or the lockout never ends. The 429
   * is thrown outside the transaction so it cannot be read as a rollback of
   * anything.
   */
  private async chargeFailedLogin(emailHash: string): Promise<void> {
    const overLimit = await withAddressLock(
      this.prisma,
      emailHash,
      async (tx) => {
        const recentFailures = await tx.loginAttempt.count({
          where: {
            emailHash,
            attemptedAt: { gte: new Date(Date.now() - HOUR_MS) },
          },
        });
        if (recentFailures >= LOGIN_ATTEMPT_LIMIT) return true;

        await tx.loginAttempt.create({ data: { emailHash } });
        return false;
      },
    );
    if (overLimit) {
      throw new HttpException(
        fr.auth.login.tooManyAttempts,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
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

  /**
   * Single hourly trigger for all five cleanups of the feature (research,
   * «Чистка: один cron-час, индексы в той же миграции»): the `deleteMany`
   * calls are independent of each other, but the schedule is one. Each runs
   * through `runGuarded` (`src/common/scheduled-cleanup.ts`, shared with
   * veille's `cleanupExpired`) so that the independence holds for failures
   * too — why, its own docblock.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpired(): Promise<void> {
    await runGuarded(this.logger, 'deleteExpiredUnconfirmedUsers', () =>
      this.deleteExpiredUnconfirmedUsers(),
    );
    await runGuarded(this.logger, 'deleteExpiredPasswordResets', () =>
      this.deleteExpiredPasswordResets(),
    );
    await runGuarded(this.logger, 'deleteExpiredRefreshTokens', () =>
      this.deleteExpiredRefreshTokens(),
    );
    await runGuarded(this.logger, 'deleteStaleAccountFormEmailCounters', () =>
      this.deleteStaleAccountFormEmailCounters(),
    );
    await runGuarded(this.logger, 'deleteStaleLoginAttemptCounters', () =>
      this.deleteStaleLoginAttemptCounters(),
    );
  }

  /**
   * The deletion criterion of the confirmation window — `expiredUnconfirmed`,
   * the same shared comparison veille's `deleteExpiredUnconfirmed` uses
   * (`src/common/confirmation-window.ts`) — which the `User` → `RefreshToken`
   * / `PasswordReset` cascade extends to whatever sessions and reset requests
   * the account still held. A row still within its deadline stays, however
   * long its owner takes to open the mail.
   */
  async deleteExpiredUnconfirmedUsers(): Promise<void> {
    await this.prisma.user.deleteMany({ where: expiredUnconfirmed() });
  }

  /** `PasswordReset` rows outlive neither their `expiresAt` nor the `User`
   * they cascade from — this is the former; a spent (`usedAt` set) row still
   * waits out its own deadline like an unspent one, same as `RefreshToken`
   * below never distinguishes revoked from live by age. */
  async deleteExpiredPasswordResets(): Promise<void> {
    await this.prisma.passwordReset.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }

  /** A revoked (`revokedAt` set) row is not deleted early — `refresh`'s reuse
   * detection needs it around for `REFRESH_ROTATION_GRACE_MS` after rotation,
   * and nothing past that reads `revokedAt` again — so this is the only thing
   * that ages `RefreshToken` rows out, on `expiresAt` alone. */
  async deleteExpiredRefreshTokens(): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }

  /** Same shape as veille's `deleteStaleFormEmailCounters`: `AccountFormEmail`
   * rows outlive the `User` they were sent for — no FK ties them together —
   * and age out on their own `sendAccountMail` window, `ACCOUNT_EMAIL_LIMIT`'s
   * `DAY_MS`. */
  async deleteStaleAccountFormEmailCounters(): Promise<void> {
    await this.prisma.accountFormEmail.deleteMany({
      where: { sentAt: { lt: new Date(Date.now() - DAY_MS) } },
    });
  }

  /** Same shape as the account mail counter above, on `validateCredentials`'s
   * own window, `LOGIN_ATTEMPT_LIMIT`'s `HOUR_MS`. */
  async deleteStaleLoginAttemptCounters(): Promise<void> {
    await this.prisma.loginAttempt.deleteMany({
      where: { attemptedAt: { lt: new Date(Date.now() - HOUR_MS) } },
    });
  }
}
