import type { Metadata } from 'next';
import './globals.css';
import { Geist } from 'next/font/google';
import Link from 'next/link';
import { fr } from '@/i18n/fr';
import { cn } from '@/lib/utils';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

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
          <div className={cn(chromeContainer, 'text-sm text-muted-foreground')}>
            {fr.serviceName}
          </div>
        </footer>
      </body>
    </html>
  );
}
