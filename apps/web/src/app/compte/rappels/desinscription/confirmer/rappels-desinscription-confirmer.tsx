'use client';

import { TokenConfirmScreen } from '@/components/token-confirm-screen';
import { unsubscribeReminders } from '@/lib/api/reminders';
import { fr } from '@/i18n/fr';

const strings = fr.compte.rappels.desinscription;

export function RappelsDesinscriptionConfirmer() {
  return (
    <TokenConfirmScreen
      mutationFn={unsubscribeReminders}
      title={strings.page.title}
      description={strings.description}
      confirmLabel={strings.unsubscribeButton}
      pendingLabel={strings.unsubscribing}
      done={strings.done}
      testId="rappels-desinscription-result"
    />
  );
}
