export const queryKeys = {
  health: () => ['health'] as const,
  currentUser: () => ['auth', 'me'] as const,
  communes: (q: string) => ['communes', q] as const,
  sinistres: () => ['sinistres'] as const,
  veilleConfirmation: (token: string) =>
    ['veille', 'confirmation', token] as const,
  veilleChange: (token: string) => ['veille', 'changement', token] as const,
};
