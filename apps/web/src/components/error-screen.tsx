'use client';

import { MessageScreen } from '@/components/message-screen';
import { Button } from '@/components/ui/button';
import { fr } from '@/i18n/fr';

// The shared screen of error.tsx and global-error.tsx — the French text is
// not duplicated between them.
export function ErrorScreen({
  digest,
  reset,
}: {
  digest?: string;
  reset: () => void;
}) {
  return (
    <MessageScreen
      title={fr.serverError.title}
      description={fr.serverError.description}
    >
      {digest ? (
        <p className="text-sm text-muted-foreground">
          {fr.serverError.digestLabel} {digest}
        </p>
      ) : null}
      <Button onClick={reset}>{fr.serverError.retry}</Button>
    </MessageScreen>
  );
}
