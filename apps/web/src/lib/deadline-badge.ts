import {
  DEADLINE_URGENT_THRESHOLD_DAYS,
  StepStatus,
  type Step,
} from '@mon-sinistre/contracts';

export enum DeadlineBadgeState {
  norme = 'norme',
  derniereSemaine = 'derniereSemaine',
  demain = 'demain',
  aujourdhui = 'aujourdhui',
  enRetard = 'enRetard',
  fait = 'fait',
  sansObjet = 'sansObjet',
  dateAVenir = 'dateAVenir',
}

export function deadlineBadgeState({
  status,
  daysLeft,
}: Pick<Step, 'daysLeft'> & Partial<Pick<Step, 'status'>>): DeadlineBadgeState {
  if (status === StepStatus.FAIT) return DeadlineBadgeState.fait;
  if (status === StepStatus.NON_APPLICABLE) return DeadlineBadgeState.sansObjet;
  if (daysLeft === null) return DeadlineBadgeState.dateAVenir;
  if (daysLeft < 0) return DeadlineBadgeState.enRetard;
  if (daysLeft === 0) return DeadlineBadgeState.aujourdhui;
  if (daysLeft === 1) return DeadlineBadgeState.demain;
  if (daysLeft <= DEADLINE_URGENT_THRESHOLD_DAYS)
    return DeadlineBadgeState.derniereSemaine;
  return DeadlineBadgeState.norme;
}
