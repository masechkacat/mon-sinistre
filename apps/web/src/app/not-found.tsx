import type { Metadata } from 'next';
import Link from 'next/link';
import { MessageScreen } from '@/components/message-screen';
import { fr } from '@/i18n/fr';

export const metadata: Metadata = { title: fr.notFound.title };

export default function NotFound() {
  return (
    <MessageScreen
      title={fr.notFound.title}
      description={fr.notFound.description}
    >
      <p>
        <Link href="/" className="underline underline-offset-4">
          {fr.notFound.backHome}
        </Link>
      </p>
    </MessageScreen>
  );
}
