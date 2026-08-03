import { fr } from 'src/i18n/fr';

type Translation = string | ((...args: string[]) => string);
type Dictionary = { readonly [key: string]: Translation | Dictionary };

interface Leaf {
  readonly path: string;
  readonly text: string;
}

// Every leaf of the dictionary as a rendered string. Parametrised entries are
// called with marker arguments, so the guards below see their template too — a
// term left unexplained inside a template string is the same defect as in a
// plain one. What is substituted at runtime is not covered here: the values
// come from the calling feature, which owes them the same rules.
const flatten = (node: Dictionary, prefix = ''): Leaf[] =>
  Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') return [{ path, text: value }];
    if (typeof value === 'function') {
      const args = Array.from({ length: value.length }, (_, i) => `{arg${i}}`);
      return [{ path, text: value(...args) }];
    }
    return flatten(value, path);
  });

const LEAVES = flatten(fr);

describe('fr dictionary', () => {
  it('is not empty — the whole point of the file is to hold the strings', () => {
    expect(LEAVES.length).toBeGreaterThan(0);
  });

  it.each(LEAVES)('$path is a non-empty string', ({ text }) => {
    expect(text.trim()).not.toBe('');
    // A parameter the renderer forgot to pass surfaces here rather than in the
    // reader's mailbox: flatten() calls every function field with markers.
    expect(text).not.toMatch(/undefined|null|NaN/);
  });

  // French typography: no ordinary space before : ; ! ? » and none after « —
  // the punctuation would wrap to the next line on its own, leaving a quote
  // mark orphaned at the end of a line. A literal U+00A0 (or U+202F) is
  // expected, never &nbsp;, because the same strings render into the text
  // version.
  it.each(LEAVES)('$path keeps its punctuation attached', ({ text }) => {
    expect(text).not.toMatch(/ [:;!?»]|« /);
  });

  // Both the text and the HTML version are rendered from these strings, and the
  // text one must carry no markup at all (docs/research/emails.md).
  it.each(LEAVES)('$path carries no markup nor HTML entity', ({ text }) => {
    expect(text).not.toMatch(/[<>]|&[a-z]+;|&#\d+;/i);
  });

  // The reader meets the procedure for the first time and is under stress:
  // administrative terms are spelled out in plain words (PRD, "Ограничения").
  // Enforced structurally — the term may only appear inside the phrase that
  // explains it, so a new string cannot reintroduce a bare "arrêté"/"CatNat".
  it.each(LEAVES)('$path never uses an unexplained term', ({ text }) => {
    if (!/arrêté|catnat/i.test(text)) return;
    expect(text).toContain(fr.mail.terms.arreteCatNat);
  });
});

describe('fr.mail.terms.arreteCatNat', () => {
  // Asserts the shape, not the wording: the gloss may be reworded, it may not
  // disappear. Without the parenthesis the term would travel bare.
  it('names the term and carries a plain-words gloss with it', () => {
    expect(fr.mail.terms.arreteCatNat).toMatch(/^[^(]*arrêté[^(]*\(.+\)$/);
  });
});

describe('fr.mail.footer', () => {
  it('tells the reader why the message reached them', () => {
    expect(fr.mail.footer.why('vous suivez la commune de Nîmes')).toBe(
      'Vous recevez ce message parce que vous suivez la commune de Nîmes.',
    );
  });

  it.each([
    ['un arrêté vient d’être publié', 'parce qu’un arrêté'],
    ['il reste 3 jours pour déclarer', 'parce qu’il reste'],
    ['votre commune est concernée', 'parce que votre commune'],
  ])('elides "que" before %s', (reason, expected) => {
    // The reason comes from the owning feature; a bare template would print
    // "parce que il reste 3 jours" in the first line of the footer.
    expect(fr.mail.footer.why(reason)).toContain(expected);
  });

  it('names the unsubscribe link by its action, not by "cliquez ici"', () => {
    // A screen reader announces links out of context; "cliquez ici" would read
    // as one of several identical links (WCAG 2.1 AA, docs/research/emails.md).
    expect(fr.mail.footer.unsubscribe).not.toMatch(/cliqu|\bici\b/i);
  });

  it('warns that answers to the sender address are not read', () => {
    // MAIL_FROM is a no-reply address and the domain MX is a blackhole
    // (docs/research/emails.md): saying so is the honest part of the footer.
    expect(fr.mail.footer.noReply).toMatch(/répon/i);
  });
});
