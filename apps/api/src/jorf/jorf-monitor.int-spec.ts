import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import type { FetchFn } from 'src/common/fetch-fn';
import { captureLogs } from 'src/mail/mail-log.test-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { DILA_JORFSIMPLE_BASE_URL, DilaClient } from './dila.client';
import { buildTarball } from './fixtures/build-tarball.test-helper';
import { JorfMonitorService } from './jorf-monitor.service';

const tocXml = readFileSync(
  join(__dirname, 'fixtures/JORFCONT000054245240.xml'),
  'utf-8',
);
const arreteXml = readFileSync(
  join(__dirname, 'fixtures/JORFTEXT000054245373.xml'),
  'utf-8',
);

/** One catnat arrêté (NOR `INTE2615534A`, both annexes) plus the issue's table of contents — the same fixtures parse-arrete.spec.ts and dila.client.spec.ts read. */
const buildDeltaTarball = (): Promise<Buffer> =>
  buildTarball({
    'jorf/simple/JORF/CONT/2026/06/13/JORFCONT000054245240.xml': tocXml,
    'jorf/simple/JORF/CONT/2026/06/13/JORFTEXT000054245373.xml': arreteXml,
  });

/**
 * A `fetch` that serves a fixed listing and a fixed set of delta tarballs —
 * `downloads[name]` an `Error` rejects the download instead of serving it.
 */
function stubFetch(
  indexNames: string[],
  downloads: Record<string, Buffer | Error>,
): FetchFn {
  return jest.fn((url: string) => {
    if (url === DILA_JORFSIMPLE_BASE_URL) {
      const html = indexNames
        .map((name) => `<a href="${name}">${name}</a>`)
        .join('\n');
      return Promise.resolve(new Response(html, { status: 200 }));
    }
    const fileName = url.slice(DILA_JORFSIMPLE_BASE_URL.length);
    const download = downloads[fileName];
    if (download instanceof Error) {
      return Promise.reject(download);
    }
    if (!download) {
      return Promise.resolve(new Response('', { status: 404 }));
    }
    return Promise.resolve(
      new Response(new Uint8Array(download), { status: 200 }),
    );
  }) as unknown as FetchFn;
}

describe('JorfMonitorService.run (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let monitor: JorfMonitorService;
  // Reassigned per test so the app (and its DilaClient) is booted once.
  let currentFetch: FetchFn;
  const logs = captureLogs();

  beforeAll(async () => {
    app = await createIntTestApp({
      customize: (builder) =>
        builder
          .overrideProvider(DilaClient)
          .useValue(new DilaClient((...args) => currentFetch(...args))),
    });
    prisma = app.get(PrismaService);
    monitor = app.get(JorfMonitorService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "Arrete", "JorfDelta" CASCADE`;
  });

  it('creates an Arrete with both annexes and publishedAt from the XML (PRD #1)', async () => {
    const tarball = await buildDeltaTarball();
    currentFetch = stubFetch(['JORFSIMPLE_20260613-060000.tar.gz'], {
      'JORFSIMPLE_20260613-060000.tar.gz': tarball,
    });

    await monitor.run();

    const arrete = await prisma.arrete.findUnique({
      where: { nor: 'INTE2615534A' },
      include: { entries: true },
    });
    expect(arrete?.publishedAt.toISOString().slice(0, 10)).toBe('2026-06-13');
    expect(arrete?.jorfNumber).toBe('JORF n°0137 du 13 juin 2026');
    expect(
      arrete?.entries.filter((entry) => entry.outcome === 'RECONNU'),
    ).toHaveLength(183);
    expect(
      arrete?.entries.filter((entry) => entry.outcome === 'REFUSE'),
    ).toHaveLength(538);
    expect(
      await prisma.jorfDelta.findUnique({
        where: { fileName: 'JORFSIMPLE_20260613-060000.tar.gz' },
      }),
    ).not.toBeNull();
  });

  it('creates nothing on a repeat run of the same delta (PRD #2)', async () => {
    const tarball = await buildDeltaTarball();
    currentFetch = stubFetch(['JORFSIMPLE_20260613-060000.tar.gz'], {
      'JORFSIMPLE_20260613-060000.tar.gz': tarball,
    });

    await monitor.run();
    const downloadCallsAfterFirstRun = (currentFetch as jest.Mock).mock.calls
      .length;
    await monitor.run();

    expect(await prisma.arrete.count()).toBe(1);
    expect(await prisma.arreteEntry.count()).toBe(183 + 538);
    expect(await prisma.jorfDelta.count()).toBe(1);
    // The second run's downloadDelta is never called: the delta is already
    // marked processed, so only the listing fetch runs again.
    expect((currentFetch as jest.Mock).mock.calls.length).toBe(
      downloadCallsAfterFirstRun + 1,
    );
  });

  it('creates nothing when the same NOR is delivered again under a new delta (PRD #2)', async () => {
    const tarball = await buildDeltaTarball();
    currentFetch = stubFetch(['JORFSIMPLE_20260613-060000.tar.gz'], {
      'JORFSIMPLE_20260613-060000.tar.gz': tarball,
    });
    await monitor.run();

    // The evening delta re-delivers the same text under a new file name —
    // its content, and therefore its contentHash, is unchanged.
    currentFetch = stubFetch(
      [
        'JORFSIMPLE_20260613-060000.tar.gz',
        'JORFSIMPLE_20260613-230000.tar.gz',
      ],
      {
        'JORFSIMPLE_20260613-060000.tar.gz': tarball,
        'JORFSIMPLE_20260613-230000.tar.gz': tarball,
      },
    );
    await monitor.run();

    expect(await prisma.arrete.count()).toBe(1);
    expect(await prisma.arreteEntry.count()).toBe(183 + 538);
    expect(await prisma.jorfDelta.count()).toBe(2);
  });

  it('does not mark the delta when the download fails', async () => {
    currentFetch = stubFetch(['JORFSIMPLE_20260613-060000.tar.gz'], {
      'JORFSIMPLE_20260613-060000.tar.gz': new Error('ECONNRESET'),
    });

    await expect(monitor.run()).resolves.toBeUndefined();

    expect(await prisma.jorfDelta.count()).toBe(0);
    expect(await prisma.arrete.count()).toBe(0);
    // The failure is not silent — it is logged, not just swallowed.
    expect(logs.text()).toContain('JORFSIMPLE_20260613-060000.tar.gz');
  });
});
