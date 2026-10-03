// Shared by TextField and the commune comboboxes' input groups, so a frame
// or contrast fix reaches every field.
// The focus ring is not shared on purpose: it needs `focus:` on the input
// itself but `focus-within:` on the chips container, and Tailwind only picks
// up variants written out literally.
export const inputFrameClassName =
  'rounded-lg border border-input bg-background';

export const inputFrameInvalidClassName =
  'border-destructive ring-3 ring-destructive/20 dark:ring-destructive/40';
