import type { Metadata } from 'next';
import './globals.css';
import { Geist } from 'next/font/google';
import { fr } from '@/i18n/fr';
import { cn } from '@/lib/utils';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: fr.layout.metaTitle,
  description: fr.layout.metaDescription,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // lang is required for screen readers to pick the right pronunciation and
  // for automatic translation to behave. The interface language is French.
  return (
    <html lang="fr" className={cn('font-sans', geist.variable)}>
      <body>
        <a href="#contenu" className="skip-link">
          {fr.layout.skipToContent}
        </a>
        <main id="contenu">{children}</main>
      </body>
    </html>
  );
}
