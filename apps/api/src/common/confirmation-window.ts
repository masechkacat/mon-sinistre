/**
 * The one comparison of a confirmation deadline with "now", shared by every
 * table that pairs `confirmedAt` with `confirmExpiresAt` (veille, user
 * account), in the two languages that ask for it: `isStillOpen` for a row
 * already read, `awaitingConfirmation` for the write that confirms one.
 * `expiredUnconfirmed` is its exact complement — the deletion criterion of
 * the hourly cleanup — and spells the comparison out instead of negating the
 * fragment above: `NOT (… >= now)` is not an indexable clause, and that
 * delete runs through a partial index.
 */
export const isStillOpen = (confirmExpiresAt: Date): boolean =>
  confirmExpiresAt >= new Date();

export const awaitingConfirmation = () => ({
  confirmedAt: null,
  confirmExpiresAt: { gte: new Date() },
});

export const expiredUnconfirmed = () => ({
  confirmedAt: null,
  confirmExpiresAt: { lt: new Date() },
});
