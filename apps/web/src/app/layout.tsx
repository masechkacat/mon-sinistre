import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mon Sinistre',
  description:
    'Veille des arrêtés de catastrophe naturelle et suivi du sinistre',
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
