import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { toIsoDate } from '@mon-sinistre/contracts';
import { createIntTestApp } from 'src/app.int-helper';
import type { FetchFn } from 'src/common/fetch-fn';
import { commune as communeFixture } from 'src/communes/commune.test-helper';
import { seedDeadlineRules } from 'src/deadline-rules/deadline-rule.seed';
import { captureLogs } from 'src/mail/mail-log.test-helper';
import { MailDeliveryError } from 'src/mail/mail-delivery.error';
import { MAIL_TRANSPORT } from 'src/mail/mail-transport';
import { RecordingTransport } from 'src/mail/mail-transport.test-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { createVeille } from 'src/veille/veille.test-helper';
import { DILA_JORFSIMPLE_BASE_URL, DilaClient } from './dila.client';
import { buildTarball } from './fixtures/build-tarball.test-helper';
import {
  JorfMonitorService,
  MAX_DELTAS_PER_RUN,
  NOTIFICATION_ATTEMPTS_BEFORE_ALERT,
} from './jorf-monitor.service';

/** Row/table/annexe builders shared by the rectificatif and alert describes below — same tag layout as the DILA fixture (parse-arrete.spec.ts), built from scratch so each test controls exactly which entries it puts in. */
const row = (cells: string[]) =>
  `<tr>${cells.map((cell) => `<td><br/>${cell}</td>`).join('')}</tr>`;
const table = (rows: string[][]) =>
  `<table border="1">${row([
    'Département',
    'Commune',
    'Phénomène naturel',
    'Date de début',
    'Date de fin',
  ])}${rows.map(row).join('')}</table>`;
const annexeSection = (caption: string, rows: string[][]) =>
  rows.length === 0
    ? ''
    : `<SECTION_TA><TITRE_TA>Annexe</TITRE_TA><ARTICLE><BLOC_TEXTUEL><CONTENU>
         <p>${caption}</p>
         ${table(rows)}
       </CONTENU></BLOC_TEXTUEL></ARTICLE></SECTION_TA>`;

interface ArreteRevision {
  reconnues?: string[][];
  nonReconnues?: string[][];
  /** Only a rectificatif that moves the déclaration deadline names it. */
  publishedAt?: string;
}

const buildArreteXml = (
  options: ArreteRevision & { id: string; nor: string; title: string },
) => `<?xml version="1.0"?>
  <TEXTE>
    <NATURE>ARRETE</NATURE>
    <ID>${options.id}</ID>
    <NOR>${options.nor}</NOR>
    <TITREFULL>${options.title}</TITREFULL>
    <DATE_TEXTE>2026-06-30</DATE_TEXTE>
    <DATE_PUBLI>${options.publishedAt ?? '2026-07-01'}</DATE_PUBLI>
    <ORIGINE_PUBLI>JORF n°0150 du 1 juillet 2026</ORIGINE_PUBLI>
    <STRUCT>
      ${annexeSection(
        'Communes reconnues en état de catastrophe naturelle',
        options.reconnues ?? [],
      )}
      ${annexeSection(
        'Communes non reconnues en état de catastrophe naturelle',
        options.nonReconnues ?? [],
      )}
    </STRUCT>
  </TEXTE>`;

