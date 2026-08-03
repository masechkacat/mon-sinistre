/**
 * The only file of user-facing strings in the API (decision:
 * docs/research/emails.md). A typed dictionary rather than an i18n library:
 * French is the single language of the product — "languages other than French"
 * are out of scope (docs/prd/emails.md) — so the resolving, fallbacks and CLDR
 * plurals of a library buy nothing, while TypeScript buys what a JSON catalogue
 * cannot: a missing key or a forgotten parameter is a compile error, not an
 * empty string inside a French email.
 *
 * Feature owners add the strings of their own emails to branches of this same
 * object (fr.mail.veille…); the email skeleton owns senderName, terms and
 * footer. A second file of French strings must not appear in apps/api — the two
 * would drift apart. And no user-facing text goes to packages/contracts.
 */

/**
 * Administrative terms are spelled out in plain words at first use: the reader
 * has just been through a disaster and meets the procedure for the first time
 * (PRD, "Ограничения"). This phrase is the only place where "arrêté" is
 * written — everywhere else the term must appear as part of it, which
 * fr.spec.ts enforces over the whole dictionary.
 */
const ARRETE_CATNAT =
  'l’arrêté de catastrophe naturelle (la décision de l’État qui permet à votre assurance d’indemniser les dégâts)';

/**
 * French elides "que" before a vowel or a mute h. The reason comes from the
 * feature that owns the email, so the elision cannot be baked into the
 * template: "parce que il reste 3 jours" would be the first line the reader
 * sees of a message they did not expect.
 */
const because = (reason: string): string =>
  /^[aàâeéèêëiîïoôuùûüyh]/i.test(reason)
    ? `parce qu’${reason}`
    : `parce que ${reason}`;

export const fr = {
  mail: {
    senderName: 'Mon Sinistre',
    terms: {
      arreteCatNat: ARRETE_CATNAT,
    },
    footer: {
      // The reason is supplied by the feature that owns the email: only it
      // knows why this address is on its list.
      why: (reason: string) => `Vous recevez ce message ${because(reason)}.`,
      // Describes the service, never the reader: the same footer goes into
      // every email, including reminders sent to someone who watches no
      // commune at all. What brought *this* message is what why() says.
      purpose: `Mon Sinistre vous prévient dès la publication de ${ARRETE_CATNAT} et rappelle les délais à ne pas laisser passer.`,
      // Non-breaking space before the colon: French typography, and it keeps
      // the colon off the next line in the text version too. A literal U+00A0,
      // not &nbsp; — the text version carries no HTML entities.
      noReply:
        'Ce message est envoyé automatiquement : les réponses envoyées à cette adresse ne sont lues par personne.',
      unsubscribe: 'Ne plus recevoir de messages',
      signature:
        'Mon Sinistre — être accompagné après une catastrophe naturelle',
    },
  },
} as const;
