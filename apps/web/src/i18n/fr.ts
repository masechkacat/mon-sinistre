import {
  DurationUnit,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_CHAR_CLASSES,
  PASSWORD_MIN_LENGTH,
  RisqueCatnat,
  SinistreStatus,
  StepAnchor,
  StepKind,
} from '@mon-sinistre/contracts';

// The space before ":" and "?" is a literal U+00A0, not a typo — same
// convention as apps/api/src/i18n/fr.ts.

const CHECK_WITH_CONTRACT = 'à vérifier avec votre contrat et votre assurance';

const EVENT_DATE_HINT =
  'Le jour où les dégâts se sont produits : jour, mois, puis année. Par exemple 05/09/2026 pour le 5 septembre 2026.';

// Shared across veille.confirmation and veille.change below: same fact
// (link being checked, link no longer usable, alert reaches the watched
// communes), same wording — one string, not a fact stated twice.
const VEILLE_LINK_VERIFYING = 'Vérification du lien en cours…';
const VEILLE_ARRETE_ALERT =
  'Vous recevrez un message le jour même de la publication d’un arrêté de catastrophe naturelle concernant une des communes surveillées.';

// Shared by every confirm-by-link screen (veille.confirmation,
// veille.change, compte.confirmation below) — one wording per fact, not one
// copy per feature.
const INVALID_LINK = 'Lien invalide';
const INVALID_CONFIRMATION_LINK_DESCRIPTION =
  'Ce lien de confirmation n’est plus valable : il a peut-être déjà été utilisé, ou son délai de validité est dépassé.';
const CONFIRM = 'Confirmer';
const CANCEL = 'Annuler';
const CONFIRMING = 'Confirmation en cours…';
const CHECK_YOUR_INBOX = 'Vérifiez votre boîte e-mail';

// The two account entry points name each other, so each label is written
// once and reused by the page it titles, by the link that leads there and by
// the header (layout, compte.inscription, compte.connexion,
// compte.confirmation below).
const CREATE_ACCOUNT = 'Créer un compte';
const LOG_IN = 'Se connecter';

// Shared by every commune search field (veille.form's multi-select,
// commune.select below) — one wording per fact, not one copy per feature.
const COMMUNE_SEARCH_PLACEHOLDER = 'Nom de la commune ou code INSEE';
const COMMUNE_NONE_FOUND = 'Aucune commune trouvée';

// Shared by every form with a plain email field (veille.form,
// compte.inscription below) — one wording per fact, not one copy per
// feature.
const EMAIL_LABEL = 'Adresse e-mail';
const EMAIL_PLACEHOLDER = 'vous@exemple.fr';
const EMAIL_REQUIRED_ERROR = 'Indiquez votre adresse e-mail.';
const EMAIL_INVALID_ERROR = 'Indiquez une adresse e-mail valide.';
const PRIVACY_POLICY_LINK = 'Consulter notre politique de confidentialité';

// Same wording and same source as the server-side message
// (apps/api/src/i18n/fr.ts, `auth.password.requirements`) — the two files
// serve different runtimes, so the string cannot live in one place, but it
// names every requirement at once for the same reason: a rejected password
// should not make the visitor guess which rule it broke.
const PASSWORD_REQUIREMENTS =
  'Le mot de passe doit compter au moins ' +
  String(PASSWORD_MIN_LENGTH) +
  ' caractères, ne pas dépasser ' +
  String(PASSWORD_MAX_BYTES) +
  ' octets (un caractère accentué ou un emoji en compte plusieurs) et ' +
  'combiner au moins ' +
  String(PASSWORD_MIN_CHAR_CLASSES) +
  ' des catégories suivantes  : majuscule, minuscule, chiffre, caractère spécial.';

// Shared by every form with a password field (compte.inscription,
// compte.reinitialisation below) — one wording per fact, not one copy per
// feature.
const PASSWORD_REQUIRED_ERROR = 'Choisissez un mot de passe.';

// Said by every screen waiting on a change it has just sent (veille.change,
// compte.reinitialisation, compte.espacePersonnel.rappels below).
const UPDATING = 'Modification en cours…';
// The reminders switch is reached two ways — the link in the mail and the
// espace personnel (compte.rappels, compte.espacePersonnel below) — and names
// the same action on both.
const REMINDERS_DISABLE = 'Désactiver les rappels';

// The dossier link is written once and read twice below (sinistres.list):
// as the text on screen, and inside the longer name a screen reader gets.
const VIEW_MY_DOSSIER = 'Voir mon dossier';
const DONE = 'Fait';

const PREPARE_MY_DOSSIER = 'Préparer mon dossier';
const OPEN_MY_DOSSIER = 'Ouvrir mon dossier';
const EVENT_OF = (date: string) => `Événement du ${date}`;

