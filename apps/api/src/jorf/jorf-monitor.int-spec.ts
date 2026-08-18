import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import type { FetchFn } from 'src/common/fetch-fn';
import { commune as communeFixture } from 'src/communes/commune.test-helper';
import { captureLogs } from 'src/mail/mail-log.test-helper';
import { MAIL_TRANSPORT } from 'src/mail/mail-transport';
import { RecordingTransport } from 'src/mail/mail-transport.test-helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { DILA_JORFSIMPLE_BASE_URL, DilaClient } from './dila.client';
import { buildTarball } from './fixtures/build-tarball.test-helper';
import { JorfMonitorService, MAX_DELTAS_PER_RUN } from './jorf-monitor.service';

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

const buildArreteXml = (options: {
  id: string;
  nor: string;
  title: string;
  reconnues?: string[][];
  nonReconnues?: string[][];
}) => `<?xml version="1.0"?>
  <TEXTE>
    <NATURE>ARRETE</NATURE>
    <ID>${options.id}</ID>
    <NOR>${options.nor}</NOR>
    <TITREFULL>${options.title}</TITREFULL>
    <DATE_TEXTE>2026-06-30</DATE_TEXTE>
    <DATE_PUBLI>2026-07-01</DATE_PUBLI>
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
    await prisma.$executeRaw`TRUNCATE TABLE "Arrete", "JorfDelta", "MonitorAlert", "Commune" CASCADE`;
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

    it('upserts entries on a rectificatif and alerts on an outcome change (PRD #3, #11)', async () => {
      const textId = 'JORFTEXT000000000201';
      const tocXml = buildTocXml(textId, RECT_TITLE);
      const firstTarball = await buildTarball({
        'jorf/simple/JORF/CONT/2026/07/01/JORFCONT000000000200.xml': tocXml,
        [`jorf/simple/JORF/CONT/2026/07/01/${textId}.xml`]: buildArreteXml({
          id: textId,
          nor: RECT_NOR,
          title: RECT_TITLE,
          reconnues: [AMIGNY],
        }),
      });
      currentFetch = stubFetch(['JORFSIMPLE_20260701-060000.tar.gz'], {
        'JORFSIMPLE_20260701-060000.tar.gz': firstTarball,
      });
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
      const secondTarball = await buildTarball({
        'jorf/simple/JORF/CONT/2026/07/01/JORFCONT000000000200.xml': tocXml,
        [`jorf/simple/JORF/CONT/2026/07/01/${textId}.xml`]: buildArreteXml({
          id: textId,
          nor: RECT_NOR,
          title: RECT_TITLE,
          reconnues: [MUSSIDAN],
          nonReconnues: [AMIGNY],
        }),
      });
      currentFetch = stubFetch(
        [
          'JORFSIMPLE_20260701-060000.tar.gz',
          'JORFSIMPLE_20260701-230000.tar.gz',
        ],
        {
          'JORFSIMPLE_20260701-060000.tar.gz': firstTarball,
          'JORFSIMPLE_20260701-230000.tar.gz': secondTarball,
        },
      );
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

    it('does not create an Arrete for a rectificatif Z-text and alerts referencing the original NOR', async () => {
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
      currentFetch = stubFetch(['JORFSIMPLE_20260701-060000.tar.gz'], {
        'JORFSIMPLE_20260701-060000.tar.gz': tarball,
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
    await prisma.$executeRaw`TRUNCATE TABLE "Arrete", "JorfDelta", "MonitorAlert", "Commune" CASCADE`;
  });

  /** An arrêté whose one commune the (empty) referential cannot resolve —
   * the simplest of the three alert kinds to trigger, one UNMATCHED_COMMUNE
   * row is all either test below needs. */
  const buildUnmatchedCommuneTarball = (fileSuffix: string) => {
    const id = `JORFTEXT00000000${fileSuffix}`;
    const nor = `INTJ260000${fileSuffix}A`;
    const title =
      "Arrêté du 10 juillet 2026 portant reconnaissance de l'état de catastrophe naturelle";
    const xml = buildArreteXml({
      id,
      nor,
      title,
      reconnues: [
        [
          'Département Fictif',
          'Commune Fictive',
          'Inondations',
          '01/01/2026',
          '02/01/2026',
        ],
      ],
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
