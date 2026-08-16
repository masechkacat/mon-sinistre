import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  VEILLE_CONFIRM_TTL_DAYS,
  VEILLE_FORM_EMAIL_DAILY_LIMIT,
  type VeilleConfirmationStatus,
} from '@mon-sinistre/contracts';
import { errorSummary, stackOf } from 'src/common/error-report';
import type { EnvironmentVariables } from 'src/config/env.validation';
import { MailCompositionError } from 'src/mail/mail-composition.error';
import type { ComposeMailInput } from 'src/mail/mail-message';
import { MailService } from 'src/mail/mail.service';
import { isUniqueViolationOn } from 'src/prisma/prisma-error';
import { PrismaService } from 'src/prisma/prisma.service';
import type { CreateVeilleDto } from './dto/create-veille.dto';
import { alreadySubscribedMailFor } from './veille-already-subscribed-mail';
import {
  confirmationMailFor,
  type ChosenCommune,
} from './veille-confirmation-mail';
import { hashVeilleFormEmail } from './veille-email-hash';
import { generateVeilleToken, hashVeilleToken } from './veille-token';

/** Both exported for the veille specs, so none of them keeps its own copy. */
export const DAY_MS = 24 * 60 * 60 * 1000;

export const nextConfirmExpiresAt = (): Date =>
  new Date(Date.now() + VEILLE_CONFIRM_TTL_DAYS * DAY_MS);

/**
 * The one comparison of the confirmation deadline with "now", in the two
 * languages that ask for it: `isStillOpen` for a row already read,
 * `awaitingConfirmation` for the write that confirms one. `expiredUnconfirmed`
 * is its exact complement — the deletion criterion of the hourly cleanup — and
 * spells the comparison out instead of negating the fragment above:
 * `NOT (… >= now)` is not an indexable clause, and that delete runs through a
 * partial index.
 */
const isStillOpen = (confirmExpiresAt: Date): boolean =>
  confirmExpiresAt >= new Date();

const awaitingConfirmation = () => ({
  confirmedAt: null,
  confirmExpiresAt: { gte: new Date() },
});

const expiredUnconfirmed = () => ({
  confirmedAt: null,
  confirmExpiresAt: { lt: new Date() },
});

/**
 * Single source of the pending/active/invalid decision — `GET` reads it
 * directly, `POST` falls back to it when its conditional write matched no
 * row, so the two never disagree on the same token.
 */
const classifyConfirmation = (
  veille: { confirmedAt: Date | null; confirmExpiresAt: Date } | null,
): VeilleConfirmationStatus => {
  if (!veille) return 'invalid';
  if (veille.confirmedAt) return 'active';
  return isStillOpen(veille.confirmExpiresAt) ? 'pending' : 'invalid';
};

/** What `claimUnconfirmed` found, and the row it claimed if it claimed one. */
type Claim =
  { kind: 'rewritten'; veilleId: string } | { kind: 'confirmed' | 'absent' };

