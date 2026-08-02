import { Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CommuneSearchKeyCheck } from './commune-search-key.check';

/**
 * The check exists to break the silence of a skipped `npm run seed`, so what
 * matters is exactly when it speaks — a warning that never fires is the bug.
 */
describe('CommuneSearchKeyCheck', () => {
  const runWith = async (rows: { total: number; withoutKey: number }) => {
    const count = jest
      .fn<Promise<number>, [{ where?: unknown } | undefined]>()
      .mockImplementation((args) =>
        Promise.resolve(args?.where ? rows.withoutKey : rows.total),
      );
    const prisma = { commune: { count } } as unknown as PrismaService;
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await new CommuneSearchKeyCheck(prisma).onApplicationBootstrap();

    return warn;
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stays silent when every commune carries a search key', async () => {
    const warn = await runWith({ total: 34_945, withoutKey: 0 });

    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when the referential was migrated but never imported', async () => {
    const warn = await runWith({ total: 0, withoutKey: 0 });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('npm run seed');
  });

  it('warns with the counters when the backfill was skipped', async () => {
    const warn = await runWith({ total: 34_945, withoutKey: 34_945 });

    expect(warn).toHaveBeenCalledTimes(1);
    // Counters only — no commune name or code reaches the log.
    expect(warn.mock.calls[0]?.[0]).toContain('34945 of 34945');
  });

  it('warns on a partial backfill too', async () => {
    const warn = await runWith({ total: 34_945, withoutKey: 12 });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('12 of 34945');
  });
});
