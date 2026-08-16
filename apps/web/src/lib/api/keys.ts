export const queryKeys = {
  health: () => ['health'] as const,
  communes: (q: string) => ['communes', q] as const,
};
