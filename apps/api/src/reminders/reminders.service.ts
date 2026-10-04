import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { IsoDate, RisqueCatnat } from '@mon-sinistre/contracts';
import { errorSummary, stackOf } from 'src/common/error-report';
import { generateSecureToken } from 'src/common/security/secure-token';
import { todayInParis } from 'src/common/time/today-in-paris';
import {
  dateToIsoDate,
  isoDateToDate,
  resolveDeadline,
} from 'src/deadline-rules/resolve-deadline';
import type { Prisma } from 'src/generated/prisma/client';
import { fr } from 'src/i18n/fr';
import { AdminAlertService } from 'src/jorf/alerts/admin-alert.service';
import { NOTIFICATION_ATTEMPTS_BEFORE_ALERT } from 'src/jorf/mail/drain-outbox';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  reminderMailFor,
  type ReminderSinistreForMail,
  type ReminderStepForMail,
} from './reminder-mail';
import {
  REMINDER_HORIZON_DAYS,
  selectReminders,
  type ReminderCandidateStep,
  type ReminderReason,
} from './select-reminders';

/** Exported for `reminders-schedule.spec.ts`, which must not restate it. */
export const REMINDERS_CRON = '0 7 * * *';

/** Everything one candidate step contributes — to the pure selection
 * ({@link ReminderCandidateStep}), to the mail ({@link ReminderStepForMail})
 * and to the grouping by recipient. The sinistre's own `risque`, not the label
 * its `ArreteEntry` prints: a dossier opened before any arrêté has no entry. */
const CANDIDATE_SELECT = {
  id: true,
  name: true,
  plannedDate: true,
  persistedStatus: true,
  sourceUrl: true,
  sourceVerifiedAt: true,
  deadlineRule: { select: { code: true } },
  reminderLogs: {
    select: {
      kind: true,
      offsetDays: true,
      plannedDate: true,
      sentOn: true,
    },
  },
  sinistre: {
    select: {
      id: true,
      eventDate: true,
      risque: true,
      commune: { select: { name: true, departementName: true } },
      user: { select: { id: true, email: true, reminderFailures: true } },
    },
  },
} satisfies Prisma.StepSelect;

type CandidateRow = Prisma.StepGetPayload<{ select: typeof CANDIDATE_SELECT }>;

/** One recipient's whole mail, accumulated while the reasons are walked:
 * `sinistres` keyed by dossier so two dossiers of one person become two blocks
 * of a single message, `reasons` kept alongside because they, not the mail,
 * are what gets recorded afterwards. */
type MailDossier = Omit<ReminderSinistreForMail, 'steps'> & {
  steps: ReminderStepForMail[];
};

type Recipient = {
  userId: string;
  email: string;
  failures: number;
  reasons: ReminderReason[];
  sinistres: Map<string, MailDossier>;
};

const toCandidate = (row: CandidateRow): ReminderCandidateStep => ({
  id: row.id,
  plannedDate: row.plannedDate === null ? null : dateToIsoDate(row.plannedDate),
  persistedStatus: row.persistedStatus,
  deadlineRuleCode: row.deadlineRule?.code ?? null,
  logs: row.reminderLogs.map((log) => ({
    kind: log.kind,
    offsetDays: log.offsetDays,
    plannedDate: dateToIsoDate(log.plannedDate),
    sentOn: dateToIsoDate(log.sentOn),
  })),
});

const toMailStep = (
  row: CandidateRow,
  reason: ReminderReason,
): ReminderStepForMail => ({
  name: row.name,
  plannedDate: reason.plannedDate,
  remainingDays: reason.offsetDays,
  deadlineRuleCode: row.deadlineRule?.code ?? null,
  source:
    row.sourceUrl === null || row.sourceVerifiedAt === null
      ? null
      : {
          url: row.sourceUrl,
          verifiedAt: dateToIsoDate(row.sourceVerifiedAt),
        },
});

