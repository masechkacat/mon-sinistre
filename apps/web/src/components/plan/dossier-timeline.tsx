import { fr } from '@/i18n/fr';
import type { TimelinePoint } from '@/lib/dossier-timeline';
import { cn } from '@/lib/utils';

/** The key dates of a dossier as a line of points — `timelinePoints`. */
export function DossierTimeline({ points }: { points: TimelinePoint[] }) {
  return (
    <ol
      aria-label={fr.sinistres.detail.timeline.label}
      className="grid gap-x-4 gap-y-3 sm:grid-cols-4"
    >
      {points.map((point) => (
        <li
          key={point.label}
          aria-current={point.current ? 'step' : undefined}
          className="flex flex-col gap-1.5"
        >
          {/* Decoration, hence aria-hidden: whether the moment is behind us is
              said by its own line — a date, or « attendu » and « à venir ». */}
          <span aria-hidden className="flex items-center gap-2">
            <span
              className={cn(
                'size-3.5 shrink-0 rounded-full border-2 border-primary',
                // Forced colours drop backgrounds, so the filled point is
                // filled with ink there instead.
                point.past && 'bg-primary forced-colors:bg-[CanvasText]',
              )}
            />
            <span className="h-0.5 grow bg-border" />
          </span>
          <span className={cn('leading-tight', point.current && 'font-bold')}>
            {point.label}
          </span>
          <span className="leading-tight text-muted-foreground tabular-nums">
            {point.value}
          </span>
        </li>
      ))}
    </ol>
  );
}
