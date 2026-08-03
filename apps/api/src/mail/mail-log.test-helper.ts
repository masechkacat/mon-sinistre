import { Logger } from '@nestjs/common';

/**
 * Everything a Logger of the mail module wrote during a test. Shared by the
 * tests of the service and of the provider transport, because both ask the same
 * question — "did an address reach the log?" — and two spellings of it would
 * answer two ways: the day one of them learns to look inside an AggregateError,
 * the other keeps missing that leak (apps/api/CLAUDE.md).
 *
 * Installs the spies itself, for every test of the suite that calls it and not
 * only for those that read the log: the mail module is loud on its failure
 * paths, and a test run is not the place to print those stacks.
 */

const LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;

type LogLevel = (typeof LEVELS)[number];

export interface CapturedLogs {
  /** The level of every call, in order — an empty log is then visible as such. */
  levels(): LogLevel[];
  /** Every call serialized, as one text to search. */
  text(): string;
  /**
   * Fails if the log names any of these. An address is also looked for by its
   * local part alone: a log that kept "destinataire" of
   * "destinataire@example.test" still names the person. Compared in one casing,
   * because an address in another one names them just as well — the domain is
   * case-insensitive by RFC 5321, and a provider may answer in a casing of its
   * own.
   */
  expectNoTraceOf(...secrets: string[]): void;
}

export const captureLogs = (): CapturedLogs => {
  let written: { level: LogLevel; text: string }[] = [];

  beforeEach(() => {
    written = [];
    for (const level of LEVELS) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          written.push({ level, text: serialize(args) });
        });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const text = (): string => written.map((entry) => entry.text).join('\n');

  return {
    levels: () => written.map((entry) => entry.level),
    text,
    expectNoTraceOf: (...secrets) => {
      const logged = text().toLowerCase();
      for (const secret of secrets) {
        const needles = secret.includes('@')
          ? [secret, secret.slice(0, secret.indexOf('@'))]
          : [secret];
        for (const needle of needles) {
          expect(logged).not.toContain(needle.toLowerCase());
        }
      }
    },
  };
};

/**
 * Every argument of a Logger call, serialized. Checking the first one is not
 * enough: an address leaks just as easily through the context parameter or from
 * inside a thrown error (docs/research/emails.md).
 */
const serialize = (args: unknown[]): string =>
  JSON.stringify(args, (_key, value: unknown) =>
    value instanceof Error
      ? {
          name: value.name,
          message: value.message,
          stack: value.stack,
          cause: value.cause,
        }
      : value,
  );
