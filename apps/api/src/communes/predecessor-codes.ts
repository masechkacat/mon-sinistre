import { resolveCurrentCode } from 'src/jorf/recipients/resolve-recipients';

/**
 * Inverse of `loadSuccessorMap` for one commune
 * (docs/research/dossier-preliminaire.md, "Ответ по коммуне"). Asking the
 * forward `resolveCurrentCode` about every key, rather than walking the map
 * backwards, keeps both directions of a merger chain one piece of logic.
 * `code` itself is never in the result — a code with a successor resolves
 * past itself — so the caller unions it in.
 */
export function predecessorCodesOf(
  code: string,
  successorOf: ReadonlyMap<string, string>,
): string[] {
  return [...successorOf.keys()]
    .filter((key) => resolveCurrentCode(key, successorOf) === code)
    .sort();
}
