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
  auth: {
    password: {
      /**
       * Names every requirement at once (docs/research/user-account.md,
       * «Правила пароля» — «Как применять»): a rejected password should not
       * make the visitor guess which rule it broke. Concatenated, not a
       * template literal: no-irregular-whitespace exempts plain strings but
       * not templates, and the space before ":" must stay a literal U+00A0
       * (French typography, see fr.mail.footer.noReply below).
       */
      requirements: (minLength: string, maxBytes: string, minClasses: string) =>
        'Le mot de passe doit compter au moins ' +
        minLength +
        ' caractères, ne pas dépasser ' +
        maxBytes +
        ' octets (un caractère accentué ou un emoji en compte plusieurs) et ' +
        'combiner au moins ' +
        minClasses +
        ' des catégories suivantes : majuscule, minuscule, chiffre, caractère spécial.',
    },
    login: {
      /**
       * One message for every rejection reason (unknown address, wrong
       * password, unconfirmed account) — anti-enumeration
       * (`src/auth/CLAUDE.md`): a distinct wording per cause would tell a
       * caller which one applied.
       */
      invalid: 'Adresse e-mail ou mot de passe incorrect.',
      /** One message regardless of whether the address has an account —
       * anti-enumeration, same reason as `invalid` above
       * (`src/auth/CLAUDE.md`). */
      tooManyAttempts: 'Trop de tentatives, réessayez plus tard.',
    },
    session: {
      /** Covers every refresh rejection — missing cookie, bad signature,
       * expired or already-rotated token, reuse of a revoked one — the same
       * one message, for the same anti-enumeration reason as login.invalid
       * above: a distinct wording per cause would tell a caller which one
       * applied. */
      expired: 'Votre session a expiré, veuillez vous reconnecter.',
    },
  },
  sinistres: {
    eventDateRequired: 'La date de l’événement est obligatoire.',
    eventDateInvalid:
      'La date de l’événement doit être une date réelle, au format AAAA-MM-JJ (par exemple 2026-06-15).',
    eventDateInFuture:
      'La date de l’événement ne peut pas être postérieure à aujourd’hui.',
    declarationDateRequired: 'La date de déclaration est obligatoire.',
    declarationDateInvalid:
      'La date de déclaration doit être une date réelle, au format AAAA-MM-JJ (par exemple 2026-06-15), ou vide.',
    declarationDateInFuture:
      'La date de déclaration ne peut pas être postérieure à aujourd’hui.',
    declarationDateBeforeEvent:
      'La date de déclaration ne peut pas être antérieure à la date de l’événement.',
    unknownCommune: 'Commune inconnue.',
  },
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
    account: {
      confirmation: {
        subject: 'Confirmez votre adresse pour votre compte Mon Sinistre',
        intro: 'Vous avez créé un compte sur Mon Sinistre avec cette adresse.',
        confirmLink: 'Confirmer mon compte',
        expiresIn: (days: string) =>
          `Ce lien de confirmation est valable ${days} jours.`,
      },
      passwordReset: {
        subject: 'Réinitialisation de votre mot de passe Mon Sinistre',
        intro:
          'Vous avez demandé la réinitialisation du mot de passe de votre ' +
          'compte Mon Sinistre.',
        resetLink: 'Choisir un nouveau mot de passe',
        expiresIn: (hours: string) => `Ce lien est valable ${hours} heures.`,
      },
      alreadyRegistered: {
        subject: 'Vous avez déjà un compte Mon Sinistre',
        intro:
          'Une inscription a été tentée sur Mon Sinistre avec cette adresse, ' +
          'mais un compte existe déjà. Si ce n’était pas vous, vous pouvez ' +
          'ignorer ce message.',
        resetRequestLink: 'Mot de passe oublié',
      },
      reason: 'vous avez créé un compte sur Mon Sinistre avec cette adresse',
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
        // One message carries the whole run's alerts: an arrêté lists hundreds
        // of communes, and a referential that resolves none of them would mean
        // hundreds of messages for one publication (src/jorf/).
        intro: (count: string) =>
          count === '1'
            ? 'Le moniteur du Journal Officiel a généré une alerte technique.'
            : `Le moniteur du Journal Officiel a généré ${count} alertes techniques.`,
        kindLabel: {
          UNPARSEABLE_ANNEXE:
            'Un texte du Journal Officiel — ou une mention qu’il contient — n’a pas pu être analysé automatiquement.',
          UNMATCHED_COMMUNE:
            'Une commune citée par un texte du Journal Officiel n’a pas pu être rapprochée du référentiel.',
          OUTCOME_CHANGED:
            'Un texte rectificatif a changé l’issue d’une commune déjà enregistrée.',
          NOTIFICATION_STUCK:
            'Un courriel de veille n’a pas pu être remis après plusieurs tentatives.',
        },
        more: (count: string) =>
          `${count} autres alertes ne sont pas détaillées ici. Toutes sont enregistrées et consultables côté serveur.`,
        reason:
          'vous êtes destinataire des alertes techniques du moniteur JORF de Mon Sinistre',
      },
      notification: {
        subject: 'Catastrophe naturelle — suivi de votre commune',
        intro: (publishedDate: string) =>
          `Le Journal officiel du ${publishedDate} publie ${ARRETE_CATNAT}, qui concerne au moins une des communes que vous suivez.`,
        entryLine: (
          commune: string,
          risque: string,
          eventStart: string,
          eventEnd: string,
          outcome: string,
        ) =>
          `${commune} — ${risque}, du ${eventStart} au ${eventEnd} — ${outcome}.`,
        outcomeLabel: {
          RECONNU: 'état de catastrophe naturelle reconnu',
          REFUSE: 'état de catastrophe naturelle non reconnu (demande refusée)',
        },
        deadline: (date: string) =>
          `Vous disposez d’un délai légal pour déclarer le sinistre à votre assurance, au plus tard le ${date}.`,
        legifranceLink: 'Consulter le texte complet sur Légifrance',
        reason: 'vous suivez une ou plusieurs communes concernées par ce texte',
      },
      // deadline and legifranceLink are not repeated here — the composer
      // reuses fr.mail.jorf.notification's own strings for that sentence and
      // that link, worded identically for the same fact.
      sinistreNotification: {
        subject: 'Catastrophe naturelle — votre sinistre',
        // «Déclarer» dans ce produit, c'est la déclaration à l'assurance —
        // celle que la phrase suivante du message donne encore à faire ;
        // l'annoncer ici comme déjà faite ferait manquer ce délai.
        intro: (commune: string, risque: string, publishedDate: string) =>
          `Le Journal officiel du ${publishedDate} publie ${ARRETE_CATNAT}, qui reconnaît l’état de catastrophe naturelle pour ${commune} (${risque}). Ce texte concerne le dossier que vous suivez sur Mon Sinistre.`,
        sinistreLink: 'Voir mon dossier',
        reason:
          'vous suivez un dossier de sinistre concernant cette commune sur Mon Sinistre',
      },
    },
  },
} as const;
