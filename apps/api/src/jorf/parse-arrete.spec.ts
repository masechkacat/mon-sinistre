import { jorfFixture } from 'test/fixtures/jorf';
import { ArreteEntryOutcome } from '@mon-sinistre/contracts';
import { parseArreteXml } from './parse-arrete';

const arreteXml = jorfFixture('JORFTEXT000054245373.xml');
/** The same arrêté shape published seven months earlier, whose annexes mark the header row up with `th` instead of `td` — JORF uses both. */
const thHeaderArreteXml = jorfFixture('JORFTEXT000053398028.xml');

describe('parseArreteXml', () => {
  const parsed = parseArreteXml(arreteXml);

  it('parses the metadata from the XML, never from file arrival or GASPAR', () => {
    expect(parsed?.nor).toBe('INTE2615534A');
    expect(parsed?.signedAt).toBe('2026-06-12');
    // publishedAt is the legal deadline anchor — must equal <DATE_PUBLI>, the
    // hard constraint from CLAUDE.md.
    expect(parsed?.publishedAt).toBe('2026-06-13');
    expect(parsed?.jorfNumber).toBe('JORF n°0137 du 13 juin 2026');
    expect(parsed?.legifranceUrl).toBe(
      'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054245373',
    );
  });

  it('returns null for a non-arrêté text', () => {
    const decret = arreteXml
      .replace('<NATURE>ARRETE</NATURE>', '<NATURE>DECRET</NATURE>')
      .replace('<NOR>INTE2615534A</NOR>', '<NOR>INTE2699999D</NOR>');
    expect(parseArreteXml(decret)).toBeNull();
  });

  describe('annexe I — communes reconnues', () => {
    const annexeI =
      parsed?.entries.filter((e) => e.outcome === ArreteEntryOutcome.RECONNU) ??
      [];

    it('reads every row of the annexe', () => {
      expect(annexeI).toHaveLength(183);
    });

    it('reads the first row', () => {
      expect(annexeI[0]).toMatchObject({
        departementRaw: 'Aisne',
        communeLabelRaw: 'Amigny-Rouy',
        risque:
          'Mouvements de terrain différentiels consécutifs à la sécheresse et à la réhydratation des sols',
        eventStart: '2025-01-01',
        eventEnd: '2025-12-31',
        outcome: ArreteEntryOutcome.RECONNU,
      });
      expect(annexeI[0]?.motivation).toContain(
        '2024.\nLe critère géotechnique est satisfait',
      );
    });

    it('reads the last row', () => {
      expect(annexeI[182]).toMatchObject({
        departementRaw: 'Haute-Vienne',
        communeLabelRaw: 'Verneuil-sur-Vienne',
        outcome: ArreteEntryOutcome.RECONNU,
      });
    });

    it('does not break a row whose "Nombre de reconnaissances" cell is empty', () => {
      for (const entry of annexeI) {
        expect(entry.departementRaw).not.toBe('');
        expect(entry.communeLabelRaw).not.toBe('');
      }
    });
  });

  describe('annexe II — communes non reconnues', () => {
    const annexeII =
      parsed?.entries.filter((e) => e.outcome === ArreteEntryOutcome.REFUSE) ??
      [];

    it('reads every row of the annexe', () => {
      expect(annexeII).toHaveLength(538);
    });

    it('reads the first row', () => {
      expect(annexeII[0]).toMatchObject({
        departementRaw: 'Dordogne',
        communeLabelRaw: 'Mussidan',
        eventStart: '2025-01-01',
        eventEnd: '2025-12-31',
        outcome: ArreteEntryOutcome.REFUSE,
      });
      expect(annexeII[0]?.motivation).toContain("n'est pas satisfait");
    });

    it('reads the last row', () => {
      expect(annexeII[537]).toMatchObject({
        departementRaw: "Val-d'Oise",
        communeLabelRaw: 'Montlignon',
        outcome: ArreteEntryOutcome.REFUSE,
      });
    });
  });

  describe('annexe shapes the reference fixture does not carry', () => {
    const row = (cells: string[]) =>
      `<tr>${cells.map((cell) => `<td><br/>${cell}</td>`).join('')}</tr>`;
    const table = (headers: string[], rows: string[][]) =>
      `<table border="1">${row(headers)}${rows.map(row).join('')}</table>`;
    const HEADERS = [
      'Département',
      'Commune',
      'Phénomène naturel',
      'Date de début<br/>de l’événement',
      'Date de fin<br/>de l’événement',
    ];
    const AMIGNY = [
      'Aisne',
      'Amigny-Rouy',
      'Inondations',
      '01/01/2025',
      '31/12/2025',
    ];
    const MUSSIDAN = [
      'Dordogne',
      'Mussidan',
      'Inondations',
      '02/01/2025',
      '03/01/2025',
    ];

    /** A minimal arrêté around one annexe — same tag layout as the DILA fixture, cut down to the annexe under test. */
    const buildArrete = (annexeContent: string) => `<?xml version="1.0"?>
      <TEXTE>
        <NATURE>ARRETE</NATURE>
        <ID>JORFTEXT000000000001</ID>
        <NOR>INTE2600001A</NOR>
        <DATE_TEXTE>2026-06-12</DATE_TEXTE>
        <DATE_PUBLI>2026-06-13</DATE_PUBLI>
        <ORIGINE_PUBLI>JORF n°0137 du 13 juin 2026</ORIGINE_PUBLI>
        <STRUCT>
          <SECTION_TA>
            <TITRE_TA>Annexe</TITRE_TA>
            <ARTICLE><BLOC_TEXTUEL><CONTENU>
              <p>Communes reconnues en état de catastrophe naturelle</p>
              ${annexeContent}
            </CONTENU></BLOC_TEXTUEL></ARTICLE>
          </SECTION_TA>
        </STRUCT>
      </TEXTE>`;

    it('ingests an annexe whose table has no "Motivations" column', () => {
      const entries = parseArreteXml(
        buildArrete(table(HEADERS, [AMIGNY])),
      )?.entries;

      expect(entries).toHaveLength(1);
      expect(entries?.[0]).toMatchObject({
        communeLabelRaw: 'Amigny-Rouy',
        eventStart: '2025-01-01',
        outcome: ArreteEntryOutcome.RECONNU,
        motivation: null,
      });
    });

    it('reads every table of an annexe split across several', () => {
      const entries = parseArreteXml(
        buildArrete(table(HEADERS, [AMIGNY]) + table(HEADERS, [MUSSIDAN])),
      )?.entries;

      expect(entries?.map((entry) => entry.communeLabelRaw)).toEqual([
        'Amigny-Rouy',
        'Mussidan',
      ]);
    });

    it('reads a header row that mixes th and td cells', () => {
      // JORF switched header markup once already (th in January 2026, td in
      // June); a half-converted row must not cost the whole arrêté.
      const [first, ...rest] = HEADERS;
      const mixedHeader = `<tr><th><br/>${first}</th>${rest
        .map((header) => `<td><br/>${header}</td>`)
        .join('')}</tr>`;

      const entries = parseArreteXml(
        buildArrete(`<table border="1">${mixedHeader}${row(AMIGNY)}</table>`),
      )?.entries;

      expect(entries).toHaveLength(1);
      expect(entries?.[0]).toMatchObject({
        departementRaw: 'Aisne',
        communeLabelRaw: 'Amigny-Rouy',
      });
    });

    it('rejects a table missing a column the domain needs', () => {
      const withoutRisque = HEADERS.filter(
        (header) => header !== 'Phénomène naturel',
      );

      expect(() =>
        parseArreteXml(
          buildArrete(
            table(withoutRisque, [
              AMIGNY.filter((cell) => cell !== 'Inondations'),
            ]),
          ),
        ),
      ).toThrow('risque');
    });
  });

  describe('an annexe whose header row is marked up with th', () => {
    const thParsed = parseArreteXml(thHeaderArreteXml);
    const bothAnnexes = (outcome: ArreteEntryOutcome) =>
      thParsed?.entries.filter((entry) => entry.outcome === outcome) ?? [];

    it('parses the metadata', () => {
      expect(thParsed?.nor).toBe('INTE2601369A');
      expect(thParsed?.publishedAt).toBe('2026-01-24');
      expect(thParsed?.signedAt).toBe('2026-01-19');
    });

    it('reads both annexes, whose column counts differ', () => {
      const reconnu = bothAnnexes(ArreteEntryOutcome.RECONNU);
      const refuse = bothAnnexes(ArreteEntryOutcome.REFUSE);

      expect(reconnu).toHaveLength(76);
      expect(refuse).toHaveLength(64);
      expect(reconnu[0]).toMatchObject({
        departementRaw: 'Ardèche',
        communeLabelRaw: 'Baix',
        risque: 'Inondations et coulées de boue',
        eventStart: '2025-11-16',
        eventEnd: '2025-11-17',
      });
      expect(reconnu[75]).toMatchObject({
        departementRaw: 'Guadeloupe',
        communeLabelRaw: 'Saint-François',
      });
      expect(refuse[63]).toMatchObject({
        departementRaw: "Val-d'Oise",
        communeLabelRaw: 'Saint-Prix',
        risque: 'Vents cycloniques',
      });
    });
  });

  it('computes a stable contentHash from the parsed content', () => {
    expect(parsed?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parseArreteXml(arreteXml)?.contentHash).toBe(parsed?.contentHash);
  });
});
