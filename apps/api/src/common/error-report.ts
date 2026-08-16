import { prismaErrorDetail } from 'src/prisma/prisma-error';

const MAX_LOGGED_FRAMES = 12;

/** The class that was thrown — never its message. */
const nameOf = (thrown: unknown): string =>
  thrown instanceof Error ? thrown.constructor.name : typeof thrown;

/**
 * Everything about a failure that may be written down: its class, plus the code
 * and model when Prisma raised it. The one way to describe an error in a log —
 * `AllExceptionsFilter` for failed requests, a scheduled job for a tick nothing
 * catches; a second phrasing would eventually be the one that quotes a message.
 */
export const errorSummary = (thrown: unknown): string => {
  const detail = prismaErrorDetail(thrown);
  return detail ? `${nameOf(thrown)} ${detail}` : nameOf(thrown);
};

/**
 * A stack whose header is the class alone. The header of a V8 stack is
 * `${name}: ${message}`, and the message is exactly what must not reach the
 * logs. It is removed by exact length, not by dropping the first line — a
 * message with newlines occupies several. Anything not matching this shape
 * yields no stack at all: losing the trace of an odd error costs a debugging
 * session, the other direction costs personal data in a log file.
 *
 * The class name is written back as the first line instead of leaving the
 * frames alone: `Logger.error(message, stack)` reads its second argument as a
 * stack only while it looks like one (a line, then an indented `at …:1:1`), and
 * a single surviving frame with nothing above it would be taken for the log's
 * context, displacing the name of the class that logged the failure.
 */
export const stackOf = (thrown: unknown): string | undefined => {
  if (!(thrown instanceof Error) || !thrown.stack) {
    return undefined;
  }
  // An error with no message has no ": " in its header either — V8 writes the
  // name alone. Spelling the separator out regardless would fail the match
  // below and cost the frames of exactly the error that has nothing else to
  // show. Under jest this is invisible: source-map-support rewrites the stack
  // and puts the separator back, so the case is recorded with a stack written
  // out by hand in the spec.
  const header = thrown.message
    ? `${thrown.name}: ${thrown.message}`
    : thrown.name;
  if (!thrown.stack.startsWith(header)) {
    return undefined;
  }
  const frames = thrown.stack
    .slice(header.length)
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .slice(0, MAX_LOGGED_FRAMES);

  return frames.length > 0 ? [nameOf(thrown), ...frames].join('\n') : undefined;
};
