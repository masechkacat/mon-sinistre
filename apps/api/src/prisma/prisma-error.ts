import {
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
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
 * Short on purpose — a code belongs here only when one answer is true for every
 * endpoint at once, and most are not.
 */
const HTTP_FOR_CODE: Record<string, () => HttpException> = {
  /**
   * The row the query addressed is not there — including the case where it
   * exists but belongs to someone else, because ownership is part of the where
   * clause (`../../CLAUDE.md`). 404 is exactly what that has to look like: a
   * 403 would confirm the object exists.
   */
  P2025: () => new NotFoundException(),

  /**
   * A unique constraint refused the write.
   *
   * Care is needed at any endpoint that takes an email address: answering 409
   * tells the sender that the address is already registered, and for the veille
   * that is an account-enumeration oracle. Such an endpoint must catch P2002
   * itself and answer as if the signup had succeeded — this mapping is the last
   * resort for a write nobody handled, not permission to leave one unhandled.
   */
  P2002: () => new ConflictException(),
};

/** The answer this failure deserves, or nothing if it is a failure of ours. */
export const httpExceptionForPrisma = (
  exception: unknown,
): HttpException | undefined =>
  exception instanceof Prisma.PrismaClientKnownRequestError
    ? HTTP_FOR_CODE[exception.code]?.()
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
