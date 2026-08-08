'use client';

import { Button } from '@/components/ui/button';
import { fr } from '@/i18n/fr';

// The shared screen of error.tsx and global-error.tsx — the French text is
// not duplicated between them.
export function ErrorScreen({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {fr.serverError.title}
      </h1>
      <p className="text-lg text-muted-foreground">
        {fr.serverError.description}
      </p>
      <Button onClick={reset}>{fr.serverError.retry}</Button>
    </div>
  );
}