const buildTocXml = (id: string, title: string) =>
  `<TEXTELIEN><LIEN_TXT idtxt="${id}" titretxt="${title}"/></TEXTELIEN>`;

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
    await prisma.$executeRaw`TRUNCATE TABLE "Arrete", "JorfDelta", "MonitorLock", "MonitorAlert", "Commune" CASCADE`;
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

  describe('backfill scope (issue #108)', () => {
    it('resumes only the delta an interrupted backfill left unprocessed', async () => {
      const FIRST = 'JORFSIMPLE_20260101-060000.tar.gz';
      const SECOND = 'JORFSIMPLE_20260613-060000.tar.gz';
      // Simulates an earlier run of the script that got through FIRST and
      // was then interrupted, same as a normal tick's JorfDelta bookkeeping —
      // the backfill script relies on nothing more than this.
      await prisma.jorfDelta.create({
        data: { fileName: FIRST, processedAt: new Date() },
      });
      currentFetch = stubFetch([], { [SECOND]: await buildDeltaTarball() });

      await monitor.run(false, { deltaNames: [FIRST, SECOND] });

      expect(
        (await prisma.jorfDelta.findMany({ orderBy: { fileName: 'asc' } })).map(
          (d) => d.fileName,
        ),
      ).toEqual([FIRST, SECOND]);
      expect(await prisma.arrete.count()).toBe(1);
    });

    it('skips creating an arrêté whose publication predates the backfill floor', async () => {
      const DELTA = 'JORFSIMPLE_20260101-060000.tar.gz';
      const NOR = 'INTJ2600099A';
      const ID = 'JORFTEXT000000009901';
      const TITLE =
        "Arrêté du 20 décembre 2025 portant reconnaissance de l'état de catastrophe naturelle";
      const tarball = await buildTarball({
        'jorf/simple/JORF/CONT/2026/01/01/JORFCONT9901.xml': buildTocXml(
          ID,
          TITLE,
        ),
        [`jorf/simple/JORF/CONT/2026/01/01/${ID}.xml`]: buildArreteXml({
          id: ID,
          nor: NOR,
          title: TITLE,
          publishedAt: '2025-12-20',
          reconnues: [
            ['Aisne', 'Amigny-Rouy', 'Inondations', '01/12/2025', '02/12/2025'],
          ],
        }),
      });
      currentFetch = stubFetch([], { [DELTA]: tarball });

      await monitor.run(false, {
        deltaNames: [DELTA],
        minPublishedAt: toIsoDate('2026-01-01'),
      });

      expect(await prisma.arrete.count()).toBe(0);
      // The text was still dealt with — the delta is marked, not retried.
      expect(await prisma.jorfDelta.count()).toBe(1);
    });
  });

  describe('cross-process ingest lock', () => {
    const DELTA = 'JORFSIMPLE_20260613-060000.tar.gz';

    it("skips the tick while another process's lease is live, and runs once it is released", async () => {
      currentFetch = stubFetch([DELTA], { [DELTA]: await buildDeltaTarball() });
      const backfill = randomUUID();
      expect(await monitor.acquireIngestLock(backfill)).toBe(true);

      await monitor.run();
      expect(await prisma.jorfDelta.count()).toBe(0);

      await monitor.releaseIngestLock(backfill);
      await monitor.run();
      expect(await prisma.jorfDelta.count()).toBe(1);
    });

    it('a run under the backfill owner renews the lease instead of releasing it', async () => {
      currentFetch = stubFetch([], { [DELTA]: await buildDeltaTarball() });
      const backfill = randomUUID();
      expect(await monitor.acquireIngestLock(backfill)).toBe(true);

      await monitor.run(false, { deltaNames: [DELTA], lockOwner: backfill });

      expect(await prisma.jorfDelta.count()).toBe(1);
      // Still held: the next scheduled tick would keep skipping itself.
      expect(await monitor.acquireIngestLock(randomUUID())).toBe(false);
      await monitor.releaseIngestLock(backfill);
    });

    it('takes over an expired lease and releases its own after the run', async () => {
      currentFetch = stubFetch([DELTA], { [DELTA]: await buildDeltaTarball() });
      expect(await monitor.acquireIngestLock(randomUUID())).toBe(true);
      await prisma.monitorLock.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await monitor.run();

      expect(await prisma.jorfDelta.count()).toBe(1);
      expect(await monitor.acquireIngestLock(randomUUID())).toBe(true);
    });
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

  describe('rectificatif path (issue #100)', () => {
    const RECT_NOR = 'INTJ2600001A';
    const RECT_TITLE =
      "Arrêté du 1er juillet 2026 portant reconnaissance de l'état de catastrophe naturelle";
    const AMIGNY = [
      'Aisne',
      'Amigny-Rouy',
      'Inondations',
      '01/01/2026',
      '02/01/2026',
    ];
    const MUSSIDAN = [
      'Dordogne',
      'Mussidan',
      'Inondations',
      '03/01/2026',
      '04/01/2026',
    ];
    const AMIGNY_JUSQU_AU_5 = [
      'Aisne',
      'Amigny-Rouy',
      'Inondations',
      '01/01/2026',
      '05/01/2026',
    ];
    const MORNING = 'JORFSIMPLE_20260701-060000.tar.gz';
    const EVENING = 'JORFSIMPLE_20260701-230000.tar.gz';
    const TEXT_ID = 'JORFTEXT000000000201';

    let served: Record<string, Buffer>;
    beforeEach(() => {
      served = {};
    });

    /**
     * Publishes one revision of the same NOR as the named delta, keeping the
     * deltas published before it on the listing the way DILA does: a
     * rectificatif is two runs — the morning delta, then the evening one
     * carrying the corrected text.
     */
    const serve = async (delta: string, revision: ArreteRevision) => {
      served[delta] = await buildTarball({
        'jorf/simple/JORF/CONT/2026/07/01/JORFCONT000000000200.xml':
          buildTocXml(TEXT_ID, RECT_TITLE),
        [`jorf/simple/JORF/CONT/2026/07/01/${TEXT_ID}.xml`]: buildArreteXml({
          id: TEXT_ID,
          nor: RECT_NOR,
          title: RECT_TITLE,
          ...revision,
        }),
      });
      currentFetch = stubFetch(Object.keys(served), served);
    };

    it('upserts entries on a rectificatif and alerts on an outcome change (PRD #3, #11)', async () => {
      await serve(MORNING, { reconnues: [AMIGNY] });
      await monitor.run();

      const original = await prisma.arrete.findUnique({
        where: { nor: RECT_NOR },
        include: { entries: true },
      });
      expect(original?.entries).toHaveLength(1);
      expect(original?.entries[0]).toMatchObject({
        communeLabelRaw: 'Amigny-Rouy',
        outcome: 'RECONNU',
      });

      // The rectificatif flips Amigny-Rouy to refusé (outcome change on an
      // existing entry) and adds Mussidan as a newly recognized commune —
      // both entries change, so the parsed contentHash differs too.
      await serve(EVENING, { reconnues: [MUSSIDAN], nonReconnues: [AMIGNY] });
      await monitor.run();

      expect(await prisma.arrete.count()).toBe(1);
      const rectified = await prisma.arrete.findUnique({
        where: { nor: RECT_NOR },
        include: { entries: true },
      });
      expect(rectified?.entries).toHaveLength(2);
      expect(
        rectified?.entries.find((e) => e.communeLabelRaw === 'Amigny-Rouy'),
      ).toMatchObject({ outcome: 'REFUSE' });
      expect(
        rectified?.entries.find((e) => e.communeLabelRaw === 'Mussidan'),
      ).toMatchObject({ outcome: 'RECONNU' });

      const alerts = await prisma.monitorAlert.findMany({
        where: { kind: 'OUTCOME_CHANGED' },
      });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ arreteId: rectified?.id });
      expect(alerts[0]?.detail).toContain('Amigny-Rouy');
      expect(alerts[0]?.detail).not.toMatch(/@/);
    });

    it('moves the dates of a corrected entry instead of adding a second row', async () => {
      await serve(MORNING, { reconnues: [AMIGNY] });
      await monitor.run();

      // « Au lieu de : du 1er au 2 janvier, lire : du 1er au 5 janvier » — the
      // everyday rectificatif, and the one that moves the very dates an entry
      // is identified by.
      await serve(EVENING, { reconnues: [AMIGNY_JUSQU_AU_5] });
      await monitor.run();

      const entries = await prisma.arreteEntry.findMany();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.eventEnd.toISOString().slice(0, 10)).toBe(
        '2026-01-05',
      );
    });

    it('adds a line for a risque the commune was not listed under, correcting the one it was', async () => {
      await serve(MORNING, { reconnues: [AMIGNY] });
      await monitor.run();

      // Same commune, two lines: the flood dates are corrected and a landslide
      // is added. A phenomenon this arrêté never listed for the commune is an
      // addition, not a correction — reading it as one would overwrite the
      // flood line and lose it.
      const AMIGNY_GLISSEMENT = [
        'Aisne',
        'Amigny-Rouy',
        'Mouvements de terrain',
        '01/01/2026',
        '02/01/2026',
      ];
      await serve(EVENING, {
        reconnues: [AMIGNY_JUSQU_AU_5, AMIGNY_GLISSEMENT],
      });
      await monitor.run();

      const entries = await prisma.arreteEntry.findMany();
      expect(
        entries
          .map((e) => `${e.risque} → ${e.eventEnd.toISOString().slice(0, 10)}`)
          .sort(),
      ).toEqual([
        'Inondations → 2026-01-05',
        'Mouvements de terrain → 2026-01-02',
      ]);
    });

    it('leaves the rows a rectificatif does not mention untouched', async () => {
      await serve(MORNING, { reconnues: [AMIGNY] });
      await monitor.run();
      const before = await prisma.arreteEntry.findFirstOrThrow();

      await serve(EVENING, { reconnues: [AMIGNY, MUSSIDAN] });
      await monitor.run();

      // updatedAt means "someone touched this row" (schema.prisma): rewriting
      // every line of a real arrêté — ~720 of them — would erase that signal
      // and spend the transaction on rows the rectificatif never named.
      const after = await prisma.arreteEntry.findUniqueOrThrow({
        where: { id: before.id },
      });
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(await prisma.arreteEntry.count()).toBe(2);
    });

    it('rewrites the misprinted commune of an unmatched line instead of adding a second one', async () => {
      await prisma.commune.create({
        data: communeFixture('02005', 'Amigny-Rouy', '02', 'Aisne'),
      });
      // Printed with a typo, so the referential resolves nothing and the line
      // is stored unmatched — the label is both what went wrong and the only
      // thing left to recognize the line by.
      await serve(MORNING, {
        reconnues: [
          ['Aisne', 'Amigni-Roui', 'Inondations', '01/01/2026', '02/01/2026'],
        ],
      });
      await monitor.run();
      expect(await prisma.arreteEntry.findFirstOrThrow()).toMatchObject({
        codeInsee: null,
      });

      await serve(EVENING, { reconnues: [AMIGNY] });
      await monitor.run();

      const entries = await prisma.arreteEntry.findMany();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        codeInsee: '02005',
        communeLabelRaw: 'Amigny-Rouy',
      });
    });

    it('alerts once about a commune the referential keeps failing to resolve', async () => {
      await serve(MORNING, { reconnues: [AMIGNY] });
      await monitor.run();

      await serve(EVENING, { reconnues: [AMIGNY, MUSSIDAN] });
      await monitor.run();

      // Amigny-Rouy is unmatched in both revisions — a fusion the COG doesn't
      // carry yet never resolves, and the operator works through this table by
      // hand. Mussidan is new, so it does alert.
      const alerts = await prisma.monitorAlert.findMany({
        where: { kind: 'UNMATCHED_COMMUNE' },
      });
      expect(
        alerts.filter((alert) => alert.detail.includes('Amigny-Rouy')),
      ).toHaveLength(1);
      expect(alerts).toHaveLength(2);
    });

    it('takes the publication date of the corrected text', async () => {
      await serve(MORNING, { reconnues: [AMIGNY] });
      await monitor.run();

      await serve(EVENING, { reconnues: [AMIGNY], publishedAt: '2026-07-02' });
      await monitor.run();

      // The anchor of the 30-day déclaration deadline: it comes from the XML
      // and nowhere else, and contentHash is computed over it, so a row that
      // kept the old date would no longer be described by its own hash.
      const arrete = await prisma.arrete.findUniqueOrThrow({
        where: { nor: RECT_NOR },
      });
      expect(arrete.publishedAt.toISOString().slice(0, 10)).toBe('2026-07-02');
      expect(logs.text()).toContain('publication date');
    });

    it('does not create an Arrete for a rectificatif Z-text, and alerts about it once', async () => {
      const zNor = 'INTJ2600002Z';
      const zTitle =
        "Arrêté du 1er juillet 2026 portant reconnaissance de l'état de catastrophe naturelle (rectificatif)";
      const zId = 'JORFTEXT000000000301';
      const zXml = `<?xml version="1.0"?>
        <TEXTE>
          <NATURE>ARRETE</NATURE>
          <ID>${zId}</ID>
          <NOR>${zNor}</NOR>
          <TITREFULL>${zTitle}</TITREFULL>
          <DATE_TEXTE>2026-06-30</DATE_TEXTE>
          <DATE_PUBLI>2026-07-01</DATE_PUBLI>
          <ORIGINE_PUBLI>JORF n°0150 du 1 juillet 2026</ORIGINE_PUBLI>
          <BLOC_TEXTUEL><CONTENU><p>Au lieu de : lire :</p></CONTENU></BLOC_TEXTUEL>
        </TEXTE>`;
      const tocXml = buildTocXml(zId, zTitle);
      const tarball = await buildTarball({
        'jorf/simple/JORF/CONT/2026/07/01/JORFCONT000000000300.xml': tocXml,
        [`jorf/simple/JORF/CONT/2026/07/01/${zId}.xml`]: zXml,
      });
      currentFetch = stubFetch([MORNING], { [MORNING]: tarball });
      await monitor.run();
      // DILA re-delivers the text in the evening delta, and in every later one
      // it belongs to: the same unread text must not fill the table row by row.
      currentFetch = stubFetch([MORNING, EVENING], {
        [MORNING]: tarball,
        [EVENING]: tarball,
      });
      await monitor.run();

      expect(
        await prisma.arrete.findUnique({ where: { nor: zNor } }),
      ).toBeNull();
      const alerts = await prisma.monitorAlert.findMany({
        where: { kind: 'UNPARSEABLE_ANNEXE' },
      });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.detail).toContain(zNor.slice(0, 11));
      expect(alerts[0]?.detail).not.toMatch(/@/);
    });
  });

  describe('parsing and matching alerts (issue #101)', () => {
    it("alerts on an unparseable annexe and still ingests the delta's other arrêté (PRD #9)", async () => {
      const brokenId = 'JORFTEXT000000000401';
      const brokenNor = 'INTJ2600004A';
      const brokenTitle =
        "Arrêté du 5 juillet 2026 portant reconnaissance de l'état de catastrophe naturelle";
      // A header this parser doesn't recognize — parseAnnexeTable throws
      // before any row is read, the same failure a real structural drift
      // would cause.
      const brokenXml = `<?xml version="1.0"?>
        <TEXTE>
          <NATURE>ARRETE</NATURE>
          <ID>${brokenId}</ID>
          <NOR>${brokenNor}</NOR>
          <TITREFULL>${brokenTitle}</TITREFULL>
          <DATE_TEXTE>2026-07-04</DATE_TEXTE>
          <DATE_PUBLI>2026-07-05</DATE_PUBLI>
          <ORIGINE_PUBLI>JORF n°0151 du 5 juillet 2026</ORIGINE_PUBLI>
          <STRUCT>
            <SECTION_TA><TITRE_TA>Annexe</TITRE_TA><ARTICLE><BLOC_TEXTUEL><CONTENU>
              <p>Communes reconnues en état de catastrophe naturelle</p>
              <table border="1"><tr><td><br/>Colonne inconnue</td></tr></table>
            </CONTENU></BLOC_TEXTUEL></ARTICLE></SECTION_TA>
          </STRUCT>
        </TEXTE>`;

      const goodId = 'JORFTEXT000000000501';
      const goodNor = 'INTJ2600005A';
      const goodTitle =
        "Arrêté du 5 juillet 2026 portant reconnaissance de l'état de catastrophe naturelle";
      const goodXml = buildArreteXml({
        id: goodId,
        nor: goodNor,
        title: goodTitle,
        reconnues: [
          ['Gironde', 'Bordeaux', 'Inondations', '01/01/2026', '02/01/2026'],
        ],
      });

      const tarball = await buildTarball({
        'jorf/simple/JORF/CONT/2026/07/05/JORFCONT000000000400.xml':
          buildTocXml(brokenId, brokenTitle),
        [`jorf/simple/JORF/CONT/2026/07/05/${brokenId}.xml`]: brokenXml,
        'jorf/simple/JORF/CONT/2026/07/05/JORFCONT000000000500.xml':
          buildTocXml(goodId, goodTitle),
        [`jorf/simple/JORF/CONT/2026/07/05/${goodId}.xml`]: goodXml,
      });
      currentFetch = stubFetch(['JORFSIMPLE_20260705-060000.tar.gz'], {
        'JORFSIMPLE_20260705-060000.tar.gz': tarball,
      });

      await monitor.run();

      const alerts = await prisma.monitorAlert.findMany({
        where: { kind: 'UNPARSEABLE_ANNEXE' },
      });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.detail).toContain(brokenId);
      expect(alerts[0]?.detail).not.toMatch(/@/);

      expect(
        await prisma.arrete.findUnique({ where: { nor: goodNor } }),
      ).not.toBeNull();
    });

    it('leaves the delta unmarked when a parsed text cannot be written, and ingests it next run', async () => {
      const tarball = await buildDeltaTarball();
      currentFetch = stubFetch(['JORFSIMPLE_20260613-060000.tar.gz'], {
        'JORFSIMPLE_20260613-060000.tar.gz': tarball,
      });
      // The text parses; the write behind it doesn't go through — a dropped
      // connection, a statement timeout. Nothing about the JO is wrong here.
      const transaction = jest
        .spyOn(prisma, '$transaction')
        .mockRejectedValueOnce(new Error('P1001 database unreachable'));

      await monitor.run();

      expect(await prisma.arrete.count()).toBe(0);
      // Marking it would retire the delta with the arrêté still unread, and
      // an UNPARSEABLE_ANNEXE alert would send the operator after a parser
      // that works.
      expect(await prisma.jorfDelta.count()).toBe(0);
      expect(await prisma.monitorAlert.count()).toBe(0);
      expect(logs.text()).toContain('JORFTEXT000054245373');

      transaction.mockRestore();
      await monitor.run();

      expect(
        await prisma.arrete.findUnique({ where: { nor: 'INTE2615534A' } }),
      ).not.toBeNull();
      expect(await prisma.jorfDelta.count()).toBe(1);
    });

    it('saves an entry with an unmatched commune as codeInsee: null and alerts, matched entries unaffected (PRD #10)', async () => {
      await prisma.commune.create({
        data: communeFixture('33063', 'Bordeaux', '33', 'Gironde'),
      });

      const id = 'JORFTEXT000000000601';
      const nor = 'INTJ2600006A';
      const title =
        "Arrêté du 6 juillet 2026 portant reconnaissance de l'état de catastrophe naturelle";
      const xml = buildArreteXml({
        id,
        nor,
        title,
        reconnues: [
          ['Gironde', 'Bordeaux', 'Inondations', '01/01/2026', '02/01/2026'],
          [
            'Département Fictif',
            'Commune Fictive',
            'Inondations',
            '03/01/2026',
            '04/01/2026',
          ],
        ],
      });
      const tarball = await buildTarball({
        'jorf/simple/JORF/CONT/2026/07/06/JORFCONT000000000600.xml':
          buildTocXml(id, title),
        [`jorf/simple/JORF/CONT/2026/07/06/${id}.xml`]: xml,
      });
      currentFetch = stubFetch(['JORFSIMPLE_20260706-060000.tar.gz'], {
        'JORFSIMPLE_20260706-060000.tar.gz': tarball,
      });

      await monitor.run();

      const arrete = await prisma.arrete.findUnique({
        where: { nor },
        include: { entries: true },
      });
      expect(
        arrete?.entries.find((e) => e.communeLabelRaw === 'Bordeaux'),
      ).toMatchObject({ codeInsee: '33063' });
      expect(
        arrete?.entries.find((e) => e.communeLabelRaw === 'Commune Fictive'),
      ).toMatchObject({ codeInsee: null });

      const alerts = await prisma.monitorAlert.findMany({
        where: { kind: 'UNMATCHED_COMMUNE' },
      });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ arreteId: arrete?.id });
      expect(alerts[0]?.detail).toContain('Commune Fictive');
      expect(alerts[0]?.detail).not.toMatch(/@/);
    });

    it('alerts when a rectificatif updates a previously matched entry to an unmatched commune', async () => {
      await prisma.commune.create({
        data: communeFixture('33063', 'Bordeaux', '33', 'Gironde'),
      });

      const id = 'JORFTEXT000000000701';
      const nor = 'INTJ2600007A';
      const title =
        "Arrêté du 7 juillet 2026 portant reconnaissance de l'état de catastrophe naturelle";
      const bordeaux = [
        'Gironde',
        'Bordeaux',
        'Inondations',
        '01/01/2026',
        '02/01/2026',
      ];
      const tocXml = buildTocXml(id, title);
      const firstTarball = await buildTarball({
        'jorf/simple/JORF/CONT/2026/07/07/JORFCONT000000000700.xml': tocXml,
        [`jorf/simple/JORF/CONT/2026/07/07/${id}.xml`]: buildArreteXml({
          id,
          nor,
          title,
          reconnues: [bordeaux],
        }),
      });
      currentFetch = stubFetch(['JORFSIMPLE_20260707-060000.tar.gz'], {
        'JORFSIMPLE_20260707-060000.tar.gz': firstTarball,
      });
      await monitor.run();

      const matched = await prisma.arrete.findUnique({
        where: { nor },
        include: { entries: true },
      });
      expect(matched?.entries[0]).toMatchObject({ codeInsee: '33063' });

      // The referential's search key changes under the row (e.g. a COG
      // rename) between runs — the rectificatif reprints the same label as
      // before, but this time nothing resolves it; the row can't be deleted
      // outright, `ArreteEntry.codeInsee` still points at it (RESTRICT). A
      // second entry is added purely to change the contentHash so the run
      // takes the rectificatif path, not the unchanged-content shortcut.
      await prisma.commune.update({
        where: { codeInsee: '33063' },
        data: { nameNormalized: 'ex-bordeaux' },
      });
      const lyon = ['Rhône', 'Lyon', 'Inondations', '03/01/2026', '04/01/2026'];
      const secondTarball = await buildTarball({
        'jorf/simple/JORF/CONT/2026/07/07/JORFCONT000000000700.xml': tocXml,
        [`jorf/simple/JORF/CONT/2026/07/07/${id}.xml`]: buildArreteXml({
          id,
          nor,
          title,
          reconnues: [bordeaux, lyon],
        }),
      });
      currentFetch = stubFetch(
        [
          'JORFSIMPLE_20260707-060000.tar.gz',
          'JORFSIMPLE_20260707-230000.tar.gz',
        ],
        {
          'JORFSIMPLE_20260707-060000.tar.gz': firstTarball,
          'JORFSIMPLE_20260707-230000.tar.gz': secondTarball,
        },
      );
      await monitor.run();

      const rectified = await prisma.arrete.findUnique({
        where: { nor },
        include: { entries: true },
      });
      expect(rectified?.entries).toHaveLength(2);
      expect(
        rectified?.entries.find((e) => e.communeLabelRaw === 'Bordeaux'),
      ).toMatchObject({ codeInsee: null });

      // Lyon was never in the referential either, so it alerts too — this
      // asserts specifically on the entry that flipped from matched to
      // unmatched, not on the total alert count.
      const bordeauxAlert = await prisma.monitorAlert.findFirst({
        where: { kind: 'UNMATCHED_COMMUNE', detail: { contains: 'Bordeaux' } },
      });
      expect(bordeauxAlert).toMatchObject({ arreteId: rectified?.id });
    });
  });
});

