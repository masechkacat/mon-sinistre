/**
 * A `VeilleCommune` row reduced to the fields fan-out needs, independent of
 * how the caller fetched them — `confirmed` is `Veille.confirmedAt != null`,
 * computed by the caller so this stays a pure function (`match-commune.ts`
 * pattern).
 */
export interface SubscribedCommune {
  veilleId: string;
  codeInsee: string;
  confirmed: boolean;
}

/** A confirmed watcher of at least one commune an arrêté names, with the set of those communes. */
export interface ArreteRecipient {
  veilleId: string;
  codeInsee: string[];
}

/**
 * A cap on successor hops, not a realistic chain length: it only stands
 * between a cyclic `successorCodeInsee` (data corruption — communes don't
 * merge into each other) and an infinite loop (research, "Как применять" —
 * "с защитой от цикла").
 */
const MAX_SUCCESSOR_HOPS = 50;

/**
 * Resolves a commune code to the code an arrêté would actually name today,
 * walking `successorCodeInsee` forward (data-model § 3, "только на чтении").
 * A cycle — malformed data, communes never merge into each other — is
 * reported as unresolved (`null`) rather than an arbitrary link in the loop,
 * so a caller's equality or set-membership check can't accidentally match.
 * Exported for `matchSinistres` (`src/sinistres/match-sinistres.ts`), which
 * resolves both an entry's and a sinistre's code through the same chain
 * (docs/research/sinistre-plan.md, "Привязка entry ↔ синистр").
 */
export function resolveCurrentCode(
  codeInsee: string,
  successorOf: ReadonlyMap<string, string>,
): string | null {
  const seen = new Set<string>([codeInsee]);
  let current = codeInsee;
  for (let hop = 0; hop < MAX_SUCCESSOR_HOPS; hop++) {
    const next = successorOf.get(current);
    if (!next) {
      return current;
    }
    if (seen.has(next)) {
      return null;
    }
    seen.add(next);
    current = next;
  }
  return null;
}

/**
 * Fan-out of an arrêté's entry communes to their confirmed watchers
 * (docs/research/jorf-monitor.md, "Рассылка: outbox на VeilleNotification").
 * A watcher of a commune since merged into one of `entryCodes` is resolved
 * through `successorOf` and still included — a subscription must not go
 * silently quiet because its commune was absorbed by another. Grouped by
 * `veilleId`: a watcher of several of the arrêté's communes is one recipient
 * carrying all of them, not one per commune, so the caller sends exactly one
 * email per (veille, arrêté).
 */
export function resolveRecipients(
  entryCodes: readonly string[],
  successorOf: ReadonlyMap<string, string>,
  subscriptions: readonly SubscribedCommune[],
): ArreteRecipient[] {
  const wanted = new Set(entryCodes);
  const codesByVeille = new Map<string, Set<string>>();

  for (const subscription of subscriptions) {
    if (!subscription.confirmed) {
      continue;
    }
    const resolved = resolveCurrentCode(subscription.codeInsee, successorOf);
    if (resolved === null || !wanted.has(resolved)) {
      continue;
    }
    const codes = codesByVeille.get(subscription.veilleId) ?? new Set<string>();
    codes.add(resolved);
    codesByVeille.set(subscription.veilleId, codes);
  }

  return [...codesByVeille.entries()].map(([veilleId, codes]) => ({
    veilleId,
    codeInsee: [...codes].sort(),
  }));
}

/**
 * Drops the entries a sinistre letter to the same address already named for
 * this arrêté (docs/research/sinistre-plan.md, "Письмо владельцу синистра и
 * дедупликация с veille"). The unit is the entry, not its commune: an arrêté
 * names the same commune once per (risque, période) and can recognise one and
 * refuse another, while the sinistre letter covers exactly the one entry its
 * dossier is linked to — subtracting the whole commune would silence the
 * arrêté's verdict on that commune's other risques, which no letter would
 * then carry. Identity is the entry id, not a (commune, risque, période)
 * tuple, so the two sides cannot disagree over a merged commune's code the
 * way `codeInsee` would (PRD, "Коммуна сопоставляется через
 * `successorCodeInsee`").
 * The caller decides what an empty result means (drain without sending);
 * this function only computes the remainder.
 */
export function subtractCoveredEntries<Entry extends { id: string }>(
  entries: readonly Entry[],
  coveredEntryIds: ReadonlySet<string>,
): Entry[] {
  return entries.filter((entry) => !coveredEntryIds.has(entry.id));
}
