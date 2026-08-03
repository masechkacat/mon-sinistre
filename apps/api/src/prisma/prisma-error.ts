import { HttpException, NotFoundException } from '@nestjs/common';
import { Prisma } from 'src/generated/prisma/client';

/**
 * What a failed query looks like from outside, and what may be said about it.
 *
 * It lives here rather than in the exception filter because knowing Prisma is
 * this module's job: the filter turns exceptions into answers and has no
 * business importing a generated client.
 */

/**
 * The codes that describe the caller's mistake rather than a failure of ours.
 *
 * One entry, and adding a second is a decision, not a convenience: a code
 * belongs here only when one answer is true for every endpoint at once, and
 * almost none are. **P2002** — a unique constraint refused the write — is the
 * one to argue about, because 409 looks obviously right and is not. At any
 * endpoint that takes an email address a 409 tells the sender that the address
 * is already registered, which for the veille is an account-enumeration oracle;
 * mapping it here would make that the answer of every endpoint written
 * afterwards, with a line of documentation as the only thing in the way. So it
 * is absent, and a write that really owes the caller a 409 catches P2002 where
 * the endpoint is in front of the author. Unmapped, it stays a 500 recorded by
 * code and model like any other failure (`docs/decisions.md`, 03.08.2026).
 *
 * A Map rather than an object literal: the key comes off the error, and an
 * object literal answers `constructor` with something that is not a mapping.
 */
const HTTP_FOR_CODE = new Map<string, () => HttpException>([
  /**
   * The row the query addressed is not there — including the case where it
   * exists but belongs to someone else, because ownership is part of the where
   * clause (`../../CLAUDE.md`). 404 is exactly what that has to look like: a
   * 403 would confirm the object exists.
   */
  ['P2025', () => new NotFoundException()],
]);

/** The answer this failure deserves, or nothing if it is a failure of ours. */
export const httpExceptionForPrisma = (
  exception: unknown,
): HttpException | undefined =>
  exception instanceof Prisma.PrismaClientKnownRequestError
    ? HTTP_FOR_CODE.get(exception.code)?.()
    : undefined;

/**
 * The code and the model it happened on — the only two things a Prisma error
 * carries that are safe to write down.
 *
 * Everything else in it describes the data: the message quotes the values that
 * failed the constraint, and `meta` holds the arguments of the query. In this
 * product those are postal addresses and inventory entries, which the logs may
 * not hold (`../../CLAUDE.md`). A code and a model name are schema, not data,
 * and they are enough to find the query that failed.
 */
export const prismaErrorDetail = (exception: unknown): string | undefined => {
  if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) {
    return undefined;
  }
  const model = exception.meta?.modelName;
  return typeof model === 'string'
    ? `${exception.code} on ${model}`
    : exception.code;
};
