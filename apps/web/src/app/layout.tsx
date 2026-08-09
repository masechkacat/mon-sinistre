import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { fr } from '@/i18n/fr';
import { legalPages } from '@/lib/legal-pages';
import { cn } from '@/lib/utils';
import { geist } from './fonts';
import { Providers } from './providers';

const chromeContainer = 'mx-auto w-full max-w-2xl px-6 py-4';

export const metadata: Metadata = {
  title: fr.serviceName,
  description: fr.layout.metaDescription,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // lang is required for screen readers to pick the right pronunciation and
  // for automatic translation to behave. The interface language is French.
  return (
    <html lang="fr" className={cn('font-sans', geist.variable)}>
      <body className="flex min-h-dvh flex-col">
        {/* Providers renders no element of its own, so the flex children of
            <body> are unchanged; it wraps the whole chrome and not just
            <main> so that a header or footer widget can query the API too. */}
        <Providers>
          <a href="#contenu" className="skip-link">
            {fr.layout.skipToContent}
          </a>
          <header className="border-b">
            <div className={chromeContainer}>
              <Link href="/" className="font-semibold">
                {fr.serviceName}
              </Link>
            </div>
          </header>
          <main id="contenu" className="flex-1">
            {children}
          </main>
          <footer className="border-t">
            <div
              className={cn(
                chromeContainer,
                'flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-muted-foreground',
              )}
            >
              <span>{fr.serviceName}</span>
              <nav aria-label={fr.layout.legalNav}>
                <ul className="flex flex-wrap gap-x-6 gap-y-2">
                  {legalPages.map(({ path, dict }) => (
                    <li key={path}>
                      <Link
                        href={path}
                        className="underline underline-offset-4"
                      >
                        {dict.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
