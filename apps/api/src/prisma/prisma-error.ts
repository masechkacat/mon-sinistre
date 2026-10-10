import { HttpException, NotFoundException } from '@nestjs/common';
import { Prisma } from 'src/generated/prisma/client';

/** `P2025` — a conditional `update`/`delete` whose filter matched no row. */
export const isRecordNotFound = (exception: unknown): boolean =>
  exception instanceof Prisma.PrismaClientKnownRequestError &&
  exception.code === 'P2025';

/**
 * A conditional write whose filter matching no row is an answer, not an
 * error: `null` instead of `P2025`. Every "row vanished mid-flight" race
 * guard is this call; anything else Prisma throws still propagates.
 */
export const nullIfRecordNotFound = async <T>(
  write: () => Promise<T>,
): Promise<T | null> => {
  try {
    return await write();
  } catch (error) {
    if (isRecordNotFound(error)) return null;
    throw error;
  }
};

/**
 * Short on purpose: a code is mapped here only when one answer is true for
 * every endpoint at once, and almost none are. P2002 is deliberately absent —
 * `apps/api/CLAUDE.md`, «Правила проекта». 404, not 403: ownership is part of
 * the where clause, and a 403 would confirm the row exists.
 */
export const httpExceptionForPrisma = (
  exception: unknown,
): HttpException | undefined =>
  isRecordNotFound(exception) ? new NotFoundException() : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * `P2002` on a named column — for the endpoint that has to catch it itself
 * (`../../CLAUDE.md`, «Правила проекта»).
 *
 * `meta.target`, which every Prisma 5/6 answer to this question reads, does not
 * exist behind a driver adapter: v7 passes the driver's own error through under
 * `meta.driverAdapterError.cause`. Reading `target` here would silently return
 * false for every duplicate. Since 7.10 the Postgres adapter reports the
 * constraint by name (`constraint.index`) and only falls back to the parsed
 * columns (`constraint.fields`) when Postgres sent no name. Two names are
 * understood: `<Table>_<column>_key`, a single-column `@unique`, and
 * `<Table>_pkey`, the primary key — which names no column, so it is taken as
 * the asked-for one: a caller asks about the column it has just written.
 */
export const isUniqueViolationOn = (
  exception: unknown,
  field: string,
): boolean => {
  if (
    !(exception instanceof Prisma.PrismaClientKnownRequestError) ||
    exception.code !== 'P2002'
  ) {
    return false;
  }
  const cause = asRecord(
    asRecord(asRecord(exception.meta)?.driverAdapterError)?.cause,
  );
  const constraint = asRecord(cause?.constraint);
  if (typeof constraint?.index === 'string') {
    const table = typeof cause?.table === 'string' ? cause.table : undefined;
    return (
      table !== undefined &&
      [`${table}_${field}_key`, `${table}_pkey`].includes(constraint.index)
    );
  }
  const fields = constraint?.fields;
  return Array.isArray(fields) && fields.includes(field);
};

/**
 * `P2003` — a `create`'s foreign key no longer resolves, because the parent
 * row was deleted by a concurrent request between the read that chose this
 * write and the write itself. Unlike `P2002` above, no field name is needed:
 * every caller of this so far has exactly one FK to check.
 */
export const isForeignKeyViolation = (exception: unknown): boolean =>
  exception instanceof Prisma.PrismaClientKnownRequestError &&
  exception.code === 'P2003';

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
