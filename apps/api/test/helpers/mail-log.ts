import { LOG_LEVELS, Logger, type LogLevel } from '@nestjs/common';

/**
 * Everything a Logger of the mail module wrote during a test — shared, because
 * two spellings of "did an address reach the log?" would answer two ways.
 *
 * The levels watched are LOG_LEVELS of Nest, never a list written out here: a
 * level this file did not know about is a level nothing is watching.
 */

export interface CapturedLogs {
  /** The level of every call, in order — an empty log is then visible as such. */
  levels(): LogLevel[];
  /** Every call serialized, as one text to search. */
  text(): string;
  /**
   * Fails if the log names any of these, by local part too: a log that kept
   * "destinataire" of "destinataire@example.test" still names the person.
   * Case-insensitive — a provider may answer in a casing of its own.
   */
  expectNoTraceOf(...secrets: string[]): void;
}

export const captureLogs = (): CapturedLogs => {
  let written: { level: LogLevel; text: string }[] = [];

  beforeEach(() => {
    written = [];
    for (const level of LOG_LEVELS) {
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

/** Every argument, not just the first: an address leaks just as easily through
 * the context parameter or from inside a thrown error. */
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
