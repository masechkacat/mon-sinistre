import type { Metadata } from 'next';
import { MessageScreen } from '@/components/message-screen';
import { fr } from '@/i18n/fr';

export const metadata: Metadata = {
  title: fr.compte.compteSupprime.page.title,
};

// Public — reached only after DELETE /auth/me, whose success already cleared
// the in-memory access token (espace-personnel.tsx); no session guard here,
// there is no account left to check one against.
export default function CompteSupprimePage() {
  return (
    <MessageScreen
      title={fr.compte.compteSupprime.page.title}
      description={fr.compte.compteSupprime.description}
    />
  );
}
