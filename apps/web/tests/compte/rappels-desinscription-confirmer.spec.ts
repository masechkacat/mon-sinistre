import { REMINDER_UNSUBSCRIBE_PATH } from '@mon-sinistre/contracts';
import { fr } from '../../src/i18n/fr';
import { tokenConfirmScreenSuite } from '../support/token-confirm-screen';

const TOKEN = 'jeton-rappels';

tokenConfirmScreenSuite({
  name: 'rappels',
  path: `${REMINDER_UNSUBSCRIBE_PATH}/confirmer?token=${TOKEN}`,
  token: TOKEN,
  endpoint: '/rappels/desinscription',
  strings: fr.compte.rappels.desinscription,
  testId: 'rappels-desinscription-result',
});
