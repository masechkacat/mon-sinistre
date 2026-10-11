import { expect, test } from '@playwright/test';
import { RisqueCatnat, toIsoDate } from '@mon-sinistre/contracts';
import {
  dossierSearch,
  parseDossierParams,
  parseRisqueOptions,
} from '../../src/lib/dossier-params';
import { RISQUES } from '../../src/lib/risques';

const PARAMS = {
  commune: '30189',
  risque: RisqueCatnat.INONDATION,
  date: toIsoDate('2026-09-13'),
};

const EMPTY = { commune: undefined, risque: undefined, date: undefined };

test('an address without parameters carries no dossier', () => {
  expect(parseDossierParams(new URLSearchParams())).toEqual(EMPTY);
});

test('three valid parameters are read back as three fields', () => {
  const searchParams = new URLSearchParams({
    commune: '30189',
    risque: 'INONDATION',
    date: '2026-09-13',
  });

  expect(parseDossierParams(searchParams)).toEqual(PARAMS);
});

test('a risk outside the referential and a date that is not one are dropped, the rest stays', () => {
  const searchParams = new URLSearchParams({
    commune: '30189',
    risque: 'FEU',
    date: 'hier',
  });

  expect(parseDossierParams(searchParams)).toEqual({
    ...EMPTY,
    commune: '30189',
  });
});

test('an arrêté naming several risks offers exactly those, in the order given', () => {
  expect(
    parseRisqueOptions(
      new URLSearchParams({ risques: 'INONDATION,MOUVEMENT_TERRAIN' }),
    ),
  ).toEqual([RisqueCatnat.INONDATION, RisqueCatnat.MOUVEMENT_TERRAIN]);
});

test('a wording the classifier does not know leaves every category open', () => {
  expect(parseRisqueOptions(new URLSearchParams())).toEqual(RISQUES);
  expect(parseRisqueOptions(new URLSearchParams({ risques: '' }))).toEqual(
    RISQUES,
  );
  expect(parseRisqueOptions(new URLSearchParams({ risques: 'FEU' }))).toEqual(
    RISQUES,
  );
});

test('the query is prefixed like location.search, so it appends to a path', () => {
  expect(dossierSearch(PARAMS)).toBe(
    '?commune=30189&risque=INONDATION&date=2026-09-13',
  );
});

test('a parameter nobody filled in stays out of the query', () => {
  expect(dossierSearch({})).toBe('');
  expect(dossierSearch({ commune: '' })).toBe('');
});

test('serialising and parsing are mutually inverse', () => {
  expect(
    parseDossierParams(new URLSearchParams(dossierSearch(PARAMS))),
  ).toEqual(PARAMS);
  expect(
    parseDossierParams(
      new URLSearchParams(dossierSearch({ commune: '30189' })),
    ),
  ).toEqual({ ...EMPTY, commune: '30189' });
  expect(parseDossierParams(new URLSearchParams(dossierSearch({})))).toEqual(
    EMPTY,
  );
});
