import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import type { FetchFn } from 'src/common/fetch-fn';
import { captureLogs } from 'src/mail/mail-log.test-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { DILA_JORFSIMPLE_BASE_URL, DilaClient } from './dila.client';
import { buildTarball } from './fixtures/build-tarball.test-helper';
import { JorfMonitorService, MAX_DELTAS_PER_RUN } from './jorf-monitor.service';

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

/** A delta whose issue lists no catnat text: nothing to parse, so a run over many of them costs only their downloads. */
const buildUnrelatedDeltaTarball = (): Promise<Buffer> =>
  buildTarball({
    'jorf/simple/JORF/CONT/2026/06/13/JORFCONT000000000001.xml':
      '<TEXTELIEN><LIEN_TXT idtxt="JORFTEXT000000000009" titretxt="Arrêté du 12 juin 2026 portant nomination"/></TEXTELIEN>',
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

  it('processes the newer deltas even when the oldest one keeps failing', async () => {
    const tarball = await buildDeltaTarball();
    currentFetch = stubFetch(
      [
        'JORFSIMPLE_20260612-060000.tar.gz',
        'JORFSIMPLE_20260613-060000.tar.gz',
      ],
      {
        // A file DILA never fixes: retrying it first every tick must not stop
        // everything published after it.
        'JORFSIMPLE_20260612-060000.tar.gz': new Error('ECONNRESET'),
        'JORFSIMPLE_20260613-060000.tar.gz': tarball,
      },
    );

    await monitor.run();

    expect(await prisma.arrete.count()).toBe(1);
    expect((await prisma.jorfDelta.findMany()).map((d) => d.fileName)).toEqual([
      'JORFSIMPLE_20260613-060000.tar.gz',
    ]);
  });

  it('caps a cold start at MAX_DELTAS_PER_RUN and takes the rest next run', async () => {
    const tarball = await buildUnrelatedDeltaTarball();
    const names = Array.from(
      { length: MAX_DELTAS_PER_RUN + 2 },
      (_, index) => `JORFSIMPLE_202606${String(index + 10)}-060000.tar.gz`,
    );
    currentFetch = stubFetch(
      names,
      Object.fromEntries(names.map((name) => [name, tarball])),
    );

    await monitor.run();

    expect(
      (await prisma.jorfDelta.findMany({ orderBy: { fileName: 'asc' } })).map(
        (d) => d.fileName,
      ),
    ).toEqual(names.slice(0, MAX_DELTAS_PER_RUN));

    await monitor.run();

    expect(await prisma.jorfDelta.count()).toBe(names.length);
  });

  it('logs a text listed in the table of contents but absent from the delta', async () => {
    currentFetch = stubFetch(['JORFSIMPLE_20260613-060000.tar.gz'], {
      'JORFSIMPLE_20260613-060000.tar.gz': await buildTarball({
        'jorf/simple/JORF/CONT/2026/06/13/JORFCONT000054245240.xml': tocXml,
      }),
    });

    await monitor.run();

    expect(await prisma.arrete.count()).toBe(0);
    expect(logs.text()).toContain('JORFTEXT000054245373');
  });
});
