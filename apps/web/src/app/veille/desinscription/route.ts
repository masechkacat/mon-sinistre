import { VEILLE_UNSUBSCRIBE_PATH } from '@mon-sinistre/contracts';
import { unsubscribeVeille } from '@/lib/api/veille';
import { oneClickUnsubscribeHandlers } from '@/lib/one-click-unsubscribe';

export const { POST, GET } = oneClickUnsubscribeHandlers({
  unsubscribe: unsubscribeVeille,
  confirmPath: `${VEILLE_UNSUBSCRIBE_PATH}/confirmer`,
});
