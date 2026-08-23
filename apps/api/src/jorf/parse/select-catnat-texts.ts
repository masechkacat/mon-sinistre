import { parseXml } from '@rgrove/parse-xml';
import { findDescendants } from './xml-tree';

// The historical "portant constatation…" wording predates the ~2000s and is
// out of the backfill's 2026 scope (docs/research/jorf-monitor.md, "Отбор
// текстов и структура annexe").
const CATNAT_TITLE_PATTERN =
  /portant reconnaissance de l'état de catastrophe naturelle/i;

/**
 * IDs of texts in a JORF issue table of contents (`JORFCONT…xml`) whose
 * title matches the catastrophe-naturelle arrêté wording — the only stable
 * selector across ministry NOR-prefix renamings.
 */
export function selectCatnatTextIds(tocXml: string): string[] {
  const root = parseXml(tocXml).root;
  if (!root) {
    return [];
  }

  return findDescendants(root, 'LIEN_TXT')
    .filter((lien) => CATNAT_TITLE_PATTERN.test(lien.attributes.titretxt ?? ''))
    .map((lien) => lien.attributes.idtxt)
    .filter((id): id is string => Boolean(id));
}
