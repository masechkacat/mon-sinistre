import {
  DurationUnit,
  SOON_THRESHOLD_DAYS,
  StepAnchor,
  StepKind,
  StepStatus,
  toIsoDate,
  type StepView,
} from '@mon-sinistre/contracts';

const SOURCE = {
  url: 'https://www.legifrance.gouv.fr/codes/id/LEGIARTI000006792617',
  verifiedAt: toIsoDate('2026-08-18'),
  possiblyOutdated: false,
};

/**
 * Five steps of the CATNAT plan — the four container kinds and one plain
 * action — with the names, orders and kinds of the seed
 * (apps/api/src/step-templates/step-template.seed.ts).
 */
export const planCases: StepView[] = [
  {
    name: 'Photographier et filmer les dégâts',
    description: '',
    kind: StepKind.PHOTOS,
    plannedDate: toIsoDate('2026-10-10'),
    status: StepStatus.EN_RETARD,
    anchor: StepAnchor.DATE_SINISTRE,
    source: null,
    daysLeft: -3,
    delay: null,
    order: 1,
  },
  {
    name: 'Prévenir votre assureur',
    description: '',
    kind: StepKind.ACTION,
    plannedDate: toIsoDate('2026-10-20'),
    status: StepStatus.A_FAIRE,
    anchor: StepAnchor.DATE_SINISTRE,
    source: SOURCE,
    daysLeft: 7,
    delay: { value: 5, unit: DurationUnit.DAYS },
    order: 4,
  },
  {
    name: 'Rassembler les factures et justificatifs',
    description: '',
    kind: StepKind.JUSTIFICATIFS,
    plannedDate: toIsoDate('2026-11-13'),
    status: StepStatus.A_VENIR,
    anchor: StepAnchor.DATE_SINISTRE,
    source: null,
    // Past the threshold, hence A_VENIR and not A_FAIRE.
    daysLeft: SOON_THRESHOLD_DAYS + 1,
    delay: null,
    order: 5,
  },
  {
    name: 'Déclarer le sinistre à votre assureur',
    description: '',
    kind: StepKind.DECLARATION,
    plannedDate: null,
    status: StepStatus.A_VENIR,
    anchor: StepAnchor.DATE_PUBLICATION_ARRETE,
    source: null,
    daysLeft: null,
    delay: { value: 30, unit: DurationUnit.DAYS },
    order: 7,
  },
  {
    name: "Transmettre l'état estimatif des dégâts",
    description: '',
    kind: StepKind.OBJETS,
    plannedDate: null,
    status: StepStatus.A_VENIR,
    anchor: StepAnchor.DATE_ETAT_ESTIMATIF,
    source: null,
    daysLeft: null,
    delay: null,
    order: 9,
  },
];
