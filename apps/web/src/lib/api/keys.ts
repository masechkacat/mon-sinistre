export const queryKeys = {
  health: () => ['health'] as const,
  communes: (q: string) => ['communes', q] as const,
  veilleConfirmation: (token: string) =>
    ['veille', 'confirmation', token] as const,
};
