'use client';

import { fr } from '@/i18n/fr';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { Button } from '@/components/ui/button';
import { endSession } from '@/lib/api/session';
import { useSessionGuard } from '@/lib/api/use-session-guard';

/**
 * Minimal protected landing page after login (issue #136: connexion +
 * logout). Content beyond the guard — the account's email, account
 * deletion — is issue #138; this component is the base the two build on top
 * of, not a stand-in replaced later.
 */
export function EspacePersonnel() {
  const status = useSessionGuard();

  if (status === 'checking') {
    return <p data-testid="session-status">{fr.session.checking}</p>;
  }

  return (
    <PageContainer className="space-y-6">
      <div data-testid="espace-personnel-content" className="space-y-6">
        <PageTitle>{fr.compte.espacePersonnel.page.title}</PageTitle>
        <p className="text-lg text-muted-foreground">
          {fr.compte.espacePersonnel.intro}
        </p>
        <Button type="button" onClick={() => endSession()}>
          {fr.session.logout}
        </Button>
      </div>
    </PageContainer>
  );
}
