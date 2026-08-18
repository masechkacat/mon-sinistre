import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ArreteEntryOutcome } from '@mon-sinistre/contracts';
import { parseArreteXml } from './parse-arrete';

const arreteXml = readFileSync(
  join(__dirname, 'fixtures/JORFTEXT000054245373.xml'),
  'utf-8',
);

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

  it('computes a stable contentHash from the parsed content', () => {
    expect(parsed?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parseArreteXml(arreteXml)?.contentHash).toBe(parsed?.contentHash);
  });
});