const emptyContainer = (content: string) =>
  `${content} : cet espace n’est pas encore ouvert.`;

const afterAnchor: Record<StepAnchor, string> = {
  [StepAnchor.DATE_SINISTRE]: 'après le sinistre',
  [StepAnchor.DATE_PUBLICATION_ARRETE]: 'après l’arrêté',
  [StepAnchor.DATE_DECLARATION]: 'après votre déclaration',
  [StepAnchor.DATE_ETAT_ESTIMATIF]: 'après l’état estimatif',
  [StepAnchor.DATE_ETAT_ESTIMATIF_OU_EXPERTISE]:
    'après l’état estimatif ou l’expertise',
  [StepAnchor.DATE_ACCORD_INDEMNISATION]: 'après l’accord d’indemnisation',
};

export const fr = {
  serviceName: 'Mon Sinistre',
  layout: {
    metaDescription:
      'Veille des arrêtés de catastrophe naturelle et suivi du sinistre',
    skipToContent: 'Aller au contenu principal',
    mainNav: 'Navigation principale',
    login: LOG_IN,
    espace: 'Mon espace',
    legalNav: 'Informations légales',
  },
  home: {
    title: 'Après une catastrophe naturelle, chaque jour compte',
    lead: 'Mon Sinistre vous prévient dès que l’État reconnaît la catastrophe dans votre commune, puis vous aide à faire vos démarches auprès de votre assurance sans manquer aucun délai.',
    communeLabel: 'Quelle est votre commune ?',
    catnat: {
      heading: 'L’arrêté de catastrophe naturelle, expliqué simplement',
      event:
        'Une catastrophe naturelle, c’est un événement d’une intensité inhabituelle : une inondation, une coulée de boue, une sécheresse qui fissure les murs, un séisme.',
      arrete:
        'Pour que votre assurance puisse indemniser les dégâts causés par une telle catastrophe, l’État doit d’abord la reconnaître officiellement. Cette décision s’appelle un arrêté de catastrophe naturelle. Elle est publiée au Journal officiel, le journal où l’État publie ses décisions.',
      deadline:
        'À partir de cette publication, il ne vous reste qu’un délai court pour déclarer vos dégâts à votre assurance. Passé ce délai, l’indemnisation peut être refusée.',
    },
    does: {
      heading: 'Ce que Mon Sinistre fait',
      items: [
        'Vous prévient le jour même de la publication de l’arrêté qui concerne votre commune.',
        'Vous propose un plan d’action clair dès le premier jour après la catastrophe.',
        'Suit vos échéances (déclaration à l’assurance, étapes du dossier) et vous les rappelle à temps.',
        'Vous aide à faire l’inventaire de vos dégâts, photos à l’appui.',
      ],
    },
    doesNot: {
      heading: 'Ce que Mon Sinistre ne fait pas',
      items: [
        `Ne donne pas de conseils juridiques : les dates calculées sont indicatives, ${CHECK_WITH_CONTRACT}.`,
        'N’écrit jamais à votre assurance à votre place : vous gardez la main sur toutes vos démarches.',
      ],
    },
  },
  commune: {
    searchPlaceholder: COMMUNE_SEARCH_PLACEHOLDER,
    noneFound: COMMUNE_NONE_FOUND,
    clearSelection: 'Effacer la commune sélectionnée',
    selected: (label: string) => `Commune sélectionnée : ${label}`,
  },
  communeAnswer: {
    testPage: 'Arrêtés d’une commune',
    loading: 'Recherche des arrêtés…',
    found: (count: number, commune: string) =>
      `${count} arrêté${count > 1 ? 's' : ''} trouvé${count > 1 ? 's' : ''} pour ${commune}.`,
    none: (commune: string) => `Aucun arrêté récent pour ${commune}.`,
    noneSince: (months: number) =>
      `Aucune catastrophe naturelle n’a été reconnue pour cette commune depuis ${months} mois. Un arrêté peut paraître plusieurs semaines après l’événement : si vous avez des dégâts, vous pouvez préparer votre dossier dès maintenant.`,
    prepare: PREPARE_MY_DOSSIER,
    period: (start: string, end: string) =>
      start === end ? EVENT_OF(start) : `${EVENT_OF(start)} au ${end}`,
    refusal:
      'Reconnaissance refusée : l’État n’a pas reconnu cet événement comme catastrophe naturelle pour cette commune.',
    open: OPEN_MY_DOSSIER,
    openFor: (arrete: string) => `${OPEN_MY_DOSSIER} : ${arrete}`,
  },
  deadlineBadge: {
    lastWeek: 'Dernière semaine',
    tomorrow: 'Demain',
    today: 'Aujourd’hui, dernier délai',
    overdue: 'En retard',
    fait: (date: string | null) => (date ? `${DONE} le ${date}` : DONE),
    nonApplicable: 'Sans objet',
    upcomingDate: 'Date à venir',
    plannedOn: (date: string) => `Prévue le ${date}`,
    duration: (
      { value, unit }: { value: number; unit: DurationUnit },
      anchor: StepAnchor | null,
    ) => {
      const duration =
        unit === DurationUnit.MONTHS
          ? `${value} mois`
          : `${value} jour${value === 1 ? '' : 's'}`;
      return anchor ? `${duration} ${afterAnchor[anchor]}` : duration;
    },
    countdown: (daysLeft: number) => {
      if (daysLeft === 0) return 'Jour J';
      return daysLeft > 0 ? `J-${daysLeft}` : `J+${-daysLeft}`;
    },
    noDate: '—',
    testPage: 'Badge de délai',
  },
  veille: {
    form: {
      emailLabel: EMAIL_LABEL,
      emailPlaceholder: EMAIL_PLACEHOLDER,
      emailRequiredError: EMAIL_REQUIRED_ERROR,
      emailInvalidError: EMAIL_INVALID_ERROR,
      purpose:
        'Votre adresse e-mail sert uniquement à vous prévenir lorsqu’un arrêté de catastrophe naturelle concerne une commune surveillée.',
      privacyPolicyLink: PRIVACY_POLICY_LINK,
      submitting: 'Inscription en cours…',
    },
    inline: {
      heading: (commune: string) =>
        `Être prévenu·e d’un prochain arrêté pour ${commune}`,
      submit: 'Être prévenu·e',
    },
    confirmationSent: {
      title: CHECK_YOUR_INBOX,
      description:
        'Un e-mail de confirmation vient de vous être envoyé. Ouvrez-le et cliquez sur le lien qu’il contient pour activer votre veille.',
    },
    confirmation: {
      page: { title: 'Confirmer votre inscription' },
      loading: VEILLE_LINK_VERIFYING,
      pending: {
        description:
          'Pour activer votre veille, confirmez que cette adresse e-mail est bien la vôtre.',
      },
      confirmButton: CONFIRM,
      confirming: CONFIRMING,
      active: {
        title: 'Votre veille est active',
        description: VEILLE_ARRETE_ALERT,
      },
      invalid: {
        title: INVALID_LINK,
        description: INVALID_CONFIRMATION_LINK_DESCRIPTION,
      },
    },
    change: {
      page: { title: 'Confirmer la modification de votre veille' },
      loading: VEILLE_LINK_VERIFYING,
      pending: {
        description:
          'Voici la nouvelle liste des communes surveillées. Pour l’appliquer, confirmez la modification.',
      },
      confirmButton: 'Confirmer la modification',
      confirming: UPDATING,
      applied: {
        title: 'Modification appliquée',
        description: `La liste des communes surveillées a été mise à jour. ${VEILLE_ARRETE_ALERT}`,
      },
      invalid: {
        title: INVALID_LINK,
        description:
          'Ce lien de modification n’est plus valable : il a peut-être déjà été utilisé, ou son délai de validité est dépassé.',
      },
    },
    desinscription: {
      confirmer: {
        page: { title: 'Se désinscrire de la veille' },
        description:
          'Vous ne recevrez plus de message en cas d’arrêté de catastrophe naturelle concernant les communes surveillées.',
        unsubscribeButton: 'Se désinscrire',
        unsubscribing: 'Désinscription en cours…',
        done: {
          title: 'Désinscription effectuée',
          description:
            'Votre adresse e-mail a été retirée de la veille. Vous pouvez vous réinscrire à tout moment depuis la page d’inscription.',
        },
      },
    },
  },
  compte: {
    inscription: {
      page: { title: CREATE_ACCOUNT },
      lead: 'Créez votre compte pour accéder à votre espace personnel et suivre votre sinistre.',
      emailLabel: EMAIL_LABEL,
      emailPlaceholder: EMAIL_PLACEHOLDER,
      emailRequiredError: EMAIL_REQUIRED_ERROR,
      emailInvalidError: EMAIL_INVALID_ERROR,
      passwordLabel: 'Mot de passe',
      passwordRequiredError: PASSWORD_REQUIRED_ERROR,
      passwordRequirementsError: PASSWORD_REQUIREMENTS,
      purpose:
        'Votre adresse e-mail et votre mot de passe servent uniquement à créer votre compte et à vous permettre de vous reconnecter.',
      privacyPolicyLink: PRIVACY_POLICY_LINK,
      submit: 'Créer mon compte',
      submitting: 'Création en cours…',
      alreadyRegistered: 'Vous avez déjà un compte ?',
      loginLink: LOG_IN,
      confirmationSent: {
        title: CHECK_YOUR_INBOX,
        description:
          'Un e-mail de confirmation vient de vous être envoyé. Ouvrez-le et cliquez sur le lien qu’il contient, puis confirmez pour activer votre compte.',
      },
    },
    confirmation: {
      page: { title: 'Confirmer votre compte' },
      pending: {
        description:
          'Pour activer votre compte, confirmez que vous êtes bien à l’origine de cette inscription.',
      },
      confirmButton: CONFIRM,
      confirming: CONFIRMING,
      confirmed: {
        title: 'Compte activé',
        description:
          'Votre compte est activé. Vous pouvez maintenant vous connecter.',
      },
      loginLink: LOG_IN,
      invalid: {
        title: INVALID_LINK,
        description: INVALID_CONFIRMATION_LINK_DESCRIPTION,
      },
    },
    connexion: {
      page: { title: LOG_IN },
      lead: 'Connectez-vous pour accéder à votre espace personnel.',
      emailLabel: EMAIL_LABEL,
      emailPlaceholder: EMAIL_PLACEHOLDER,
      emailRequiredError: EMAIL_REQUIRED_ERROR,
      emailInvalidError: EMAIL_INVALID_ERROR,
      passwordLabel: 'Mot de passe',
      passwordRequiredError: 'Indiquez votre mot de passe.',
      submit: LOG_IN,
      submitting: 'Connexion en cours…',
      invalidError: 'Adresse e-mail ou mot de passe incorrect.',
      forgotPasswordLink: 'Mot de passe oublié ?',
      noAccount: 'Pas encore de compte ?',
      registerLink: CREATE_ACCOUNT,
    },
    motDePasseOublie: {
      page: { title: 'Mot de passe oublié' },
      lead: 'Indiquez votre adresse e-mail pour recevoir un lien de réinitialisation de votre mot de passe.',
      emailLabel: EMAIL_LABEL,
      emailPlaceholder: EMAIL_PLACEHOLDER,
      emailRequiredError: EMAIL_REQUIRED_ERROR,
      emailInvalidError: EMAIL_INVALID_ERROR,
      submit: 'Envoyer le lien',
      submitting: 'Envoi en cours…',
      sent: {
        title: CHECK_YOUR_INBOX,
        description:
          'Si cette adresse correspond à un compte, vous allez recevoir un e-mail contenant un lien pour choisir un nouveau mot de passe.',
      },
    },
    reinitialisation: {
      page: { title: 'Choisir un nouveau mot de passe' },
      lead: 'Choisissez votre nouveau mot de passe.',
      passwordLabel: 'Nouveau mot de passe',
      passwordRequiredError: PASSWORD_REQUIRED_ERROR,
      passwordRequirementsError: PASSWORD_REQUIREMENTS,
      submit: 'Changer mon mot de passe',
      submitting: UPDATING,
      invalid: {
        title: INVALID_LINK,
        description:
          'Ce lien de réinitialisation n’est plus valable : il a peut-être déjà été utilisé, ou son délai de validité est dépassé.',
      },
    },
    espacePersonnel: {
      page: { title: 'Espace personnel' },
      intro: 'Vous êtes connecté·e à votre espace personnel.',
      sinistresLink: 'Voir mes sinistres',
      emailLabel: `${EMAIL_LABEL} :`,
      deleteAccount: {
        heading: 'Suppression du compte',
        button: 'Supprimer mon compte',
        warning: {
          title: 'Supprimer définitivement votre compte ?',
          description:
            'Cette action est immédiate et irréversible : votre compte et toutes les données associées seront supprimés. Vous pourrez créer un nouveau compte avec la même adresse e-mail si vous le souhaitez.',
        },
        cancel: CANCEL,
        confirm: 'Supprimer définitivement mon compte',
        deleting: 'Suppression en cours…',
      },
      rappels: {
        heading: 'Rappels par e-mail',
        enabled:
          'Vous recevez un e-mail quand une date de vos dossiers approche ou vient de passer.',
        disabled:
          'Vous ne recevez pas de rappels par e-mail. Les dates restent visibles dans vos dossiers.',
        disable: REMINDERS_DISABLE,
        enable: 'Réactiver les rappels',
        updating: UPDATING,
      },
    },
    rappels: {
      desinscription: {
        page: { title: 'Ne plus recevoir de rappels' },
        description:
          'Vous ne recevrez plus de message vous rappelant les dates à ne pas laisser passer pour vos sinistres. Ces dates restent visibles dans votre espace personnel.',
        unsubscribeButton: REMINDERS_DISABLE,
        unsubscribing: 'Désactivation en cours…',
        done: {
          title: 'Rappels désactivés',
          description:
            'Vous ne recevrez plus de rappels par e-mail. Vous pouvez les réactiver à tout moment depuis votre espace personnel.',
        },
      },
    },
    compteSupprime: {
      page: { title: 'Compte supprimé' },
      description:
        'Votre compte et toutes les données associées ont été supprimés.',
    },
  },
  sinistres: {
    risque: {
      label: 'Quel est le risque à l’origine des dégâts ?',
      requiredError: 'Choisissez le risque à l’origine des dégâts.',
      options: {
        [RisqueCatnat.INONDATION]: {
          label: 'Inondation',
          description:
            'Débordement d’un cours d’eau, submersion marine ou remontée de nappe phréatique.',
        },
        [RisqueCatnat.SECHERESSE]: {
          label: 'Sécheresse',
          description:
            'Fissures dans les murs, apparues après un épisode de sécheresse qui a fait bouger le sol argileux sous la maison.',
        },
        [RisqueCatnat.MOUVEMENT_TERRAIN]: {
          label: 'Mouvement de terrain',
          description:
            'Glissement de terrain, effondrement ou chute de blocs — hors fissures liées à la sécheresse.',
        },
        [RisqueCatnat.SEISME]: {
          label: 'Séisme',
          description: 'Tremblement de terre ou éruption volcanique.',
        },
        [RisqueCatnat.AVALANCHE]: {
          label: 'Avalanche',
          description: 'Coulée de neige.',
        },
        [RisqueCatnat.VENTS_CYCLONIQUES]: {
          label: 'Vents cycloniques',
          description: 'Vents violents liés à un cyclone.',
        },
      },
    },
    nouveau: {
      page: { title: 'Déclarer un sinistre' },
      lead: 'Indiquez la commune, le risque et la date de l’événement pour créer votre dossier et recevoir votre plan d’actions.',
      communeLabel: 'Commune concernée',
      communeRequiredError: 'Choisissez la commune concernée.',
      eventDateLabel: 'Date de l’événement',
      eventDateHint: EVENT_DATE_HINT,
      eventDateRequiredError: 'Indiquez la date de l’événement.',
      eventDateInvalidError:
        'Vérifiez l’année : elle doit comporter quatre chiffres.',
      // Replaces the hint above instead of adding to it: the field carries a
      // single description, and the order of the fields belongs in both.
      eventDatePeriodHint: (start: string, end: string) =>
        `${EVENT_DATE_HINT} L’arrêté couvre les événements du ${start} au ${end} : indiquez le jour exact dans cette période.`,
      eventDatePeriodError: (start: string, end: string) =>
        `Indiquez une date entre le ${start} et le ${end}.`,
      submit: 'Créer mon dossier',
      submitting: 'Création en cours…',
    },
    duplicate: {
      title: 'Vous avez déjà un dossier pour cette commune',
      text: (date: string) =>
        `Un dossier est déjà ouvert pour cette commune et ce type de risque, pour un événement du ${date}. Vous pouvez l’ouvrir, ou créer un second dossier s’il s’agit d’un autre événement.`,
      open: 'Ouvrir ce dossier',
      create: 'Créer un second dossier',
      edit: 'Revenir et corriger',
    },
    // Values are the letter of SinistreStatus (root CLAUDE.md, «Не
    // дублировать»); labels are the only French text a status carries — the
    // list screen shows the status in words, not only via colour (WCAG 2.1
    // AA, apps/web/CLAUDE.md).
    status: {
      [SinistreStatus.AVANT_ARRETE]: 'En attente de la publication d’un arrêté',
      [SinistreStatus.ARRETE_PUBLIE]: 'Arrêté publié',
      [SinistreStatus.ARRETE_REFUSE]: 'Arrêté refusé pour cette commune',
      [SinistreStatus.DECLARE]: 'Déclaré à l’assureur',
      [SinistreStatus.CLOS]: 'Dossier clos',
      [SinistreStatus.SANS_SUITE]: 'Sans suite',
    },
    list: {
      page: { title: 'Mes sinistres' },
      lead: 'Retrouvez ici les dossiers que vous avez créés et leur avancement.',
      newSinistre: 'Déclarer un sinistre',
      empty: {
        description:
          'Vous n’avez pas encore de dossier. Créez-en un pour recevoir votre plan d’actions après une catastrophe naturelle : démarches, délais et rappels.',
      },
      eventDate: EVENT_OF,
      dossierLabel: (risque: string, commune: string) =>
        `${risque} — ${commune}`,
      viewLink: VIEW_MY_DOSSIER,
      viewLinkFor: (dossier: string) => `${VIEW_MY_DOSSIER} : ${dossier}`,
    },
    detail: {
      page: { title: 'Mon dossier' },
      timelineLabel: 'Étapes de votre dossier',
      currentStep: {
        title: 'Étape en cours',
        progress: 'Avancement de votre plan d’actions',
        count: (done: number, total: number) =>
          `${done} étape${done > 1 ? 's' : ''} faite${done > 1 ? 's' : ''} sur ${total}`,
      },
      timeline: {
        label: 'Dates clés de votre dossier',
        event: 'Événement',
        arrete: 'Arrêté',
        declaration: 'Déclaration',
        indemnisation: 'Indemnisation',
        expected: 'attendu',
        published: 'publié',
        refused: 'refusé',
        upcoming: 'à venir',
        before: (date: string) => `avant le ${date}`,
      },
      done: { title: DONE, list: 'Étapes déjà réglées' },
      noDateNoAnchor: 'Cette étape n’a pas encore de date prévue.',
      mark: {
        fait: 'Marquer comme fait',
        nonApplicable: 'Non applicable',
        cancel: 'Annuler ce choix',
        subject: (step: string) => `, pour « ${step} »`,
      },
      announcement: {
        fait: (step: string) => `« ${step} » est marqué comme fait.`,
        nonApplicable: (step: string) =>
          `« ${step} » est marqué comme non applicable.`,
        undone: (step: string) => `Le choix pour « ${step} » est annulé.`,
      },
      markFailure:
        'L’étape n’a pas pu être mise à jour. Elle garde son état précédent : réessayez dans un instant.',
      declaration: {
        label: 'Date de votre déclaration à l’assureur',
        hint: 'Le jour où vous avez prévenu votre assureur du sinistre. Les dates du plan qui en dépendent se calculent à partir de ce jour.',
        required: 'Indiquez la date de votre déclaration.',
        failure:
          'La date n’a pas pu être enregistrée. Vérifiez-la et réessayez dans un instant.',
        save: 'Enregistrer la date',
        saved: 'La date de déclaration est enregistrée.',
        clear: 'Effacer la date',
        cleared: 'La date de déclaration est effacée.',
        clearFailure:
          'La date n’a pas pu être effacée. Elle est toujours enregistrée : réessayez dans un instant.',
      },
      deletion: {
        open: 'Supprimer ce dossier',
        title: 'Supprimer ce dossier ?',
        text: 'Le dossier, son plan et ses dates seront effacés définitivement. Cette action ne peut pas être annulée.',
        confirm: 'Supprimer définitivement',
        cancel: CANCEL,
        failure:
          'Le dossier n’a pas pu être supprimé. Il est toujours là : réessayez dans un instant.',
      },
      waitingFor: {
        [StepAnchor.DATE_SINISTRE]:
          'La date de cette étape n’a pas pu être calculée. Vérifiez le délai avec votre assureur.',
        [StepAnchor.DATE_PUBLICATION_ARRETE]:
          'Elle sera connue quand l’arrêté de catastrophe naturelle de votre commune sera publié au Journal officiel.',
        [StepAnchor.DATE_DECLARATION]:
          'Elle sera connue quand vous indiquerez la date de votre déclaration à l’assureur.',
        [StepAnchor.DATE_ETAT_ESTIMATIF]:
          'Elle dépend de l’état estimatif de l’assureur, qui n’est pas encore établi.',
        [StepAnchor.DATE_ETAT_ESTIMATIF_OU_EXPERTISE]:
          'Elle dépend de l’état estimatif ou de l’expertise de l’assureur, qui ne sont pas encore intervenus.',
        [StepAnchor.DATE_ACCORD_INDEMNISATION]:
          'Elle dépend de la date de l’accord de l’assureur sur l’indemnisation, qui n’est pas encore connue.',
      },
      deadline: {
        heading: 'Délai de déclaration à votre assureur',
      },
      source: {
        link: (subject: string) => `Voir le texte de référence : ${subject}`,
        verified: (date: string) => `Source vérifiée le ${date}.`,
        outdated: (months: number) =>
          `Source non revérifiée depuis plus de ${months} mois : la date peut avoir changé.`,
        indicative: `Date indicative, ${CHECK_WITH_CONTRACT}.`,
      },
    },
  },
  dossier: {
    page: { title: 'Aperçu de mon dossier' },
    testPage: 'Plan du dossier',
    loading: 'Chargement de votre dossier…',
    publishedOn: (date: string) => `Publié au Journal officiel le ${date}`,
    legifranceLink: 'Consulter l’arrêté sur Légifrance',
    deadlineExpired: 'Délai expiré',
    save: 'Enregistrer ce dossier',
    saving: 'Enregistrement du dossier…',
    failureAfterLogin:
      'Vous êtes bien connecté, mais votre dossier n’a pas pu être enregistré.',
    back: 'Revenir à mon dossier',
    summary: (parts: readonly string[]) =>
      `Votre dossier : ${parts.join(' · ')}`,
    form: {
      title: PREPARE_MY_DOSSIER,
      lead: 'Indiquez ce qui manque : votre plan d’actions s’affiche aussitôt, sans compte ni inscription.',
      submit: 'Voir mon plan d’actions',
      paramsRefused:
        'Ces informations n’ont pas pu être utilisées. Vérifiez la commune, le risque et la date de l’événement, puis réessayez.',
      refine: {
        title: 'Préciser la date de l’événement',
        submit: 'Mettre à jour la date',
      },
      unchanged: {
        refused:
          'Ce sont les informations qui n’ont pas pu être utilisées : modifiez la commune, le risque ou la date.',
        refine:
          'C’est déjà la date de ce dossier : choisissez-en une autre dans la période pour mettre le plan à jour.',
      },
    },
    container: {
      [StepKind.PHOTOS]: emptyContainer('Photos et vidéos des dégâts'),
      [StepKind.JUSTIFICATIFS]: emptyContainer(
        'Factures, devis et autres justificatifs',
      ),
      [StepKind.OBJETS]: emptyContainer(
        'Liste des objets endommagés et de leur valeur',
      ),
      [StepKind.DECLARATION]: emptyContainer(
        'Date de votre déclaration à l’assureur',
      ),
    },
  },
  session: {
    checking: 'Vérification de la session…',
    logout: 'Se déconnecter',
  },
  serverError: {
    title: 'Une erreur est survenue',
    description:
      'Le service a rencontré un problème inattendu. Ce n’est pas de votre faute. Vous pouvez réessayer, ou revenir un peu plus tard.',
    retry: 'Réessayer',
    digestLabel: 'Référence technique :',
  },
  requestError: {
    title: 'Impossible de récupérer ces informations',
    description:
      'Une erreur est survenue pendant le chargement. Vérifiez votre connexion et réessayez dans quelques instants.',
  },
  notFound: {
    title: 'Page introuvable',
    description:
      'La page que vous cherchez n’existe pas ou n’est plus disponible. L’adresse contient peut-être une erreur.',
    backHome: 'Retourner à l’accueil',
  },
  mentionsLegales: {
    title: 'Mentions légales',
    sections: [
      {
        heading: 'Éditeur du site',
        paragraphs: [
          'Le site Mon Sinistre est édité à titre non professionnel par [prénom et nom — à compléter avant publication].',
          'Adresse : [adresse postale — à compléter ou à omettre avant publication].',
          'Contact : [adresse électronique — à compléter avant publication].',
        ],
      },
      {
        heading: 'Directeur de la publication',
        paragraphs: [
          'Le directeur de la publication, c’est-à-dire la personne responsable de ce qui est publié sur le site, est l’éditeur du site, [prénom et nom — à compléter avant publication].',
        ],
      },
      {
        heading: 'Hébergeur',
        paragraphs: [
          'Le site est hébergé par [dénomination de l’hébergeur — à compléter avant publication], [adresse — à compléter], [téléphone — à compléter].',
        ],
      },
      {
        heading: 'Crédits',
        paragraphs: [
          'Police Luciole © Laurent Bourcellier & Jonathan Perez, 2019, licence CC BY 4.0.',
          'Police Newsreader © 2020 The Newsreader Project Authors, SIL Open Font License 1.1.',
        ],
        links: [
          {
            text: 'Site de la police Luciole (luciole-vision.com)',
            href: new URL('https://www.luciole-vision.com/'),
          },
          {
            text: 'Texte de la licence CC BY 4.0',
            href: new URL('https://creativecommons.org/licenses/by/4.0/'),
          },
          {
            text: 'Sources de la police Newsreader sur GitHub',
            href: new URL('https://github.com/productiontype/Newsreader'),
          },
        ],
      },
    ],
  },
  accessibilite: {
    title: 'Déclaration d’accessibilité',
    sections: [
      {
        heading: 'État de conformité',
        paragraphs: [
          'Mon Sinistre est non conforme au référentiel général d’amélioration de l’accessibilité (RGAA) version 4.1.2, le référentiel français qui décline pour les services en ligne les règles internationales d’accessibilité WCAG.',
          '« Non conforme » est le statut prévu par le référentiel tant qu’aucun audit complet n’a été réalisé : il ne veut pas dire que le site est inutilisable, mais que sa conformité n’a pas encore été établie sur les 106 critères du RGAA. Cet audit est prévu, et ce statut sera corrigé à son issue.',
        ],
      },
      {
        heading: 'Résultats des tests',
        paragraphs: [
          'Aucun audit de conformité au RGAA n’a été mené à ce jour. Les vérifications suivantes sont en revanche automatisées et rejouées à chaque modification du site : contrôle des règles WCAG 2.1 niveau AA sur chacune des pages publiques, dans le thème clair comme dans le thème sombre ; contraste des couleurs ; parcours complet au clavier, avec un focus visible à chaque étape ; affichage à 320 pixels de large et à 200 % de zoom ; respect du réglage système de réduction des animations.',
          'Ces vérifications automatiques ne couvrent qu’une partie des critères : elles ne remplacent ni un audit RGAA ni un essai avec un lecteur d’écran réel.',
        ],
      },
      {
        heading: 'Contenus non accessibles',
        paragraphs: [
          'Faute d’audit, la liste des non-conformités n’est pas établie. Les limites connues à ce jour sont les suivantes : le site n’a pas été parcouru avec les lecteurs d’écran les plus répandus (NVDA, JAWS, VoiceOver), ni testé par des personnes en situation de handicap.',
          'Aucune dérogation pour charge disproportionnée n’est revendiquée, et le site ne reprend aucun contenu de tiers qui échapperait à l’obligation d’accessibilité.',
        ],
      },
      {
        heading: 'Établissement de cette déclaration',
        paragraphs: [
          'Cette déclaration a été établie le [date de première publication — à compléter avant publication].',
          'Technologies utilisées : HTML, CSS et JavaScript. Les vérifications décrites plus haut sont exécutées par Playwright et axe-core dans le navigateur Chromium, sur l’ensemble des pages publiques du site. Les autres navigateurs ne sont pas encore couverts.',
        ],
      },
      {
        heading: 'Retour d’information et contact',
        paragraphs: [
          'Si vous n’arrivez pas à accéder à un contenu ou à une fonctionnalité du site, écrivez à [adresse électronique — à compléter avant publication] : le contenu vous sera transmis sous une autre forme, ou une solution de remplacement vous sera proposée. Votre signalement sert aussi à corriger le site.',
        ],
      },
      {
        heading: 'Voies de recours',
        paragraphs: [
          'Si vous signalez un défaut d’accessibilité qui vous empêche d’accéder à un contenu ou à une fonctionnalité du site et que vous n’obtenez pas de réponse, vous pouvez saisir le Défenseur des droits, l’autorité indépendante chargée de défendre les personnes dont les droits ne sont pas respectés.',
          'Trois moyens de le saisir : le formulaire en ligne ; un délégué du Défenseur des droits près de chez vous, dont les coordonnées figurent sur defenseurdesdroits.fr ; un courrier postal gratuit, sans timbre, adressé au Défenseur des droits, Libre réponse 71120, 75342 Paris CEDEX 07.',
        ],
        links: [
          {
            text: 'Saisir le Défenseur des droits par le formulaire en ligne',
            href: new URL('https://formulaire.defenseurdesdroits.fr'),
          },
        ],
      },
    ],
  },
  politiqueConfidentialite: {
    title: 'Politique de confidentialité',
    sections: [
      {
        heading: 'Responsable du traitement',
        paragraphs: [
          'Le responsable du traitement, c’est-à-dire la personne qui décide comment d’éventuelles données personnelles seraient utilisées sur ce site, est l’éditeur du site, [prénom et nom — à compléter avant publication], joignable à [adresse électronique — à compléter avant publication].',
        ],
      },
      {
        heading: 'Données collectées',
        paragraphs: [
          'À ce jour, Mon Sinistre ne collecte aucune donnée personnelle : le site ne propose ni compte ni formulaire, n’utilise ni cookie ni traceur, et ne contient aucun outil de mesure d’audience.',
          'Avant toute collecte de données, par exemple à l’ouverture de l’inscription à la veille des arrêtés, cette politique sera mise à jour pour décrire précisément les données concernées.',
        ],
      },
      {
        heading: 'Finalités et bases légales',
        paragraphs: [
          'Aucun traitement de données personnelles n’étant mis en œuvre, aucune finalité ni base légale n’est à décrire à ce jour. Cette section sera complétée avant toute collecte.',
        ],
      },
      {
        heading: 'Destinataires et sous-traitants',
        paragraphs: [
          'Aucune donnée personnelle n’est transmise à des tiers, faute de donnée collectée.',
        ],
      },
      {
        heading: 'Durée de conservation',
        paragraphs: [
          'Sans objet à ce jour : aucune donnée personnelle n’est conservée.',
        ],
      },
      {
        heading: 'Vos droits',
        paragraphs: [
          'Le règlement général sur la protection des données (RGPD), le texte européen qui encadre l’utilisation des données personnelles, vous donne un droit d’accès, de rectification, d’effacement, d’opposition et de portabilité sur les données qui vous concernent.',
          'Pour exercer ces droits, écrivez à [adresse électronique — à compléter avant publication]. Votre demande sera traitée dans les meilleurs délais.',
        ],
      },
      {
        heading: 'Réclamation auprès de la CNIL',
        paragraphs: [
          'Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la Commission nationale de l’informatique et des libertés (CNIL), l’autorité française chargée de veiller à la protection des données personnelles, sur son site cnil.fr.',
        ],
      },
    ],
  },
} as const;
