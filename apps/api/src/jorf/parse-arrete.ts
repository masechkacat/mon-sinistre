import { createHash } from 'node:crypto';
import {
  ArreteEntryOutcome,
  IsoDate,
  toIsoDate,
} from '@mon-sinistre/contracts';
import { parseXml, XmlElement } from '@rgrove/parse-xml';
import { parseFrenchDate } from './french-date';
import {
  findChild,
  findChildren,
  findChildText,
  findDescendants,
  textWithLineBreaks,
} from './xml-tree';

/** One commune line of an arrêté annexe, before commune-referential matching. */
export interface ParsedArreteEntry {
  departementRaw: string;
  communeLabelRaw: string;
  risque: string;
  eventStart: IsoDate;
  eventEnd: IsoDate;
  outcome: ArreteEntryOutcome;
  motivation: string | null;
}

export interface ParsedArrete {
  nor: string;
  signedAt: IsoDate;
  publishedAt: IsoDate;
  jorfNumber: string;
  legifranceUrl: string;
  entries: ParsedArreteEntry[];
  /** SHA-256 of the parsed content, not the raw XML — docs/research/jorf-monitor.md, "Дедупликация, contentHash и rectificatifs". */
  contentHash: string;
}

type ColumnKey =
  | 'departementRaw'
  | 'communeLabelRaw'
  | 'risque'
  | 'eventStart'
  | 'eventEnd'
  | 'motivation'
  | 'ignored';

// Matched by prefix, not full text: headers wrap across several <br/> and the
// wording after the first words varies with column width (docs/research/jorf-monitor.md,
// "Отбор текстов и структура annexe").
const COLUMN_MATCHERS: [ColumnKey, RegExp][] = [
  ['departementRaw', /^département/],
  ['communeLabelRaw', /^commune\b/],
  ['risque', /^phénomène naturel/],
  ['eventStart', /^date de début/],
  ['eventEnd', /^date de fin/],
  ['motivation', /^motivations de la décision/],
  ['ignored', /^nombre de reconnaissances/],
];

/**
 * Columns a row is unusable without. `motivation` is deliberately not one of
 * them although every 2026 annexe carries it: an arrêté missing that column
 * would otherwise be dropped whole — both annexes, every commune — over a
 * field the domain stores as nullable.
 */
const REQUIRED_COLUMNS: ColumnKey[] = [
  'departementRaw',
  'communeLabelRaw',
  'risque',
  'eventStart',
  'eventEnd',
];

function detectColumnKey(headerCell: XmlElement): ColumnKey {
  const normalized = textWithLineBreaks(headerCell)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const match = COLUMN_MATCHERS.find(([, pattern]) => pattern.test(normalized));
  if (!match) {
    throw new Error(`unrecognized annexe column header: "${normalized}"`);
  }
  return match[0];
}

type RawAnnexeEntry = Omit<ParsedArreteEntry, 'outcome'>;

function parseAnnexeTable(table: XmlElement): RawAnnexeEntry[] {
  const [headerRow, ...dataRows] = findChildren(table, 'tr');
  if (!headerRow) {
    throw new Error('annexe table has no header row');
  }

  // JORF marks the header row up either way — `th` in the January 2026
  // arrêtés, `td` in the June ones — and nothing in the text says which.
  const headerCells = findChildren(headerRow, 'th');
  const columns = (
    headerCells.length > 0 ? headerCells : findChildren(headerRow, 'td')
  ).map(detectColumnKey);
  for (const key of REQUIRED_COLUMNS) {
    if (!columns.includes(key)) {
      throw new Error(`annexe table is missing the "${key}" column`);
    }
  }

  return dataRows.map((row) => {
    const cells = findChildren(row, 'td');
    if (cells.length !== columns.length) {
      throw new Error(
        `annexe row has ${cells.length} cells, expected ${columns.length}`,
      );
    }

    const values: Partial<Record<ColumnKey, string>> = {};
    columns.forEach((key, index) => {
      const cell = cells[index];
      if (cell) {
        values[key] = textWithLineBreaks(cell);
      }
    });

    return {
      departementRaw: requireCellText(values, 'departementRaw'),
      communeLabelRaw: requireCellText(values, 'communeLabelRaw'),
      risque: requireCellText(values, 'risque'),
      eventStart: parseFrenchDate(values.eventStart ?? ''),
      eventEnd: parseFrenchDate(values.eventEnd ?? ''),
      motivation: values.motivation ? values.motivation : null,
    };
  });
}

