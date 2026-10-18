import type { ArreteCoverage } from '@mon-sinistre/contracts';
import { formatDateFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';

/**
 * Where an arrêté comes from: the day the Journal officiel published it and
 * the text itself. Shown the same way wherever an arrêté is named — the
 * dossier screen and the commune answer.
 */
export function ArretePublication({
  arrete,
}: {
  arrete: Pick<ArreteCoverage, 'publishedAt' | 'legifranceUrl'>;
}) {
  return (
    <>
      <p>{fr.dossier.publishedOn(formatDateFr(arrete.publishedAt))}</p>
      <p>
        <a href={arrete.legifranceUrl} className="underline underline-offset-4">
          {fr.dossier.legifranceLink}
        </a>
      </p>
    </>
  );
}
