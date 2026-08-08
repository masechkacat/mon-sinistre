'use client';

import './globals.css';
import { ErrorScreen } from '@/components/error-screen';

// Replaces the root layout when the layout itself fails, so it must render
// its own <html> and <body>.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="fr">
      <body>
        <main>
          <ErrorScreen reset={reset} />
        </main>
      </body>
    </html>
  );
}
