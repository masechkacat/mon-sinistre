import { describe, it, expect, vi } from 'vitest';
import type { PrismaService } from 'src/prisma/prisma.service.js';
import { codesMergedInto } from './codes-merged-into.js';

type FindManyArgs = { where: { successorCodeInsee: { in: string[] } } };

/** A `Commune` table reduced to its successor edges, answering the one query
 * `codesMergedInto` issues per hop. */
function prismaWith(successorOf: Record<string, string>) {
  const findMany = vi.fn(({ where }: FindManyArgs) =>
    Promise.resolve(
      Object.entries(successorOf)
        .filter(([, successor]) =>
          where.successorCodeInsee.in.includes(successor),
        )
        .map(([codeInsee, successorCodeInsee]) => ({
          codeInsee,
          successorCodeInsee,
        })),
    ),
  );
  const prisma = { commune: { findMany } } as unknown as Pick<
    PrismaService,
    'commune'
  >;
  return { prisma, findMany };
}

const sorted = (codes: string[]) => [...codes].sort();

describe('codesMergedInto', () => {
  it('gives only the code itself for a commune nothing merged into', async () => {
    const { prisma, findMany } = prismaWith({});

    await expect(codesMergedInto(prisma, '30189')).resolves.toEqual(['30189']);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('adds the code of a commune merged into it', async () => {
    const { prisma } = prismaWith({ '30188': '30189' });

    expect(sorted(await codesMergedInto(prisma, '30189'))).toEqual([
      '30188',
      '30189',
    ]);
  });

  it('ignores a code that merged into another commune', async () => {
    const { prisma } = prismaWith({ '30188': '30007' });

    await expect(codesMergedInto(prisma, '30189')).resolves.toEqual(['30189']);
  });

  it('follows a chain of repeated mergers one query per hop', async () => {
    const { prisma, findMany } = prismaWith({
      '30187': '30188',
      '30188': '30189',
    });

    expect(sorted(await codesMergedInto(prisma, '30189'))).toEqual([
      '30187',
      '30188',
      '30189',
    ]);
    expect(findMany).toHaveBeenCalledTimes(3);
  });

  it('keeps only the code itself when the referential has a successor cycle, without looping', async () => {
    const { prisma, findMany } = prismaWith({
      '30188': '30189',
      '30189': '30188',
    });

    await expect(codesMergedInto(prisma, '30189')).resolves.toEqual(['30189']);
    expect(findMany).toHaveBeenCalledTimes(3);
  });
});
