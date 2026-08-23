import type { Logger } from '@nestjs/common';
import {
  drainOutbox,
  NOTIFICATION_ATTEMPTS_BEFORE_ALERT,
  type OutboxAdapter,
  type PendingOutboxRow,
} from './drain-outbox';

function fakeLogger(): Logger {
  return {
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
  } as unknown as Logger;
}

/**
 * An in-memory outbox: `state` holds every row not yet sent, so a later
 * `loadPending()` call — modelling the next scheduled run — naturally
 * excludes whatever a previous call already marked sent, and still returns
 * whatever it left `attempts`-incremented and pending.
 */
function fakeAdapter(
  rows: PendingOutboxRow[],
  overrides: Partial<OutboxAdapter<PendingOutboxRow, string>> = {},
): {
  adapter: OutboxAdapter<PendingOutboxRow, string>;
  sent: string[];
  stuck: { rowId: string; attempts: number }[];
  state: Map<string, PendingOutboxRow>;
} {
  const state = new Map(rows.map((row) => [row.id, { ...row }]));
  const sent: string[] = [];
  const stuck: { rowId: string; attempts: number }[] = [];
  const adapter: OutboxAdapter<PendingOutboxRow, string> = {
    loadPending: () => Promise.resolve([...state.values()]),
    loadMails: (_arreteId, group) =>
      Promise.resolve(new Map(group.map((row) => [row.id, `mail-${row.id}`]))),
    send: (mail) => {
      sent.push(mail);
      return Promise.resolve();
    },
    markSent: (row) => {
      state.delete(row.id);
      return Promise.resolve();
    },
    incrementAttempts: (row) => {
      const current = state.get(row.id);
      if (!current) {
        throw new Error(`row ${row.id} not pending`);
      }
      current.attempts += 1;
      return Promise.resolve(current.attempts);
    },
    onStuck: (row, attempts) => {
      stuck.push({ rowId: row.id, attempts });
      return Promise.resolve();
    },
    ...overrides,
  };
  return { adapter, sent, stuck, state };
}

const row = (id: string, arreteId: string): PendingOutboxRow => ({
  id,
  arreteId,
  attempts: 0,
});

describe('drainOutbox', () => {
  it('sends every pending row of every arrête group', async () => {
    const { adapter, sent, state } = fakeAdapter([
      row('a', 'arrete-1'),
      row('b', 'arrete-1'),
      row('c', 'arrete-2'),
    ]);

    await drainOutbox(fakeLogger(), adapter, new Set());

    expect(sent.sort()).toEqual(['mail-a', 'mail-b', 'mail-c']);
    expect(state.size).toBe(0);
  });

  it('a failed send to one recipient does not block the others in the same group', async () => {
    const { adapter, sent, state } = fakeAdapter(
      [row('a', 'arrete-1'), row('b', 'arrete-1')],
      {
        send: (mail) => {
          if (mail === 'mail-a') {
            throw new Error('mailbox rejected');
          }
          sent.push(mail);
          return Promise.resolve();
        },
      },
    );

    await drainOutbox(fakeLogger(), adapter, new Set());

    expect(sent).toEqual(['mail-b']);
    // b was sent and drained; a failed and stays pending with one attempt.
    expect(state.has('b')).toBe(false);
    expect(state.get('a')).toMatchObject({ attempts: 1 });
  });

  it('a group that fails to compose does not block another group', async () => {
    const { adapter, sent } = fakeAdapter(
      [row('a', 'poisoned'), row('b', 'arrete-2')],
      {
        loadMails: (arreteId, group) => {
          if (arreteId === 'poisoned') {
            throw new Error('DeadlineRule gap');
          }
          return Promise.resolve(
            new Map(group.map((r) => [r.id, `mail-${r.id}`])),
          );
        },
      },
    );

    await drainOutbox(fakeLogger(), adapter, new Set());

    expect(sent).toEqual(['mail-b']);
  });

  it('a row that failed this run is retried by the next one, not by a second drain in the same run', async () => {
    const { adapter, sent, state } = fakeAdapter([row('a', 'arrete-1')], {
      send: () => {
        throw new Error('boom');
      },
    });

    // Two drains of the same run share one `attempted` set.
    const attempted = new Set<string>();
    await drainOutbox(fakeLogger(), adapter, attempted);
    await drainOutbox(fakeLogger(), adapter, attempted);
    expect(sent).toEqual([]);
    expect(state.get('a')).toMatchObject({ attempts: 1 });

    // A fresh run (fresh `attempted`) tries it again.
    await drainOutbox(fakeLogger(), adapter, new Set());
    expect(state.get('a')).toMatchObject({ attempts: 2 });
  });

  it('alerts once when a row keeps failing, and stops counting there', async () => {
    const { adapter, stuck, state } = fakeAdapter([row('a', 'arrete-1')], {
      send: () => {
        throw new Error('boom');
      },
    });

    for (let run = 0; run < NOTIFICATION_ATTEMPTS_BEFORE_ALERT + 1; run++) {
      await drainOutbox(fakeLogger(), adapter, new Set());
    }

    expect(stuck).toEqual([
      { rowId: 'a', attempts: NOTIFICATION_ATTEMPTS_BEFORE_ALERT },
    ]);
    expect(state.get('a')).toMatchObject({
      attempts: NOTIFICATION_ATTEMPTS_BEFORE_ALERT + 1,
    });
  });

  it('a row mailed to nobody is marked sent without calling send', async () => {
    const { adapter, sent, state } = fakeAdapter([row('a', 'arrete-1')], {
      loadMails: () => Promise.resolve(new Map([['a', null]])),
    });

    await drainOutbox(fakeLogger(), adapter, new Set());

    expect(sent).toEqual([]);
    expect(state.has('a')).toBe(false);
  });

  it('a row absent from the mail map is left untouched', async () => {
    const { adapter, sent, state } = fakeAdapter([row('a', 'arrete-1')], {
      loadMails: () => Promise.resolve(new Map()),
    });

    await drainOutbox(fakeLogger(), adapter, new Set());

    expect(sent).toEqual([]);
    expect(state.get('a')).toMatchObject({ attempts: 0 });
  });

  it('skips a row already attempted earlier in the same run', async () => {
    const { adapter, sent } = fakeAdapter([row('a', 'arrete-1')]);

    await drainOutbox(fakeLogger(), adapter, new Set(['a']));

    expect(sent).toEqual([]);
  });
});
