// The space before ":" and "?" is a literal U+00A0, not a typo — same
// convention as apps/api/src/i18n/fr.ts.
export const fr = {
  serviceName: 'Mon Sinistre',
  layout: {
    metaDescription:
      'Veille des arrêtés de catastrophe naturelle et suivi du sinistre',
    skipToContent: 'Aller au contenu principal',
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
  serverError: {
    title: 'Une erreur est survenue',
    description:
      'Le service a rencontré un problème inattendu. Ce n’est pas de votre faute. Vous pouvez réessayer, ou revenir un peu plus tard.',
    retry: 'Réessayer',
    digestLabel: 'Référence technique :',
  },
  notFound: {
    title: 'Page introuvable',
    description:
      'La page que vous cherchez n’existe pas ou n’est plus disponible. L’adresse contient peut-être une erreur.',
    backHome: 'Retourner à l’accueil',
  },
} as const;
