'use client';

import './globals.css';
import { ErrorScreen } from '@/components/error-screen';
import { fr } from '@/i18n/fr';
import { cn } from '@/lib/utils';
import { geist } from './fonts';

// Replaces the root layout when the layout itself fails, so it must render
// its own <html> and <body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr" className={cn('font-sans', geist.variable)}>
      <body>
        {/* Hoisted into <head> by React — a client component cannot export
            metadata. */}
        <title>{fr.serverError.title}</title>
        <main>
          <ErrorScreen digest={error.digest} reset={reset} />
        </main>
      </body>
    </html>
  );
}