/**
 * The daily reminder pass (docs/research/sinistre-reminders.md, «Прогон»):
 * every step inside its scale becomes a line of one mail per person, and the
 * fact of that mail is recorded per reason, so the next pass of the same day
 * finds nothing left to say.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly adminAlerts: AdminAlertService,
  ) {}

  /**
   * Catches its own failures and guards against a second tick exactly as
   * `JorfMonitorService.run` does, down to the `options` argument the cron
   * callback brings instead of the tests' `now` — its docblock explains both.
   */
  @Cron(REMINDERS_CRON, { timeZone: 'Europe/Paris' })
  async run(options: { now?: Date } = {}): Promise<void> {
    if (this.running) {
      this.logger.warn('reminders: previous run still going, tick skipped');
      return;
    }
    this.running = true;
    try {
      await this.runOnce(todayInParis(options.now));
    } catch (error) {
      this.logger.error(
        `reminders run failed: ${errorSummary(error)}`,
        stackOf(error),
      );
    } finally {
      this.running = false;
    }
  }

  private async runOnce(today: IsoDate): Promise<void> {
    const candidates = await this.prisma.step.findMany({
      where: {
        persistedStatus: null,
        plannedDate: {
          not: null,
          lte: isoDateToDate(
            resolveDeadline(today, REMINDER_HORIZON_DAYS, 'DAYS'),
          ),
        },
        sinistre: { user: { remindersDisabledAt: null } },
      },
      select: CANDIDATE_SELECT,
      // The order of the plan itself, so the mail lists the steps in it.
      orderBy: [{ sinistreId: 'asc' }, { order: 'asc' }],
    });

    const recipients = this.groupByRecipient(
      candidates,
      selectReminders(candidates.map(toCandidate), today),
    );

    let mails = 0;
    let failed = 0;
    for (const recipient of recipients.values()) {
      try {
        if (await this.mailOne(recipient, today)) {
          mails += 1;
        }
      } catch (error) {
        failed += 1;
        await this.countFailure(recipient, error);
      }
    }
    this.logger.log(
      `reminders: run done — users=${recipients.size} mails=${mails} failed=${failed}`,
    );
  }

  /** The reasons of one pass, folded into one {@link Recipient} per person. */
  private groupByRecipient(
    candidates: readonly CandidateRow[],
    reasons: readonly ReminderReason[],
  ): Map<string, Recipient> {
    const rowById = new Map(candidates.map((row) => [row.id, row]));
    const recipients = new Map<string, Recipient>();

    for (const reason of reasons) {
      const row = rowById.get(reason.stepId);
      if (!row) {
        continue;
      }
      const { user, commune } = row.sinistre;
      const recipient: Recipient = recipients.get(user.id) ?? {
        userId: user.id,
        email: user.email,
        failures: user.reminderFailures,
        reasons: [],
        sinistres: new Map(),
      };
      recipient.reasons.push(reason);

      const dossier: MailDossier = recipient.sinistres.get(row.sinistre.id) ?? {
        id: row.sinistre.id,
        commune,
        risque: fr.sinistres.risques[row.sinistre.risque as RisqueCatnat],
        eventDate: dateToIsoDate(row.sinistre.eventDate),
        steps: [],
      };
      dossier.steps.push(toMailStep(row, reason));

      recipient.sinistres.set(row.sinistre.id, dossier);
      recipients.set(user.id, recipient);
    }

    return recipients;
  }

  /**
   * One person's mail, then the facts it carried.
   *
   * @returns whether a mail actually went out.
   */
  private async mailOne(
    recipient: Recipient,
    today: IsoDate,
  ): Promise<boolean> {
    const unsubscribeToken = await this.rotateUnsubscribeToken(
      recipient.userId,
    );
    if (unsubscribeToken === null) {
      return false;
    }

    await this.mail.send(
      reminderMailFor(recipient.email, unsubscribeToken, today, [
        ...recipient.sinistres.values(),
      ]),
    );

    await this.prisma.$transaction([
      this.prisma.reminderLog.createMany({
        data: recipient.reasons.map((reason) => ({
          stepId: reason.stepId,
          kind: reason.kind,
          // An `OVERDUE` row keeps no count (data-model.md § 6).
          offsetDays: reason.kind === 'OVERDUE' ? null : reason.offsetDays,
          plannedDate: isoDateToDate(reason.plannedDate),
          sentOn: isoDateToDate(today),
        })),
      }),
      this.prisma.user.updateMany({
        where: { id: recipient.userId },
        data: { reminderFailures: 0 },
      }),
    ]);
    return true;
  }

  /**
   * One recipient's failure, kept to that recipient (ТЗ § 6) — why a pass that
   * records nothing is already the retry: research, «Прогон». Equality and not
   * `>=`: the alert belongs to the pass that crosses the threshold, and every
   * later failure of the same person stays silent.
   */
  private async countFailure(
    recipient: Recipient,
    error: unknown,
  ): Promise<void> {
    const failures = recipient.failures + 1;
    this.logger.error(
      `reminders: mail to user ${recipient.userId} failed ${failures} times: ${errorSummary(error)}`,
      stackOf(error),
    );
    await this.prisma.user.updateMany({
      where: { id: recipient.userId },
      data: { reminderFailures: failures },
    });
    if (failures !== NOTIFICATION_ATTEMPTS_BEFORE_ALERT) {
      return;
    }
    await this.adminAlerts.raise({
      kind: 'NOTIFICATION_STUCK',
      detail: `rappels: utilisateur ${recipient.userId} не отправлено после ${failures} попыток`,
    });
  }

  /**
   * Rotates the unsubscribe token for the mail about to go out, same pattern
   * as `JorfMonitorService.rotateUnsubscribeToken`. `null` means the person
   * switched the reminders off between the query above and this write, or
   * deleted the account: there is then nothing to send.
   */
  private async rotateUnsubscribeToken(userId: string): Promise<string | null> {
    const unsubscribe = generateSecureToken();
    const rotated = await this.prisma.user.updateMany({
      where: { id: userId, remindersDisabledAt: null },
      data: { reminderUnsubscribeTokenHash: unsubscribe.hash },
    });
    return rotated.count === 0 ? null : unsubscribe.token;
  }
}
