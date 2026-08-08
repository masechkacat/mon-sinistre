import type { Metadata } from 'next';
import Link from 'next/link';
import { fr } from '@/i18n/fr';

export const metadata: Metadata = { title: fr.notFound.title };

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {fr.notFound.title}
      </h1>
      <p className="text-lg text-muted-foreground">{fr.notFound.description}</p>
      <p>
        <Link href="/" className="underline underline-offset-4">
          {fr.notFound.backHome}
        </Link>
      </p>
    </div>
  );
}
