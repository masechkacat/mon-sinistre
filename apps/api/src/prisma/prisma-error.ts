import { HttpException, NotFoundException } from '@nestjs/common';
import { Prisma } from 'src/generated/prisma/client';

/**
 * Short on purpose: a code belongs here only when one answer is true for every
 * endpoint at once, and almost none are. P2002 is deliberately absent —
 * `apps/api/CLAUDE.md`, «Правила проекта».
 *
 * A Map rather than an object literal: the key comes off the error, and an
 * object literal answers `constructor` with something that is not a mapping.
 */
const HTTP_FOR_CODE = new Map<string, () => HttpException>([
  /** 404, not 403: ownership is part of the where clause, and a 403 would confirm the row exists. */
  ['P2025', () => new NotFoundException()],
]);

export const httpExceptionForPrisma = (
  exception: unknown,
): HttpException | undefined =>
  exception instanceof Prisma.PrismaClientKnownRequestError
    ? HTTP_FOR_CODE.get(exception.code)?.()
    : undefined;

/**
 * The code and the model — the only two things a Prisma error carries that are
 * safe to write down. The message quotes the values that failed the constraint
 * and `meta` holds the query arguments; in this product those are addresses and
 * inventory entries, which the logs may not hold.
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