function requireCellText(
  values: Partial<Record<ColumnKey, string>>,
  key: ColumnKey,
): string {
  const value = values[key];
  if (!value) {
    throw new Error(`annexe row is missing the "${key}" cell`);
  }
  return value;
}

function detectAnnexeOutcome(captionText: string): ArreteEntryOutcome {
  const normalized = captionText.toLowerCase();
  if (normalized.includes('non reconnues')) {
    return ArreteEntryOutcome.REFUSE;
  }
  if (normalized.includes('reconnues')) {
    return ArreteEntryOutcome.RECONNU;
  }
  throw new Error(
    `cannot determine annexe outcome from caption: "${captionText}"`,
  );
}

function parseAnnexeSection(section: XmlElement): ParsedArreteEntry[] {
  const article = findChild(section, 'ARTICLE');
  if (!article) {
    throw new Error('annexe section without an ARTICLE');
  }
  const blocTextuel = findChild(article, 'BLOC_TEXTUEL');
  const contenu = blocTextuel && findChild(blocTextuel, 'CONTENU');
  if (!contenu) {
    throw new Error('annexe article without a CONTENU');
  }

  const caption = findChild(contenu, 'p');
  const outcome = detectAnnexeOutcome(
    caption ? textWithLineBreaks(caption) : '',
  );

  // Every table of the section, not just the first: a long annexe split
  // across several tables would otherwise lose the communes of all but one —
  // silently, and with the arrêté still counted as fully ingested.
  const tables = findDescendants(contenu, 'table');
  if (tables.length === 0) {
    throw new Error('annexe without a table');
  }

  return tables
    .flatMap((table) => parseAnnexeTable(table))
    .map((row) => ({ ...row, outcome }));
}

function compareEntries(a: ParsedArreteEntry, b: ParsedArreteEntry): number {
  const key = (entry: ParsedArreteEntry) =>
    [
      entry.departementRaw,
      entry.communeLabelRaw,
      entry.risque,
      entry.eventStart,
      entry.eventEnd,
      entry.outcome,
    ].join('\n');
  const keyA = key(a);
  const keyB = key(b);
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}

function computeContentHash(parsed: Omit<ParsedArrete, 'contentHash'>): string {
  const canonicalEntries = [...parsed.entries].sort(compareEntries);
  const payload = JSON.stringify({
    nor: parsed.nor,
    signedAt: parsed.signedAt,
    publishedAt: parsed.publishedAt,
    jorfNumber: parsed.jorfNumber,
    legifranceUrl: parsed.legifranceUrl,
    entries: canonicalEntries,
  });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Parses a JORFSIMPLE `<TEXTE>` XML into an arrêté, or `null` if it is not
 * one — `<NATURE>` is the second selection gate after the table-of-contents
 * title match ({@link import('./select-catnat-texts').selectCatnatTextIds}).
 */
export function parseArreteXml(xml: string): ParsedArrete | null {
  const root = parseXml(xml).root;
  if (!root || findChildText(root, 'NATURE') !== 'ARRETE') {
    return null;
  }

  const id = findChildText(root, 'ID');
  const nor = findChildText(root, 'NOR');
  const signedAtRaw = findChildText(root, 'DATE_TEXTE');
  const publishedAtRaw = findChildText(root, 'DATE_PUBLI');
  const jorfNumber = findChildText(root, 'ORIGINE_PUBLI');
  if (!id || !nor || !signedAtRaw || !publishedAtRaw || !jorfNumber) {
    throw new Error(
      `arrête ${id ?? '(unknown ID)'} is missing required metadata`,
    );
  }

  const struct = findChild(root, 'STRUCT');
  if (!struct) {
    throw new Error(`arrête ${nor} has no <STRUCT>`);
  }
  const annexeSections = findDescendants(struct, 'SECTION_TA').filter(
    (section) => findChildText(section, 'TITRE_TA') === 'Annexe',
  );
  if (annexeSections.length === 0) {
    throw new Error(`arrête ${nor} has no annexe section`);
  }

  const parsed = {
    nor,
    signedAt: toIsoDate(signedAtRaw),
    publishedAt: toIsoDate(publishedAtRaw),
    jorfNumber,
    legifranceUrl: `https://www.legifrance.gouv.fr/jorf/id/${id}`,
    entries: annexeSections.flatMap(parseAnnexeSection),
  };

  return { ...parsed, contentHash: computeContentHash(parsed) };
}
