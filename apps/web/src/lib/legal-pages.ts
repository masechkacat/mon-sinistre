import type { Route } from 'next';
import { fr } from '@/i18n/fr';

// The single registry of legal pages: the footer nav renders it and the test
// suites iterate it, so a page missing here is both unreachable and untested
// — there is no second list to forget.
export const legalPages = [
  { path: '/mentions-legales' satisfies Route, dict: fr.mentionsLegales },
  {
    path: '/politique-de-confidentialite' satisfies Route,
    dict: fr.politiqueConfidentialite,
  },
] as const;
