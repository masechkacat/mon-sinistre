import { REMINDER_UNSUBSCRIBE_PATH } from '@mon-sinistre/contracts';
import { unsubscribeReminders } from '@/lib/api/reminders';
import { oneClickUnsubscribeHandlers } from '@/lib/one-click-unsubscribe';

export const { POST, GET } = oneClickUnsubscribeHandlers({
  unsubscribe: unsubscribeReminders,
  confirmPath: `${REMINDER_UNSUBSCRIBE_PATH}/confirmer`,
});
