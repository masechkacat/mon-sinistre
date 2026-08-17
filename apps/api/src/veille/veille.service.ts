import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  VEILLE_CHANGE_TTL_DAYS,
  VEILLE_CONFIRM_TTL_DAYS,
  VEILLE_FORM_EMAIL_DAILY_LIMIT,
  type VeilleChangeResponse,
  type VeilleConfirmationStatus,
} from '@mon-sinistre/contracts';
import { errorSummary, stackOf } from 'src/common/error-report';
import type { EnvironmentVariables } from 'src/config/env.validation';
import { MailCompositionError } from 'src/mail/mail-composition.error';
import type { ComposeMailInput } from 'src/mail/mail-message';
import { MailService } from 'src/mail/mail.service';
import {
  isForeignKeyViolation,
  isUniqueViolationOn,
} from 'src/prisma/prisma-error';
import { PrismaService } from 'src/prisma/prisma.service';
import type { CreateVeilleDto } from './dto/create-veille.dto';
import { changeMailFor } from './veille-change-mail';
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

export const nextChangeExpiresAt = (): Date =>
  new Date(Date.now() + VEILLE_CHANGE_TTL_DAYS * DAY_MS);

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
  { kind: 'rewritten' | 'confirmed'; veilleId: string } | { kind: 'absent' };

/**
 * Thrown only inside the transaction of `upsertChangeRequest`'s mail step, to
 * roll it back — a plain early `return null` would still commit whichever of
 * the two rotations already ran, stranding a hash whose token nobody received.
 */
