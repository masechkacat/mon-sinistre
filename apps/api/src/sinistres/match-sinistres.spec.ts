import { RisqueCatnat, toIsoDate } from '@mon-sinistre/contracts';
import {
  type MatchArreteEntry,
  type MatchCandidateSinistre,
  matchSinistres,
} from './match-sinistres';

function entry(overrides: Partial<MatchArreteEntry>): MatchArreteEntry {
  return {
    id: 'entry-1',
    codeInsee: '30189',
    risque: 'Inondations et coulées de boue',
    eventStart: toIsoDate('2026-01-10'),
    eventEnd: toIsoDate('2026-01-20'),
    outcome: 'RECONNU',
    publishedAt: toIsoDate('2026-02-01'),
    ...overrides,
  };
}

function sinistre(
  overrides: Partial<MatchCandidateSinistre>,
): MatchCandidateSinistre {
  return {
    id: 'sinistre-1',
    codeInsee: '30189',
    risque: RisqueCatnat.INONDATION,
    eventDate: toIsoDate('2026-01-15'),
    ...overrides,
  };
}

describe('matchSinistres', () => {
  it('links a sinistre to a matching entry', () => {
    const links = matchSinistres([entry({})], [sinistre({})], new Map());

    expect(links).toEqual([
      { sinistreId: 'sinistre-1', arreteEntryId: 'entry-1' },
    ]);
  });

  it('does not link an arrêté of the same commune but a different risque (critère PRD № 7)', () => {
    const links = matchSinistres(
      [entry({ risque: 'Séismes' })],
      [sinistre({ risque: RisqueCatnat.INONDATION })],
      new Map(),
    );

    expect(links).toEqual([]);
  });

  it('finds the successor arrêté for a sinistre of a merged commune (critère PRD № 8)', () => {
    const links = matchSinistres(
      [entry({ codeInsee: '30190' })],
      [sinistre({ codeInsee: '30189' })],
      new Map([['30189', '30190']]),
    );

    expect(links).toEqual([
      { sinistreId: 'sinistre-1', arreteEntryId: 'entry-1' },
    ]);
  });

  it('picks RECONNU over REFUSE among several matching entries (critère PRD № 9)', () => {
    const links = matchSinistres(
      [
        entry({
          id: 'refuse',
          outcome: 'REFUSE',
          publishedAt: toIsoDate('2026-01-25'),
        }),
        entry({
          id: 'reconnu',
          outcome: 'RECONNU',
          publishedAt: toIsoDate('2026-02-10'),
        }),
      ],
      [sinistre({})],
      new Map(),
    );

    expect(links).toEqual([
      { sinistreId: 'sinistre-1', arreteEntryId: 'reconnu' },
    ]);
  });

  it('picks the earliest publishedAt among several RECONNU entries (critère PRD № 9)', () => {
    const links = matchSinistres(
      [
        entry({
          id: 'later',
          outcome: 'RECONNU',
          publishedAt: toIsoDate('2026-03-01'),
        }),
        entry({
          id: 'earlier',
          outcome: 'RECONNU',
          publishedAt: toIsoDate('2026-02-01'),
        }),
      ],
      [sinistre({})],
      new Map(),
    );

    expect(links).toEqual([
      { sinistreId: 'sinistre-1', arreteEntryId: 'earlier' },
    ]);
  });

  it('does not match a code the successor resolve leaves unresolved (cycle)', () => {
    const links = matchSinistres(
      [entry({ codeInsee: '30189' })],
      [sinistre({ codeInsee: '30189' })],
      new Map([
        ['30189', '30190'],
        ['30190', '30189'],
      ]),
    );

    expect(links).toEqual([]);
  });

  it('does not match an event date one day before eventStart', () => {
    const links = matchSinistres(
      [
        entry({
          eventStart: toIsoDate('2026-01-10'),
          eventEnd: toIsoDate('2026-01-20'),
        }),
      ],
      [sinistre({ eventDate: toIsoDate('2026-01-09') })],
      new Map(),
    );

    expect(links).toEqual([]);
  });

  it('does not match an entry whose commune is unmapped', () => {
    const links = matchSinistres(
      [entry({ codeInsee: null })],
      [sinistre({})],
      new Map(),
    );

    expect(links).toEqual([]);
  });

  it('gives an empty list when nothing matches', () => {
    expect(matchSinistres([], [], new Map())).toEqual([]);
  });
});
