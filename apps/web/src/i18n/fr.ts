// The space before ":" and "?" is a literal U+00A0, not a typo — same
// convention as apps/api/src/i18n/fr.ts.

// Shared across veille.confirmation and veille.change below: same fact
// (link being checked, link no longer usable, alert reaches the watched
// communes), same wording — one string, not a fact stated twice.
const VEILLE_LIEN_VERIFICATION_EN_COURS = 'Vérification du lien en cours…';
const VEILLE_LIEN_INVALIDE = 'Lien invalide';
const VEILLE_ALERTE_ARRETE =
  'Vous recevrez un message le jour même de la publication d’un arrêté de catastrophe naturelle concernant une des communes surveillées.';

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
      emailLabel: 'Adresse e-mail',
      emailPlaceholder: 'vous@exemple.fr',
      emailRequiredError: 'Indiquez votre adresse e-mail.',
      emailInvalidError: 'Indiquez une adresse e-mail valide.',
      purpose:
        'Votre adresse e-mail sert uniquement à vous prévenir lorsqu’un arrêté de catastrophe naturelle concerne une commune surveillée.',
      privacyPolicyLink: 'Consulter notre politique de confidentialité',
      submit: 'S’inscrire à la veille',
      submitting: 'Inscription en cours…',
    },
    confirmationSent: {
      title: 'Vérifiez votre boîte e-mail',
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
      confirmButton: 'Confirmer',
      confirming: 'Confirmation en cours…',
      active: {
        title: 'Votre veille est active',
        description: VEILLE_ALERTE_ARRETE,
      },
      invalid: {
        title: VEILLE_LIEN_INVALIDE,
        description:
          'Ce lien de confirmation n’est plus valable : il a peut-être déjà été utilisé, ou son délai de validité est dépassé.',
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
        title: VEILLE_LIEN_INVALIDE,
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
  session: {
    checking: 'Vérification de la session…',
    loggedIn: 'Connecté·e',
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
