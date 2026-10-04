'use client';

import { TokenConfirmScreen } from '@/components/token-confirm-screen';
import { unsubscribeVeille } from '@/lib/api/veille';
import { fr } from '@/i18n/fr';

const strings = fr.veille.desinscription.confirmer;

export function VeilleDesinscriptionConfirmer() {
  return (
    <TokenConfirmScreen
      mutationFn={unsubscribeVeille}
      title={strings.page.title}
      description={strings.description}
      confirmLabel={strings.unsubscribeButton}
      pendingLabel={strings.unsubscribing}
      done={strings.done}
      testId="veille-desinscription-result"
    />
  );
}
