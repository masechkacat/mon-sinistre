import {
  PASSWORD_MIN_CHAR_CLASSES,
  PASSWORD_MIN_LENGTH,
} from '@mon-sinistre/contracts';

// The space before ":" and "?" is a literal U+00A0, not a typo — same
// convention as apps/api/src/i18n/fr.ts.

// Shared across veille.confirmation and veille.change below: same fact
// (link being checked, link no longer usable, alert reaches the watched
// communes), same wording — one string, not a fact stated twice.
const VEILLE_LIEN_VERIFICATION_EN_COURS = 'Vérification du lien en cours…';
const VEILLE_ALERTE_ARRETE =
  'Vous recevrez un message le jour même de la publication d’un arrêté de catastrophe naturelle concernant une des communes surveillées.';

// Shared by every confirm-by-link screen (veille.confirmation,
// veille.change, compte.confirmation below) — one wording per fact, not one
// copy per feature.
const LIEN_INVALIDE = 'Lien invalide';
const LIEN_CONFIRMATION_INVALIDE_DESCRIPTION =
  'Ce lien de confirmation n’est plus valable : il a peut-être déjà été utilisé, ou son délai de validité est dépassé.';
const CONFIRMER = 'Confirmer';
const CONFIRMATION_EN_COURS = 'Confirmation en cours…';
const VERIFIEZ_BOITE_EMAIL = 'Vérifiez votre boîte e-mail';

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
  ' caractères et combiner au moins ' +
  String(PASSWORD_MIN_CHAR_CLASSES) +
  ' des catégories suivantes : majuscule, minuscule, chiffre, caractère spécial.';

