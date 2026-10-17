import { cn } from '@/lib/utils';

/**
 * The sheet a dossier is read on: the paper tone of the design system, a
 * folded corner and a soft shadow (docs/design/sinistre.html, 16b). Paper
 * surface, so what lies on it keeps the light values of the palette in both
 * themes (docs/research/design-system.md).
 */
export function DossierFeuille({
  children,
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dossier-feuille"
      data-surface="papier"
      className={cn(
        // `text-foreground` on the sheet itself: colour is inherited, so
        // without it the ink of the ground would run on into the paper.
        'relative bg-card p-6 text-foreground sm:p-10',
        'shadow-[0_1px_0_var(--filet),0_14px_30px_-18px_color-mix(in_oklch,var(--encre),transparent_55%)]',
        // The fold is material, not information: a gradient on a pseudo-
        // element, with nothing in the DOM for a reader to meet.
        'after:absolute after:top-0 after:right-0 after:size-11 after:content-[""]',
        'after:[background:linear-gradient(225deg,var(--fond)_0_50%,color-mix(in_oklch,var(--papier),var(--encre)_8%)_50%_100%)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
