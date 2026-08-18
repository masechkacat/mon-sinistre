/**
 * The only file of user-facing strings in the API. Features add their strings to
 * branches of this same object; a second such file must not appear.
 */

/**
 * The only place "arrêté" is written: elsewhere the term must appear as part of
 * this explaining phrase, which fr.spec.ts enforces over the whole dictionary.
 */
const ARRETE_CATNAT =
  'l’arrêté de catastrophe naturelle (la décision de l’État qui permet à votre assurance d’indemniser les dégâts)';

/** French elides "que" before a vowel or a mute h: "parce qu’il", not "parce que il". */
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
      why: (reason: string) => `Vous recevez ce message ${because(reason)}.`,
      purpose: `Mon Sinistre vous prévient dès la publication de ${ARRETE_CATNAT} et rappelle les délais à ne pas laisser passer.`,
      // The space before the colon is a literal U+00A0, not &nbsp; — the text
      // version carries no HTML entities. Do not "fix" it to a plain space.
      noReply:
        'Ce message est envoyé automatiquement : les réponses envoyées à cette adresse ne sont lues par personne.',
      unsubscribe: 'Ne plus recevoir de messages',
      signature:
        'Mon Sinistre — être accompagné après une catastrophe naturelle',
    },
    veille: {
      confirmation: {
        subject: 'Confirmez votre inscription à la veille Mon Sinistre',
        // Concatenated, not a template literal: no-irregular-whitespace
        // exempts plain strings but not templates, and the space before ":"
        // must stay a literal U+00A0 (French typography, see
        // fr.mail.footer.noReply above).
        intro:
          'Vous avez demandé à être averti·e dès la publication de ' +
          ARRETE_CATNAT +
          ' pour les communes suivantes :',
        confirmLink: 'Confirmer votre inscription',
        expiresIn: (days: string) =>
          `Ce lien de confirmation est valable ${days} jours.`,
      },
      change: {
        subject: 'Confirmez la modification de votre veille Mon Sinistre',
        // Concatenated for the same reason as confirmation.intro above: the
        // space before ":" must stay a literal U+00A0.
        intro:
          'Vous avez demandé à modifier votre veille Mon Sinistre. Le' +
          ' nouveau suivi porterait sur les communes suivantes :',
        changeLink: 'Confirmer la modification',
        expiresIn: (days: string) =>
          `Ce lien de modification est valable ${days} jours.`,
      },
      reason:
        'vous avez laissé votre adresse sur le formulaire de veille de Mon Sinistre',
    },
    jorf: {
      alert: {
        subject: 'Alerte moniteur JORF — Mon Sinistre',
        intro: 'Le moniteur du Journal Officiel a généré une alerte technique.',
        kindLabel: {
          UNPARSEABLE_ANNEXE:
            'Un texte du Journal Officiel n’a pas pu être analysé automatiquement.',
          UNMATCHED_COMMUNE:
            'Une commune citée par un texte du Journal Officiel n’a pas pu être rapprochée du référentiel.',
          OUTCOME_CHANGED:
            'Un texte rectificatif a changé l’issue d’une commune déjà enregistrée.',
        },
        reason:
          'vous êtes destinataire des alertes techniques du moniteur JORF de Mon Sinistre',
      },
    },
  },
} as const;