export const fr = {
  serviceName: 'Mon Sinistre',
  layout: {
    metaDescription:
      'Veille des arrêtés de catastrophe naturelle et suivi du sinistre',
    skipToContent: 'Aller au contenu principal',
    legalNav: 'Informations légales',
  },
  home: {
    title: 'Après une catastrophe naturelle, chaque jour compte',
    lead: 'Mon Sinistre vous prévient dès que l’État reconnaît la catastrophe dans votre commune, puis vous aide à faire vos démarches auprès de votre assurance sans manquer aucun délai.',
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
        'Ne donne pas de conseils juridiques : les dates calculées sont indicatives, à vérifier avec votre contrat et votre assurance.',
        'N’écrit jamais à votre assurance à votre place : vous gardez la main sur toutes vos démarches.',
      ],
    },
    next: {
      heading: 'Et ensuite ?',
      steps: [
        'Vous choisissez les communes à surveiller.',
        'Dès qu’un arrêté qui les concerne paraît au Journal officiel, vous recevez un message.',
        'Si vous subissez des dégâts, Mon Sinistre vous guide pas à pas : déclaration dans les délais, suivi des échéances, inventaire des dégâts.',
      ],
    },
  },
  veille: {
    page: {
      title: 'Être prévenu·e en cas de catastrophe naturelle',
      lead: 'Indiquez votre adresse e-mail et les communes à surveiller. Vous recevrez un message le jour même de la publication d’un arrêté de catastrophe naturelle qui les concerne.',
    },
    form: {
      communesLabel: 'Communes à surveiller',
      communesPlaceholder: 'Nom de la commune ou code INSEE',
      removeCommune: (name: string) => `Retirer ${name}`,
      noCommuneFound: 'Aucune commune trouvée',
      communesFound: (count: number) =>
        count === 1 ? '1 commune trouvée' : `${count} communes trouvées`,
      maxCommunesReached: (max: number) =>
        `Nombre maximal de ${max} communes atteint`,
      communesRequiredError: 'Choisissez au moins une commune à surveiller.',
      emailLabel: EMAIL_LABEL,
      emailPlaceholder: EMAIL_PLACEHOLDER,
      emailRequiredError: EMAIL_REQUIRED_ERROR,
      emailInvalidError: EMAIL_INVALID_ERROR,
      purpose:
        'Votre adresse e-mail sert uniquement à vous prévenir lorsqu’un arrêté de catastrophe naturelle concerne une commune surveillée.',
      privacyPolicyLink: PRIVACY_POLICY_LINK,
      submit: 'S’inscrire à la veille',
      submitting: 'Inscription en cours…',
    },
    confirmationSent: {
      title: VERIFIEZ_BOITE_EMAIL,
      description:
        'Un e-mail de confirmation vient de vous être envoyé. Ouvrez-le et cliquez sur le lien qu’il contient pour activer votre veille.',
    },
    confirmation: {
      page: { title: 'Confirmer votre inscription' },
      loading: VEILLE_LIEN_VERIFICATION_EN_COURS,
      pending: {
        description:
          'Pour activer votre veille, confirmez que cette adresse e-mail est bien la vôtre.',
      },
      confirmButton: CONFIRMER,
      confirming: CONFIRMATION_EN_COURS,
      active: {
        title: 'Votre veille est active',
        description: VEILLE_ALERTE_ARRETE,
      },
      invalid: {
        title: LIEN_INVALIDE,
        description: LIEN_CONFIRMATION_INVALIDE_DESCRIPTION,
      },
    },
    change: {
      page: { title: 'Confirmer la modification de votre veille' },
      loading: VEILLE_LIEN_VERIFICATION_EN_COURS,
      pending: {
        description:
          'Voici la nouvelle liste des communes surveillées. Pour l’appliquer, confirmez la modification.',
      },
      confirmButton: 'Confirmer la modification',
      confirming: 'Modification en cours…',
      applied: {
        title: 'Modification appliquée',
        description: `La liste des communes surveillées a été mise à jour. ${VEILLE_ALERTE_ARRETE}`,
      },
      invalid: {
        title: LIEN_INVALIDE,
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
      page: { title: 'Créer un compte' },
      lead: 'Créez votre compte pour accéder à votre espace personnel et suivre votre sinistre.',
      emailLabel: EMAIL_LABEL,
      emailPlaceholder: EMAIL_PLACEHOLDER,
      emailRequiredError: EMAIL_REQUIRED_ERROR,
      emailInvalidError: EMAIL_INVALID_ERROR,
      passwordLabel: 'Mot de passe',
      passwordRequiredError: 'Choisissez un mot de passe.',
      passwordRequirementsError: PASSWORD_REQUIREMENTS,
      purpose:
        'Votre adresse e-mail et votre mot de passe servent uniquement à créer votre compte et à vous permettre de vous reconnecter.',
      privacyPolicyLink: PRIVACY_POLICY_LINK,
      submit: 'Créer mon compte',
      submitting: 'Création en cours…',
      confirmationSent: {
        title: VERIFIEZ_BOITE_EMAIL,
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
      confirmButton: CONFIRMER,
      confirming: CONFIRMATION_EN_COURS,
      confirmed: {
        title: 'Compte activé',
        description:
          'Votre compte est activé. Vous pouvez maintenant vous connecter.',
      },
      invalid: {
        title: LIEN_INVALIDE,
        description: LIEN_CONFIRMATION_INVALIDE_DESCRIPTION,
      },
    },
    connexion: {
      page: { title: 'Se connecter' },
      lead: 'Connectez-vous pour accéder à votre espace personnel.',
      emailLabel: EMAIL_LABEL,
      emailPlaceholder: EMAIL_PLACEHOLDER,
      emailRequiredError: EMAIL_REQUIRED_ERROR,
      emailInvalidError: EMAIL_INVALID_ERROR,
      passwordLabel: 'Mot de passe',
      passwordRequiredError: 'Indiquez votre mot de passe.',
      submit: 'Se connecter',
      submitting: 'Connexion en cours…',
      invalidError: 'Adresse e-mail ou mot de passe incorrect.',
    },
    espacePersonnel: {
      page: { title: 'Espace personnel' },
      intro: 'Vous êtes connecté·e à votre espace personnel.',
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