describe('admin alert email (issue #102)', () => {
  const ADMIN_EMAIL = 'admin@mon-sinistre.test';
  const originalAdminEmail = process.env.ADMIN_EMAIL;

  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let monitor: JorfMonitorService;
  let transport: RecordingTransport;
  let currentFetch: FetchFn;

  beforeAll(async () => {
    // Read by ConfigModule when the app below compiles — this describe's own
    // app, never the one of the outer suite, which boots without it.
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    transport = new RecordingTransport();
    app = await createIntTestApp({
      customize: (builder) =>
        builder
          .overrideProvider(DilaClient)
          .useValue(new DilaClient((...args) => currentFetch(...args)))
          .overrideProvider(MAIL_TRANSPORT)
          .useValue(transport),
    });
    prisma = app.get(PrismaService);
    monitor = app.get(JorfMonitorService);
  });

  afterAll(async () => {
    await app.close();
    if (originalAdminEmail === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = originalAdminEmail;
    }
  });

  beforeEach(async () => {
    transport.sent.length = 0;
    transport.failNext = false;
    await prisma.$executeRaw`TRUNCATE TABLE "Arrete", "JorfDelta", "MonitorLock", "MonitorAlert", "Commune" CASCADE`;
  });

  /** An arrêté whose communes the (empty) referential cannot resolve — the
   * simplest of the three alert kinds to trigger, one UNMATCHED_COMMUNE row
   * per commune named. */
  const buildUnmatchedCommuneTarball = (
    fileSuffix: string,
    communes: string[] = ['Commune Fictive'],
  ) => {
    const id = `JORFTEXT00000000${fileSuffix}`;
    const nor = `INTJ260000${fileSuffix}A`;
    const title =
      "Arrêté du 10 juillet 2026 portant reconnaissance de l'état de catastrophe naturelle";
    const xml = buildArreteXml({
      id,
      nor,
      title,
      reconnues: communes.map((commune) => [
        'Département Fictif',
        commune,
        'Inondations',
        '01/01/2026',
        '02/01/2026',
      ]),
    });
    return buildTarball({
      [`jorf/simple/JORF/CONT/2026/07/10/JORFCONT${fileSuffix}.xml`]:
        buildTocXml(id, title),
      [`jorf/simple/JORF/CONT/2026/07/10/${id}.xml`]: xml,
    });
  };

  it('emails ADMIN_EMAIL for an alert the run creates, without any observer address', async () => {
    const tarball = await buildUnmatchedCommuneTarball('801');
    currentFetch = stubFetch(['JORFSIMPLE_20260710-060000.tar.gz'], {
      'JORFSIMPLE_20260710-060000.tar.gz': tarball,
    });

    await monitor.run();

    expect(await prisma.monitorAlert.count()).toBe(1);
    expect(transport.sent).toHaveLength(1);
    const [message] = transport.sent;
    if (!message) throw new Error('expected an admin alert email');
    expect(message.to).toBe(ADMIN_EMAIL);
    expect(message.text).not.toMatch(/@/);
  });

  it('sends one message for everything an arrêté raised, not one per alert', async () => {
    const tarball = await buildUnmatchedCommuneTarball('811', [
      'Commune Fictive',
      'Autre Fictive',
    ]);
    currentFetch = stubFetch(['JORFSIMPLE_20260710-080000.tar.gz'], {
      'JORFSIMPLE_20260710-080000.tar.gz': tarball,
    });

    await monitor.run();

    // A real arrêté lists hundreds of communes: a message per alert row would
    // be hundreds of messages for one publication, and the provider would stop
    // accepting them partway through.
    expect(await prisma.monitorAlert.count()).toBe(2);
    expect(transport.sent).toHaveLength(1);
    const [message] = transport.sent;
    expect(message?.text).toContain('Commune Fictive');
    expect(message?.text).toContain('Autre Fictive');
  });

  it('keeps the alert in the database and finishes the run when the transport fails', async () => {
    transport.failNext = true;
    const tarball = await buildUnmatchedCommuneTarball('901');
    currentFetch = stubFetch(['JORFSIMPLE_20260710-070000.tar.gz'], {
      'JORFSIMPLE_20260710-070000.tar.gz': tarball,
    });

    await expect(monitor.run()).resolves.toBeUndefined();

    expect(await prisma.monitorAlert.count()).toBe(1);
    expect(transport.sent).toHaveLength(0);
    expect(
      await prisma.jorfDelta.findUnique({
        where: { fileName: 'JORFSIMPLE_20260710-070000.tar.gz' },
      }),
    ).not.toBeNull();
  });
});