class ChangeMailRaceLost extends Error {}

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
   * research, «Сценарии формы и гонка уникальности» с врезкой фазы 4, и
   * docs/research/veille-commune-change.md, «Ветка подтверждённого адреса»):
   * nothing → create; unconfirmed → rewrite its communes, extend the deadline
   * and resend the confirmation mail with rotated tokens; confirmed → the
   * active subscription is untouched, and the new composition lands in its
   * `VeilleChange` request instead, mailed as a change-confirmation link. The
   * branch is decided by the write that takes it (`claimUnconfirmed`), so no
   * row is ever rewritten — or resurrected — on the strength of a lookup it
   * has since outlived. The one race left is a concurrent create hitting the
   * unique index: retried once (`isRetry`), so that the loser lands in the
   * branch that is true after the race instead of answering 204 with nothing
   * written.
   */
  private async upsertSubscription(
    email: string,
    communeCodes: string[],
    communes: readonly ChosenCommune[],
    isRetry = false,
  ): Promise<void> {
    const claim = await this.claimUnconfirmed(email, communeCodes);
    if (claim.kind === 'confirmed') {
      await this.upsertChangeRequest(claim.veilleId, email, communeCodes);
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
          select: { id: true, confirmedAt: true },
        });
        if (!existing) return { kind: 'absent' };
        return existing.confirmedAt
          ? { kind: 'confirmed', veilleId: existing.id }
          : { kind: 'absent' };
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
   * The confirmed branch of a resubmission (docs/research/
   * veille-commune-change.md, «Ветка подтверждённого адреса в subscribe»):
   * the pending request's composition and deadline are rewritten on every
   * submission — win or lose the rate limit below — so a delivered link
   * always opens onto what the next confirmation would actually apply.
   * `veilleId` comes from the same claim that already proved the row
   * confirmed, so the write below cannot land on a different subscription's
   * request in the email-normalisation race that `claimUnconfirmed` guards
   * against; the mail-gated rotation further down still keys its unsubscribe
   * half by `email` (research: same condition as the deleted
   * `sendAlreadySubscribedMail`), since that hash lives on `Veille`, not on
   * this request.
   *
   * `create` needs *some* hash to satisfy the column — `placeholder` — whose
   * token is dropped on the spot: the rotation below mails a freshly generated
   * one. What the placeholder can outlive is the mail — the daily limit may
   * suppress it, the rotation may lose its race — and it then stays in the
   * column as a hash nobody holds the token for. That is the harmless end of
   * the race: an unreachable request confirms nothing and expires on its own,
   * unlike a rotated hash whose token was never delivered, which is what
   * `rotateAndSendChangeMail` goes to the trouble of preventing. A stored
   * `changeTokenHash` is therefore no proof that a link went out.
   *
   * The FK this insert relies on can still lose a race of its own — a
   * concurrent desinscription deleting the `Veille` row between
   * `claimUnconfirmed`'s read and this write — which surfaces as `P2003`
   * (`veille-schema.int-spec.ts` holds Prisma to that code); treated the same
   * as every other
   * "vanished mid-flight" race in this file, nothing left to hold a pending
   * request for.
   */
  private async upsertChangeRequest(
    veilleId: string,
    email: string,
    communeCodes: string[],
  ): Promise<void> {
    const placeholder = generateVeilleToken();
    try {
      await this.prisma.veilleChange.upsert({
        where: { veilleId },
        create: {
          veilleId,
          communeCodes,
          expiresAt: nextChangeExpiresAt(),
          changeTokenHash: placeholder.hash,
        },
        update: { communeCodes, expiresAt: nextChangeExpiresAt() },
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) return;
      throw error;
    }

    await this.rotateAndSendChangeMail(veilleId, email);
  }

  /**
   * Token rotation is gated the same way `resendConfirmationMail`'s is: only
   * a mail that actually goes out gets a link that still works. Both
   * rotations and the read of the composition to mail share one transaction,
   * not two independent `updateMany` calls — either the change hash matching
   * zero rows (a concurrent desinscription already cascaded the request
   * away) or the unsubscribe hash doing the same throws `ChangeMailRaceLost`
   * to roll back, so a lost race can never strand a rotated `changeTokenHash`
   * whose token was never mailed. The composition mailed is read back inside
   * the same transaction rather than trusting the caller's snapshot: a second
   * submission racing this one between `upsertChangeRequest`'s write and this
   * rotation would otherwise mail a list that no longer matches what the
   * link, once confirmed, actually applies.
   */
  private async rotateAndSendChangeMail(
    veilleId: string,
    email: string,
  ): Promise<void> {
    await this.sendFormMail(email, async () => {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const change = generateVeilleToken();
          const unsubscribe = generateVeilleToken();
          const rotatedChange = await tx.veilleChange.updateMany({
            where: { veilleId },
            data: { changeTokenHash: change.hash },
          });
          if (rotatedChange.count === 0) throw new ChangeMailRaceLost();
          const rotatedUnsubscribe = await tx.veille.updateMany({
            where: { email, confirmedAt: { not: null } },
            data: { unsubscribeTokenHash: unsubscribe.hash },
          });
          if (rotatedUnsubscribe.count === 0) throw new ChangeMailRaceLost();

          const request = await tx.veilleChange.findUniqueOrThrow({
            where: { veilleId },
            select: { communeCodes: true },
          });
          const communes = await tx.commune.findMany({
            where: { codeInsee: { in: request.communeCodes } },
            select: { name: true, departementName: true },
          });
          return changeMailFor(
            email,
            communes,
            change.token,
            unsubscribe.token,
          );
        });
      } catch (error) {
        if (error instanceof ChangeMailRaceLost) return null;
        throw error;
      }
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
   * `findFirst`, not `findUnique`: the expiry condition rides along in the
   * same query, so an unknown token and an expired-but-still-there request
   * come back identically as "no row" — no second, JS-side check to keep in
   * sync with the one the cleanup and `POST` use. `changeTokenHash` stays
   * unique, so this is still a single-row lookup by index, not a scan.
   */
  async getChangeStatus(token: string): Promise<VeilleChangeResponse> {
    const change = await this.prisma.veilleChange.findFirst({
      where: {
        changeTokenHash: hashVeilleToken(token),
        expiresAt: { gte: new Date() },
      },
      select: { communeCodes: true },
    });
    if (!change) return { status: 'invalid' };

    const communes = await this.prisma.commune.findMany({
      where: { codeInsee: { in: change.communeCodes } },
      select: { name: true, departementName: true },
    });
    return { status: 'pending', communes };
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
