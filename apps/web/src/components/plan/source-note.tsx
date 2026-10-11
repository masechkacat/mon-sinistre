import {
  REFERENCE_DATA_STALE_AFTER_MONTHS,
  type SourceReference,
} from '@mon-sinistre/contracts';
import { formatDateFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';

export function SourceNote({
  source,
  sujet,
}: {
  source: SourceReference;
  sujet: string;
}) {
  const copy = fr.sinistres.detail.source;
  return (
    <div className="space-y-1 text-sm">
      <p>
        <a href={source.url} className="underline underline-offset-4">
          {copy.lien(sujet)}
        </a>
      </p>
      <p className="text-muted-foreground">
        {copy.verifiee(formatDateFr(source.verifiedAt))}
      </p>
      {source.possiblyOutdated ? (
        <p className="font-semibold">
          {copy.outdated(REFERENCE_DATA_STALE_AFTER_MONTHS)}
        </p>
      ) : null}
      <p className="text-muted-foreground">{copy.indicative}</p>
    </div>
  );
}
