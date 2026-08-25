import type { Logger } from '@nestjs/common';
import { errorSummary, stackOf } from 'src/common/error-report';

/**
 * Failed sends of one outbox row before it is called stuck
 * (docs/research/sinistre-plan.md, "Письмо владельцу синистра и
 * дедупликация с veille"). Four runs' worth of retries at two ticks a day
 * (≈ two days): long enough that a mailbox down for a day resolves itself
 * unannounced, short enough that a row the transport will never accept
 * surfaces while the arrêté still matters.
 */
export const NOTIFICATION_ATTEMPTS_BEFORE_ALERT = 4;

/** The shape every outbox row needs for the drain cycle — `arreteId` to
 * group sends the way a mail is composed (per arrêté, not per row),
 * `attempts` for the stuck threshold above. */
export type PendingOutboxRow = {
  id: string;
  arreteId: string;
  attempts: number;
};

/**
 * What one outbox (veille, sinistre) plugs into the shared drain cycle
 * (docs/plan/sinistre-plan.md, Фаза 4, issue #159): loading pending rows,
 * composing a mail per arrêté group, and marking progress. `loadMails` is
 * called once per group, not once per row, because building a mail needs
 * data shared by the whole group — the arrête, its entries, the
 * déclaration rule. Its map answers three ways for a given row id: a
 * `Mail` to send; `null`, meaning the row turns out to have nothing left to
 * mail and is drained without sending anything; or absent, meaning the row
 * is left untouched this pass (a recipient token race — see
 * `JorfMonitorService.rotateUnsubscribeToken` — not a normal branch).
 */
export type OutboxAdapter<Row extends PendingOutboxRow, Mail> = {
  loadPending(): Promise<Row[]>;
  loadMails(
    arreteId: string,
    rows: readonly Row[],
  ): Promise<ReadonlyMap<string, Mail | null>>;
  send(mail: Mail): Promise<void>;
  markSent(row: Row): Promise<void>;
  /** Persists `attempts + 1` and returns the new count. */
  incrementAttempts(row: Row): Promise<number>;
  /** Called exactly once for a row, the run its attempts reach {@link NOTIFICATION_ATTEMPTS_BEFORE_ALERT} — raises that row's `NOTIFICATION_STUCK` alert. */
  onStuck(row: Row, attempts: number): Promise<void>;
};

/**
 * «Взять pending → сгруппировать по arrêté → try/catch на получателя →
 * отметить или посчитать попытку» — the outbox drain veille and sinistre
 * notifications share (docs/research/sinistre-plan.md, "Письмо владельцу
 * синистра и дедупликация с veille"). Grouped by arrêté because that is
 * what a mail's content is resolved against, and a group whose composition
 * throws (a `DeadlineRule` gap, a lookup failure) costs only its own rows —
 * the next group is unaffected (ТЗ § 6, "сбой отправки одному получателю не
 * прерывает рассылку остальным", one level up from the per-recipient
 * try/catch below).
 *
 * `attempted` is the caller's memo across more than one drain of the same
 * run (`JorfMonitorService.runOnce` drains before and after ingest): a row
 * already tried once this run must not be retried a second time in the same
 * run — that belongs to the next run, so a failed send burns at most one
 * unsubscribe token per run, not two.
 */
export async function drainOutbox<Row extends PendingOutboxRow, Mail>(
  logger: Logger,
  adapter: OutboxAdapter<Row, Mail>,
  attempted: Set<string>,
): Promise<void> {
  const pending = (await adapter.loadPending()).filter(
    (row) => !attempted.has(row.id),
  );
  if (pending.length === 0) {
    return;
  }

  const byArrete = new Map<string, Row[]>();
  for (const row of pending) {
    const group = byArrete.get(row.arreteId) ?? [];
    group.push(row);
    byArrete.set(row.arreteId, group);
  }

  for (const [arreteId, rows] of byArrete) {
    for (const row of rows) {
      attempted.add(row.id);
    }
    try {
      const mails = await adapter.loadMails(arreteId, rows);
      for (const row of rows) {
        if (!mails.has(row.id)) {
          continue;
        }
        const mail = mails.get(row.id) ?? null;
        if (mail === null) {
          await adapter.markSent(row);
          continue;
        }
        try {
          await adapter.send(mail);
          await adapter.markSent(row);
        } catch (error) {
          logger.error(
            `outbox: notification email failed: ${errorSummary(error)}`,
            stackOf(error),
          );
          const attempts = await adapter.incrementAttempts(row);
          if (attempts === NOTIFICATION_ATTEMPTS_BEFORE_ALERT) {
            await adapter.onStuck(row, attempts);
          }
        }
      }
    } catch (error) {
      logger.error(
        `outbox: notifications for arrete ${arreteId} failed: ${errorSummary(error)}`,
        stackOf(error),
      );
    }
  }
}
