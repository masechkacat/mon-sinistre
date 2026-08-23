import { Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CommuneReferentialCheck } from './commune-referential.check';

/**
 * The check exists to break the silence of a `seed` that never ran, so what
 * matters is exactly when it speaks — a warning that never fires is the bug.
 * Rows missing the search key are no longer its business: the column is NOT
 * NULL, and the migration refuses them (commune-name-normalized.int-spec.ts).
 */
describe('CommuneReferentialCheck', () => {
  const runWith = async (total: number) => {
    const count = jest.fn<Promise<number>, []>().mockResolvedValue(total);
    const prisma = { commune: { count } } as unknown as PrismaService;
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await new CommuneReferentialCheck(prisma).onApplicationBootstrap();

    return warn;
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stays silent once the referential is imported', async () => {
    const warn = await runWith(34_945);

    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when the referential was migrated but never imported', async () => {
    const warn = await runWith(0);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('npm run seed');
  });
});