@Injectable()
export class VeilleService {
  private readonly logger = new Logger(VeilleService.name);
  private readonly emailHashSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.emailHashSecret = config.get('VEILLE_EMAIL_HASH_SECRET', {
      infer: true,
    });
  }

  async subscribe(dto: CreateVeilleDto): Promise<void> {
    const communeCodes = [...new Set(dto.communeCodes)];
    const communes = await this.prisma.commune.findMany({
      where: { codeInsee: { in: communeCodes }, effectiveTo: null },
      select: { codeInsee: true, name: true, departementName: true },
    });
    // Checked against the deduplicated count: a code repeated in the form
    // must not read as an unknown one.
    if (communes.length !== communeCodes.length) {
      throw new BadRequestException('Unknown commune code');
    }
    await this.upsertSubscription(dto.email, communeCodes, communes);
  }

  /**
   * Branches on what the address holds at the moment of the write (docs/
   * research, «Сценарии формы и гонка уникальности» с врезкой фазы 4): nothing
   * → create; unconfirmed → rewrite its communes, extend the deadline and
   * resend the confirmation mail with rotated tokens; confirmed → row
   * untouched, only a "déjà inscrit·e" reminder mail goes out with the communes
   * it actually has, ignoring whatever this new form submitted. The branch is
   * decided by the write that takes it (`claimUnconfirmed`), so no row is ever
   * rewritten — or resurrected — on the strength of a lookup it has since
   * outlived. The one race left is a concurrent create hitting the unique
   * index: retried once (`isRetry`), so that the loser lands in the branch that
   * is true after the race instead of answering 204 with nothing written.
   */
  private async upsertSubscription(
    email: string,
    communeCodes: string[],
    communes: readonly ChosenCommune[],
    isRetry = false,
  ): Promise<void> {
    const claim = await this.claimUnconfirmed(email, communeCodes);
    if (claim.kind === 'confirmed') {
      await this.sendAlreadySubscribedMail(email);
      return;
    }
    if (claim.kind === 'rewritten') {
      await this.resendConfirmationMail(claim.veilleId, email, communes);
      return;
    }

    const confirm = generateVeilleToken();
    const unsubscribe = generateVeilleToken();

    try {
      // A nested create is one transaction on its own — the subscription and
      // its communes appear together or not at all.
      await this.prisma.veille.create({
        data: {
          email,
          confirmTokenHash: confirm.hash,
          unsubscribeTokenHash: unsubscribe.hash,
          confirmExpiresAt: nextConfirmExpiresAt(),
          communes: {
            create: communeCodes.map((codeInsee) => ({ codeInsee })),
          },
        },
      });
    } catch (error) {
      // The only constraint a caller-supplied value can violate here (the token
      // hashes are 256 random bits apart). Left untranslated by the global
      // Prisma mapping on purpose (`src/prisma/prisma-error.ts`): a 409 on this
      // endpoint would tell an attacker the address is already registered.
      if (isUniqueViolationOn(error, 'email')) {
        if (!isRetry) {
          return this.upsertSubscription(email, communeCodes, communes, true);
        }
        // Losing the race twice (deleted then re-created between the claim and
        // this create, twice over) proves the address exists right now — a 500
        // here would be the same timing-dependent enumeration signal the
        // untranslated P2002 avoids. The caller keeps its 204 and gets no mail,
        // so this line is the only trace that a submission was dropped; the
        // address itself stays out of it.
        this.logger.warn('Subscription form lost the unique-index race twice');
        return;
      }
      throw error;
    }

    // Sent after the row is written: a delivery failure must not undo a
    // subscription the caller will otherwise never see again.
    await this.sendFormMail(email, () =>
      confirmationMailFor(email, communes, confirm.token, unsubscribe.token),
    );
  }

  /**
   * Decides the unconfirmed branch by taking it: the conditional `updateMany`
   * matches the row and locks it in the same statement, so a concurrent
   * desinscription and the hourly cleanup both queue behind this transaction
   * instead of deleting a row already being rewritten — and the cleanup, once
   * let through, re-reads the deadline this extended and leaves the row alone.
   * The deadline is deliberately not part of the condition: reviving an expired
   * row that is still there is what this branch exists for.
   *
   * `count === 0` leaves two states worth telling apart, and the read that
   * follows names them: a confirmed row, or nothing this submission may act on
   * — deleted before the claim, or created unconfirmed right after it, in which
   * case the caller's create meets the unique index and retries into here.
   */
  private async claimUnconfirmed(
    email: string,
    communeCodes: string[],
  ): Promise<Claim> {
    return this.prisma.$transaction(async (tx): Promise<Claim> => {
      const claimed = await tx.veille.updateMany({
        where: { email, confirmedAt: null },
        data: { confirmExpiresAt: nextConfirmExpiresAt() },
      });
      if (claimed.count === 0) {
        const existing = await tx.veille.findUnique({
          where: { email },
          select: { confirmedAt: true },
        });
        return { kind: existing?.confirmedAt ? 'confirmed' : 'absent' };
      }

      const { id } = await tx.veille.findUniqueOrThrow({
        where: { email },
        select: { id: true },
      });
      await tx.veilleCommune.deleteMany({ where: { veilleId: id } });
      await tx.veilleCommune.createMany({
        data: communeCodes.map((codeInsee) => ({ veilleId: id, codeInsee })),
      });
      return { kind: 'rewritten', veilleId: id };
    });
  }

  /**
   * Why a resent mail rotates hashes and mails fresh tokens, and why only
   * inside the limit gate — research, врезка «Исправлено при реализации».
   * Local to this method: both hashes rotate, conditioned on
   * `confirmedAt: null` so a concurrent confirmation keeps its delivered
   * links working.
   */
  private async resendConfirmationMail(
    veilleId: string,
    email: string,
    communes: readonly ChosenCommune[],
  ): Promise<void> {
    await this.sendFormMail(email, async () => {
      const confirm = generateVeilleToken();
      const unsubscribe = generateVeilleToken();
      const rotated = await this.prisma.veille.updateMany({
        where: { id: veilleId, confirmedAt: null },
        data: {
          confirmTokenHash: confirm.hash,
          unsubscribeTokenHash: unsubscribe.hash,
        },
      });
      if (rotated.count === 0) return null;
      return confirmationMailFor(
        email,
        communes,
        confirm.token,
        unsubscribe.token,
      );
    });
  }

  /**
   * Reads the subscription's own communes rather than trusting the caller's
   * `communes` — the whole point of this branch is that a different list in
   * the new form changes nothing; the composition is not part of the write,
   * so "не меняет состав коммун" still holds. Why the unsubscribe hash
   * rotates, and only inside the limit gate — research, врезка «Исправлено
   * при реализации».
   */
  private async sendAlreadySubscribedMail(email: string): Promise<void> {
    await this.sendFormMail(email, async () => {
      const unsubscribe = generateVeilleToken();
      const rotated = await this.prisma.veille.updateMany({
        where: { email, confirmedAt: { not: null } },
        data: { unsubscribeTokenHash: unsubscribe.hash },
      });
      // A concurrent desinscription can race us between the lookup in
      // `upsertSubscription` and here — nothing left to remind about.
      if (rotated.count === 0) return null;

      const veille = await this.prisma.veille.findUnique({
        where: { email },
        select: {
          communes: {
            select: {
              commune: { select: { name: true, departementName: true } },
            },
          },
        },
      });
      // Deleted between the rotation above and this read — rarer still, and
      // a mail whose link is already dead again would be worse than silence.
      if (!veille) return null;
      return alreadySubscribedMailFor(
        email,
        veille.communes.map((c) => c.commune),
        unsubscribe.token,
      );
    });
  }

  /**
   * Single limit gate and single exit for form mails. `compose` runs only
   * once the limit has let the mail through, so writes made for the mail's
   * own sake (token rotation) never commit for a mail that is then
   * suppressed; returning `null` (the row vanished mid-flight) aborts
   * without costing an attempt. The counter row is still written *before*
   * `send()`: a failed delivery must cost an attempt, not hand out a free
   * retry. A composition failure is the one refund: it is deterministic and
   * thrown before the transport is contacted, so charging it would burn the
   * address's whole daily budget on a bug and then mask that bug behind
   * silent 204s.
   */
  private async sendFormMail(
    email: string,
    compose: () => ComposeMailInput | null | Promise<ComposeMailInput | null>,
  ): Promise<void> {
    const emailHash = hashVeilleFormEmail(email, this.emailHashSecret);
    const sentRecently = await this.prisma.veilleFormEmail.count({
      where: { emailHash, sentAt: { gte: new Date(Date.now() - DAY_MS) } },
    });
    if (sentRecently >= VEILLE_FORM_EMAIL_DAILY_LIMIT) return;

    const input = await compose();
    if (!input) return;

    const charged = await this.prisma.veilleFormEmail.create({
      data: { emailHash },
    });
    try {
      await this.mail.send(input);
    } catch (error) {
      if (error instanceof MailCompositionError) {
        await this.prisma.veilleFormEmail.delete({
          where: { id: charged.id },
        });
      }
      throw error;
    }
  }

  async getConfirmationStatus(
    token: string,
  ): Promise<VeilleConfirmationStatus> {
    const veille = await this.prisma.veille.findUnique({
      where: { confirmTokenHash: hashVeilleToken(token) },
      select: { confirmedAt: true, confirmExpiresAt: true },
    });
    return classifyConfirmation(veille);
  }

  /**
   * One conditional `updateMany`, not read-then-update: between the two the
   * row can vanish (a concurrent desinscription from the same mail), and
   * `update` would throw `P2025` — a 404 through the global Prisma mapping
   * instead of the documented `200 { status: 'invalid' }`.
   */
  async confirm(token: string): Promise<VeilleConfirmationStatus> {
    const confirmed = await this.prisma.veille.updateMany({
      // The atomic form of `classifyConfirmation(...) === 'pending'`.
      where: {
        confirmTokenHash: hashVeilleToken(token),
        ...awaitingConfirmation(),
      },
      data: { confirmedAt: new Date() },
    });
    return confirmed.count > 0 ? 'active' : this.getConfirmationStatus(token);
  }

  /**
   * `deleteMany`, not `delete`: a token matching no row must not throw — a
   * repeat call and a call on an already-deleted subscription are both a
   * silent no-op.
   */
  async unsubscribe(token: string): Promise<void> {
    await this.prisma.veille.deleteMany({
      where: { unsubscribeTokenHash: hashVeilleToken(token) },
    });
  }

  /**
   * Single hourly trigger for both cleanups (research, «Удаление
   * неподтверждённых за 7 дней и чистка счётчика»): the two `deleteMany`
   * calls are independent of each other, but the schedule is one — a second
   * `@Cron` on the same expression would just be two names for the same tick.
   *
   * Each runs guarded so that the independence holds for failures too: nothing
   * above a scheduled tick catches anything — `AllExceptionsFilter` only sees
   * requests — so an unguarded rejection would cost the second cleanup its
   * turn and reach the log as the scheduler's own `console.error`, message and
   * all.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpired(): Promise<void> {
    await this.guarded('deleteExpiredUnconfirmed', () =>
      this.deleteExpiredUnconfirmed(),
    );
    await this.guarded('deleteStaleFormEmailCounters', () =>
      this.deleteStaleFormEmailCounters(),
    );
  }

  private async guarded(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.error(
        `${name} failed: ${errorSummary(error)}`,
        stackOf(error),
      );
    }
  }

  /**
   * The deletion criterion of the lifecycle — `expiredUnconfirmed`, the
   * complement of what `confirm` still accepts — which the `Veille` →
   * `VeilleCommune` cascade extends to the chosen communes. A row still within
   * its deadline stays, however long its owner takes to open the mail.
   */
  async deleteExpiredUnconfirmed(): Promise<void> {
    await this.prisma.veille.deleteMany({ where: expiredUnconfirmed() });
  }

  /**
   * `VeilleFormEmail` rows outlive the `Veille` they were sent for — no FK
   * ties them together, so desinscription and expiry cleanup above never
   * touch this table. This is the only thing that ages its rows out — on its
   * own 24-hour window, independent of whatever happened to the subscription
   * they were sent for. `sendFormMail` writes them (and refunds one), nothing
   * else reads or deletes them.
   */
  async deleteStaleFormEmailCounters(): Promise<void> {
    await this.prisma.veilleFormEmail.deleteMany({
      where: { sentAt: { lt: new Date(Date.now() - DAY_MS) } },
    });
  }
}
