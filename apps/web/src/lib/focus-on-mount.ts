/**
 * Callback ref for an element that appears with the outcome it reports — a
 * result screen, a confirmation panel: focused once, when it mounts. A module
 * constant, not an arrow written in JSX: React calls a ref again whenever its
 * identity changes, so an inline one would run on every render and take the
 * focus back from whatever the person had reached inside.
 */
export const focusOnMount = (node: HTMLElement | null) => node?.focus();
