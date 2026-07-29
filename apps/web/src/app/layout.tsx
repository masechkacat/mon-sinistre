import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jalons',
  description:
    'Suivi des démarches de renouvellement des droits notifiés par la CDAPH',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // lang is required for screen readers to pick the right pronunciation and
  // for automatic translation to behave. The interface language is French.
  return (
    <html lang="fr">
      <body>
        <a href="#contenu" className="skip-link">
          Aller au contenu principal
        </a>
        <main id="contenu">{children}</main>
      </body>
    </html>
  );
}