describe('veille notification outbox (issue #106)', () => {
  const TITLE =
    "Arrêté du 1er juillet 2026 portant reconnaissance de l'état de catastrophe naturelle";
  const AMIGNY = [
    'Aisne',
    'Amigny-Rouy',
    'Inondations',
    '01/01/2026',
    '02/01/2026',
  ];
  const MUSSIDAN = [
    'Dordogne',
    'Mussidan',
    'Inondations',
    '03/01/2026',
    '04/01/2026',
  ];

  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let monitor: JorfMonitorService;
  let transport: RecordingTransport;
  let currentFetch: FetchFn;

  beforeAll(async () => {
    transport = new RecordingTransport();
    app = await createIntTestApp({
      customize: (builder) =>
        builder
          .overrideProvider(DilaClient)
          .useValue(new DilaClient((...args) => currentFetch(...args)))
          .overrideProvider(MAIL_TRANSPORT)
          .useValue(transport),
    });
    prisma = app.get(PrismaService);
    monitor = app.get(JorfMonitorService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    transport.sent.length = 0;
    transport.failNext = false;
    await prisma.$executeRaw`TRUNCATE TABLE "Arrete", "JorfDelta", "MonitorLock", "MonitorAlert", "Commune", "Veille", "DeadlineRule" CASCADE`;
    await seedDeadlineRules(prisma);
  });

  /** One delta tarball naming a single arrêté text — id/nor vary per test so `run()` calls across tests in this file never collide on the same NOR. */
  const buildDelta = (id: string, nor: string, revision: ArreteRevision) =>
    buildTarball({
      [`jorf/simple/JORF/CONT/2026/07/01/JORFCONT${id.slice(-4)}.xml`]:
        buildTocXml(id, TITLE),
      [`jorf/simple/JORF/CONT/2026/07/01/${id}.xml`]: buildArreteXml({
        id,
        nor,
        title: TITLE,
        ...revision,
      }),
    });

  it('emails a confirmed watcher exactly once, in the run that finds the arrêté (PRD #4)', async () => {
    await prisma.commune.create({
      data: communeFixture('02005', 'Amigny-Rouy', '02', 'Aisne'),
    });
    const { veilleId } = await createVeille(prisma, {
      confirmedAt: new Date(),
      communeCodes: ['02005'],
    });

    const MORNING = 'JORFSIMPLE_20260701-060000.tar.gz';
    currentFetch = stubFetch([MORNING], {
      [MORNING]: await buildDelta('JORFTEXT000000000901', 'INTJ2600009A', {
        reconnues: [AMIGNY],
      }),
    });

    // The outbox is drained after the ingest as well as before it, so the
    // mail goes out in the run that finds the arrêté — ТЗ § 6, "письмо
    // наблюдателю — в день обнаружения arrêté"; waiting for the next tick
    // would post a 23:00 publication the following calendar day.
    await monitor.run();
    expect(transport.sent).toHaveLength(1);
    expect(await prisma.veilleNotification.count({ where: { veilleId } })).toBe(
      1,
    );
    const veille = await prisma.veille.findUniqueOrThrow({
      where: { id: veilleId },
    });
    expect(transport.sent[0]?.to).toBe(veille.email);
    const sent = await prisma.veilleNotification.findFirstOrThrow({
      where: { veilleId },
    });
    expect(sent.sentAt).not.toBeNull();

    // The evening delta re-delivers the same NOR, content unchanged — the
    // ingest short-circuit must not queue, or send, a second notification.
    const EVENING = 'JORFSIMPLE_20260701-230000.tar.gz';
    currentFetch = stubFetch([MORNING, EVENING], {
      [MORNING]: await buildDelta('JORFTEXT000000000901', 'INTJ2600009A', {
        reconnues: [AMIGNY],
      }),
      [EVENING]: await buildDelta('JORFTEXT000000000901', 'INTJ2600009A', {
        reconnues: [AMIGNY],
      }),
    });
    await monitor.run();

    expect(transport.sent).toHaveLength(1);
    expect(await prisma.veilleNotification.count()).toBe(1);
  });

  it("a rectificatif adding a commune emails only that commune's watchers (PRD #3)", async () => {
    await prisma.commune.create({
      data: communeFixture('02005', 'Amigny-Rouy', '02', 'Aisne'),
    });
    await prisma.commune.create({
      data: communeFixture('24290', 'Mussidan', '24', 'Dordogne'),
    });
    const watcherA = await createVeille(prisma, {
      confirmedAt: new Date(),
      communeCodes: ['02005'],
    });
    const watcherB = await createVeille(prisma, {
      confirmedAt: new Date(),
      communeCodes: ['24290'],
    });

    const NOR = 'INTJ2600010A';
    const ID = 'JORFTEXT000000001001';
    const MORNING = 'JORFSIMPLE_20260702-060000.tar.gz';
    const EVENING = 'JORFSIMPLE_20260702-230000.tar.gz';

    currentFetch = stubFetch([MORNING], {
      [MORNING]: await buildDelta(ID, NOR, { reconnues: [AMIGNY] }),
    });
    await monitor.run(); // watcherA is queued and mailed

    expect(transport.sent).toHaveLength(1);
    const veilleA = await prisma.veille.findUniqueOrThrow({
      where: { id: watcherA.veilleId },
    });
    expect(transport.sent[0]?.to).toBe(veilleA.email);
    transport.sent.length = 0;

    currentFetch = stubFetch([MORNING, EVENING], {
      [MORNING]: await buildDelta(ID, NOR, { reconnues: [AMIGNY] }),
      [EVENING]: await buildDelta(ID, NOR, {
        reconnues: [AMIGNY, MUSSIDAN],
      }),
    });
    // The rectificatif adds Mussidan and queues watcherB only — Amigny-Rouy's
    // watcher already has their row, so the post-ingest drain mails exactly
    // one person.
    await monitor.run();

    expect(transport.sent).toHaveLength(1);
    const veilleB = await prisma.veille.findUniqueOrThrow({
      where: { id: watcherB.veilleId },
    });
    expect(transport.sent[0]?.to).toBe(veilleB.email);
    expect(
      await prisma.veilleNotification.count({
        where: { veilleId: watcherA.veilleId },
      }),
    ).toBe(1);
  });

  it('a rectificatif that only flips an outcome sends no automatic email (PRD #11)', async () => {
    await prisma.commune.create({
      data: communeFixture('02005', 'Amigny-Rouy', '02', 'Aisne'),
    });
    const { veilleId } = await createVeille(prisma, {
      confirmedAt: new Date(),
      communeCodes: ['02005'],
    });

    const NOR = 'INTJ2600011A';
    const ID = 'JORFTEXT000000001101';
    const MORNING = 'JORFSIMPLE_20260703-060000.tar.gz';
    const EVENING = 'JORFSIMPLE_20260703-230000.tar.gz';

    currentFetch = stubFetch([MORNING], {
      [MORNING]: await buildDelta(ID, NOR, { reconnues: [AMIGNY] }),
    });
    await monitor.run();
    expect(transport.sent).toHaveLength(1);
    transport.sent.length = 0;

    // The rectificatif flips Amigny-Rouy from reconnu to refusé — an
    // OUTCOME_CHANGED alert (PRD #11's admin side), but the commune was
    // already notified, so no new outbox row and no automatic mail.
    currentFetch = stubFetch([MORNING, EVENING], {
      [MORNING]: await buildDelta(ID, NOR, { reconnues: [AMIGNY] }),
      [EVENING]: await buildDelta(ID, NOR, { nonReconnues: [AMIGNY] }),
    });
    await monitor.run();

    expect(transport.sent).toHaveLength(0);
    expect(await prisma.veilleNotification.count({ where: { veilleId } })).toBe(
      1,
    );
    expect(
      await prisma.monitorAlert.count({ where: { kind: 'OUTCOME_CHANGED' } }),
    ).toBe(1);
  });

  it('a failed send to one recipient does not block the other, and it retries next run (PRD #12)', async () => {
    await prisma.commune.create({
      data: communeFixture('02005', 'Amigny-Rouy', '02', 'Aisne'),
    });
    await prisma.commune.create({
      data: communeFixture('24290', 'Mussidan', '24', 'Dordogne'),
    });
    await createVeille(prisma, {
      confirmedAt: new Date(),
      communeCodes: ['02005'],
    });
    await createVeille(prisma, {
      confirmedAt: new Date(),
      communeCodes: ['24290'],
    });

    const NOR = 'INTJ2600012A';
    const ID = 'JORFTEXT000000001201';
    const MORNING = 'JORFSIMPLE_20260704-060000.tar.gz';
    currentFetch = stubFetch([MORNING], {
      [MORNING]: await buildDelta(ID, NOR, {
        reconnues: [AMIGNY, MUSSIDAN],
      }),
    });

    transport.failNext = true;
    await monitor.run();

    expect(transport.sent).toHaveLength(1);
    const stuck = await prisma.veilleNotification.findFirstOrThrow({
      where: { sentAt: null },
    });
    expect(stuck.attempts).toBe(1);

    await monitor.run();
    expect(transport.sent).toHaveLength(2);
    expect(
      await prisma.veilleNotification.count({ where: { sentAt: null } }),
    ).toBe(0);
  });

  it("leaves a row that failed this run to the next one, not to this run's second drain", async () => {
    await prisma.commune.create({
      data: communeFixture('02005', 'Amigny-Rouy', '02', 'Aisne'),
    });
    await prisma.commune.create({
      data: communeFixture('24290', 'Mussidan', '24', 'Dordogne'),
    });
    await createVeille(prisma, {
      confirmedAt: new Date(),
      communeCodes: ['02005'],
    });
    await createVeille(prisma, {
      confirmedAt: new Date(),
      communeCodes: ['24290'],
    });

    const FIRST = 'JORFSIMPLE_20260705-060000.tar.gz';
    const SECOND = 'JORFSIMPLE_20260705-230000.tar.gz';
    const first = await buildDelta('JORFTEXT000000001301', 'INTJ2600013A', {
      reconnues: [AMIGNY],
    });
    currentFetch = stubFetch([FIRST], { [FIRST]: first });
    transport.failNext = true;
    await monitor.run();
    expect(transport.sent).toHaveLength(0);

    // The next run drains before its ingest — that attempt fails too — and
    // then again after it. The second drain must mail Mussidan's watcher and
    // leave Amigny-Rouy's row alone: retrying it here would burn a second
    // unsubscribe token on the same row inside one run.
    currentFetch = stubFetch([FIRST, SECOND], {
      [FIRST]: first,
      [SECOND]: await buildDelta('JORFTEXT000000001302', 'INTJ2600014A', {
        reconnues: [MUSSIDAN],
      }),
    });
    transport.failNext = true;
    await monitor.run();

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.text).toContain('Mussidan');
    expect(
      await prisma.veilleNotification.findFirstOrThrow({
        where: { sentAt: null },
      }),
    ).toMatchObject({ attempts: 2 });
  });

  it('alerts once when an outbox row keeps failing, and stops counting there', async () => {
    await prisma.commune.create({
      data: communeFixture('02005', 'Amigny-Rouy', '02', 'Aisne'),
    });
    await createVeille(prisma, {
      confirmedAt: new Date(),
      communeCodes: ['02005'],
    });

    const MORNING = 'JORFSIMPLE_20260706-060000.tar.gz';
    currentFetch = stubFetch([MORNING], {
      [MORNING]: await buildDelta('JORFTEXT000000001401', 'INTJ2600015A', {
        reconnues: [AMIGNY],
      }),
    });
    const send = jest
      .spyOn(transport, 'send')
      .mockRejectedValue(new MailDeliveryError('boom'));
    try {
      for (let run = 0; run < NOTIFICATION_ATTEMPTS_BEFORE_ALERT + 1; run++) {
        await monitor.run();
      }
    } finally {
      send.mockRestore();
    }

    // One alert at the threshold and none after it: a poison row is visible
    // without turning into a message every twelve hours.
    const alerts = await prisma.monitorAlert.findMany({
      where: { kind: 'NOTIFICATION_STUCK' },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.detail).toContain('INTJ2600015A');
    expect(
      await prisma.veilleNotification.findFirstOrThrow({
        where: { sentAt: null },
      }),
    ).toMatchObject({ attempts: NOTIFICATION_ATTEMPTS_BEFORE_ALERT + 1 });
  });

  it('keeps the unsubscribe link alive when a queued row turns out to have nothing to mail', async () => {
    await prisma.commune.create({
      data: communeFixture('02005', 'Amigny-Rouy', '02', 'Aisne'),
    });
    const { veilleId } = await createVeille(prisma, {
      confirmedAt: new Date(),
      communeCodes: ['02005'],
    });

    const MORNING = 'JORFSIMPLE_20260707-060000.tar.gz';
    currentFetch = stubFetch([MORNING], {
      [MORNING]: await buildDelta('JORFTEXT000000001501', 'INTJ2600016A', {
        reconnues: [AMIGNY],
      }),
    });
    transport.failNext = true;
    await monitor.run();
    const mailed = await prisma.veille.findUniqueOrThrow({
      where: { id: veilleId },
    });

    // The watcher drops the commune before the row is retried: nothing is
    // left to mail, so the row drains — but the token must not rotate, or the
    // link in the mail they already have stops working with no replacement
    // ever sent (ТЗ § 7, отписка в один клик).
    await prisma.veilleCommune.deleteMany({ where: { veilleId } });
    await monitor.run();

    expect(transport.sent).toHaveLength(0);
    expect(
      await prisma.veille.findUniqueOrThrow({ where: { id: veilleId } }),
    ).toMatchObject({ unsubscribeTokenHash: mailed.unsubscribeTokenHash });
    expect(
      await prisma.veilleNotification.count({ where: { sentAt: null } }),
    ).toBe(0);
  });

  it('notifies a watcher whose commune the referential only resolves later', async () => {
    // The referential holds the commune under a misspelled département, so
    // matchCommune finds no candidate for the line the arrêté prints.
    await prisma.commune.create({
      data: communeFixture('02005', 'Amigny-Rouy', '02', 'Aisnes'),
    });
    await prisma.commune.create({
      data: communeFixture('24290', 'Mussidan', '24', 'Dordogne'),
    });
    const { veilleId } = await createVeille(prisma, {
      confirmedAt: new Date(),
      communeCodes: ['02005'],
    });

    const NOR = 'INTJ2600017A';
    const ID = 'JORFTEXT000000001601';
    const MORNING = 'JORFSIMPLE_20260708-060000.tar.gz';
    const EVENING = 'JORFSIMPLE_20260708-230000.tar.gz';

    // The line is stored with codeInsee null, which fans out to nobody, and
    // an UNMATCHED_COMMUNE alert asks an operator to fix the referential.
    currentFetch = stubFetch([MORNING], {
      [MORNING]: await buildDelta(ID, NOR, { reconnues: [AMIGNY] }),
    });
    await monitor.run();
    expect(transport.sent).toHaveLength(0);
    expect(await prisma.veilleNotification.count()).toBe(0);
    expect(
      await prisma.monitorAlert.count({ where: { kind: 'UNMATCHED_COMMUNE' } }),
    ).toBe(1);

    await prisma.commune.update({
      where: { codeInsee: '02005' },
      data: { departementName: 'Aisne' },
    });

    // The operator's fix lands, and the next revision resolves the line. Its
    // watchers are being notified for the first time, so this is an addition,
    // not the outcome change of PRD #11.
    currentFetch = stubFetch([MORNING, EVENING], {
      [MORNING]: await buildDelta(ID, NOR, { reconnues: [AMIGNY] }),
      [EVENING]: await buildDelta(ID, NOR, {
        reconnues: [AMIGNY, MUSSIDAN],
      }),
    });
    await monitor.run();

    expect(transport.sent).toHaveLength(1);
    const veille = await prisma.veille.findUniqueOrThrow({
      where: { id: veilleId },
    });
    expect(transport.sent[0]?.to).toBe(veille.email);
    expect(transport.sent[0]?.text).toContain('Amigny-Rouy');
  });

  it('notifies a watcher who confirms while the run is still downloading', async () => {
    await prisma.commune.create({
      data: communeFixture('02005', 'Amigny-Rouy', '02', 'Aisne'),
    });
    const { veilleId } = await createVeille(prisma, {
      confirmedAt: null,
      communeCodes: ['02005'],
    });

    const MORNING = 'JORFSIMPLE_20260709-060000.tar.gz';
    const serve = stubFetch([MORNING], {
      [MORNING]: await buildDelta('JORFTEXT000000001701', 'INTJ2600018A', {
        reconnues: [AMIGNY],
      }),
    });
    // Confirmation lands after the run started and before the outbox is
    // written; what that window costs a pre-run snapshot is on
    // queueNotifications.
    currentFetch = async (...args: Parameters<FetchFn>) => {
      if (args[0] !== DILA_JORFSIMPLE_BASE_URL) {
        await prisma.veille.update({
          where: { id: veilleId },
          data: { confirmedAt: new Date() },
        });
      }
      return serve(...args);
    };

    await monitor.run();

    expect(transport.sent).toHaveLength(1);
    const veille = await prisma.veille.findUniqueOrThrow({
      where: { id: veilleId },
    });
    expect(transport.sent[0]?.to).toBe(veille.email);
  });

  it('ingests the delta even when the send step cannot resolve the déclaration deadline', async () => {
    await prisma.commune.create({
      data: communeFixture('02005', 'Amigny-Rouy', '02', 'Aisne'),
    });
    await createVeille(prisma, {
      confirmedAt: new Date(),
      communeCodes: ['02005'],
    });
    // An environment whose seed never ran after the DeadlineRule migration.
    // loadDeclarationRule throws by design there (ТЗ § 7: no hard-coded legal
    // numbers), and that must cost the mail, not the ingest — otherwise every
    // run aborts before listing the deltas and no arrêté is found at all.
    await prisma.deadlineRule.deleteMany();

    const NOR = 'INTJ2600019A';
    const MORNING = 'JORFSIMPLE_20260710-060000.tar.gz';
    currentFetch = stubFetch([MORNING], {
      [MORNING]: await buildDelta('JORFTEXT000000001801', NOR, {
        reconnues: [AMIGNY],
      }),
    });
    await monitor.run();

    expect(transport.sent).toHaveLength(0);
    expect(
      await prisma.arrete.findUnique({ where: { nor: NOR } }),
    ).not.toBeNull();
    expect(
      await prisma.veilleNotification.count({ where: { sentAt: null } }),
    ).toBe(1);

    // With the rule back, the pending row goes out on the next run.
    await seedDeadlineRules(prisma);
    await monitor.run();
    expect(transport.sent).toHaveLength(1);
  });

  describe('backfill notify: false (issue #107)', () => {
    it('queues no notification for a backfill run, and a later normal run of the same NOR queues none either (PRD #13)', async () => {
      await prisma.commune.create({
        data: communeFixture('02005', 'Amigny-Rouy', '02', 'Aisne'),
      });
      await createVeille(prisma, {
        confirmedAt: new Date(),
        communeCodes: ['02005'],
      });

      const NOR = 'INTJ2600020A';
      const ID = 'JORFTEXT000000001901';
      const revision: ArreteRevision = {
        reconnues: [AMIGNY],
        publishedAt: '2026-01-01',
      };
      const BACKFILL = 'JORFSIMPLE_20260101-060000.tar.gz';
      currentFetch = stubFetch([BACKFILL], {
        [BACKFILL]: await buildDelta(ID, NOR, revision),
      });

      await monitor.run(false);

      expect(await prisma.arrete.count()).toBe(1);
      expect(await prisma.veilleNotification.count()).toBe(0);
      expect(transport.sent).toHaveLength(0);

      // The evening delta the normal monitor picks up next re-delivers the
      // same NOR unchanged — the same short-circuit issue #106 relies on
      // (only lastSeenAt bumps), so there is still nothing to queue even
      // though a confirmed watcher exists.
      const NEXT = 'JORFSIMPLE_20260101-230000.tar.gz';
      currentFetch = stubFetch([BACKFILL, NEXT], {
        [BACKFILL]: await buildDelta(ID, NOR, revision),
        [NEXT]: await buildDelta(ID, NOR, revision),
      });
      await monitor.run();

      expect(await prisma.veilleNotification.count()).toBe(0);
      expect(transport.sent).toHaveLength(0);
    });
  });
});
