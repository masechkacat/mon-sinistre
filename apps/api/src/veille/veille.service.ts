import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  VEILLE_CONFIRM_TTL_DAYS,
  VEILLE_FORM_EMAIL_DAILY_LIMIT,
  type VeilleConfirmationStatus,
} from '@mon-sinistre/contracts';
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
 * Single source of the pending/active/invalid decision — `GET` reads it
 * directly, `POST` falls back to it when its conditional write matched no
 * row, so the two never disagree on the same token.
 */
const classifyConfirmation = (
  veille: { confirmedAt: Date | null; confirmExpiresAt: Date } | null,
): VeilleConfirmationStatus => {
  if (!veille) return 'invalid';
  if (veille.confirmedAt) return 'active';
  if (veille.confirmExpiresAt < new Date()) return 'invalid';
  return 'pending';
};

@Injectable()
export class VeilleService {
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
   * Branches on whether `email` already has a row (docs/research, «Сценарии
   * формы и гонка уникальности»): none → create; unconfirmed → rewrite its
   * communes, extend the deadline and resend the confirmation mail with
   * rotated tokens; confirmed → row untouched, only a
   * "déjà inscrit·e" reminder mail goes out with the communes it actually
   * has, ignoring whatever this new form submitted. A concurrent create that
   * loses the unique-index race retries this once, landing the loser in the
   * unconfirmed branch instead of surfacing `P2002`.
   */
  private async upsertSubscription(
    email: string,
    communeCodes: string[],
    communes: readonly ChosenCommune[],
    isRetry = false,
  ): Promise<void> {
    const existing = await this.prisma.veille.findUnique({
      where: { email },
      select: { id: true, confirmedAt: true },
    });

    if (existing) {
      if (existing.confirmedAt) {
        await this.sendAlreadySubscribedMail(email);
        return;
      }
      const rewritten = await this.resubscribeUnconfirmed(
        existing.id,
        communeCodes,
      );
      // `false` means the row vanished (desinscription) or got confirmed
      // between the lookup above and the transaction — nothing to mail.
      if (rewritten) {
        await this.resendConfirmationMail(existing.id, email, communes);
      }
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
        // Losing the race twice (delete then re-create between our lookup and
        // this create) proves the address exists right now — a 500 here would
        // be the same timing-dependent enumeration signal the untranslated
        // P2002 avoids. Swallowed like any other lost race: 204, no mail.
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
   * The composition rewrite and deadline extension are conditioned on the
   * same `updateMany` that guards `confirm()`: between the earlier
   * `findUnique` and this call the row can vanish (a concurrent
   * desinscription) or turn confirmed (a concurrent confirmation), and
   * `veille.update` would throw `P2025` on the first. Returns whether the row
   * was still there to rewrite — the caller skips the resend mail otherwise.
   */
  private async resubscribeUnconfirmed(
    veilleId: string,
    communeCodes: string[],
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.veille.updateMany({
        where: { id: veilleId, confirmedAt: null },
        data: { confirmExpiresAt: nextConfirmExpiresAt() },
      });
      if (updated.count === 0) return false;
      await tx.veilleCommune.deleteMany({ where: { veilleId } });
      await tx.veilleCommune.createMany({
        data: communeCodes.map((codeInsee) => ({ veilleId, codeInsee })),
      });
      return true;
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
        confirmedAt: null,
        confirmExpiresAt: { gte: new Date() },
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
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpired(): Promise<void> {
    await this.deleteExpiredUnconfirmed();
    await this.deleteStaleFormEmailCounters();
  }

  async deleteExpiredUnconfirmed(): Promise<void> {
    await this.prisma.veille.deleteMany({
      where: { confirmedAt: null, confirmExpiresAt: { lt: new Date() } },
    });
  }

  /**
   * `VeilleFormEmail` rows outlive the `Veille` they were sent for — no FK
   * ties them together, so desinscription and expiry cleanup above never
   * touch this table. This is the only thing that does, on its own 24-hour
   * window, independent of whatever happened to the subscription.
   */
  async deleteStaleFormEmailCounters(): Promise<void> {
    await this.prisma.veilleFormEmail.deleteMany({
      where: { sentAt: { lt: new Date(Date.now() - DAY_MS) } },
    });
  }
}
