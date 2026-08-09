import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { fr } from '@/i18n/fr';

// Alert already sets role="alert" — the screen-reader announcement required
// for the request-error state (apps/web/CLAUDE.md) comes from that role.
export function RequestError() {
  return (
    <Alert variant="destructive" data-testid="request-error">
      <AlertTitle>{fr.requestError.title}</AlertTitle>
      <AlertDescription>{fr.requestError.description}</AlertDescription>
    </Alert>
  );
}
