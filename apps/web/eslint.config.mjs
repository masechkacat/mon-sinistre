import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import i18next from 'eslint-plugin-i18next';
import reactYouMightNotNeedAnEffect from 'eslint-plugin-react-you-might-not-need-an-effect';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  reactYouMightNotNeedAnEffect.configs.strict,
  {
    files: ['src/**/*.tsx'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': {
            include: [
              'alt',
              'aria-label',
              'aria-description',
              'title',
              'placeholder',
            ],
          },
        },
      ],
    },
  },
  { files: ['src/i18n/**'], rules: { 'i18next/no-literal-string': 'off' } },
  {
    // apps/web/CLAUDE.md, «Идентификаторы — английские»: the words the code
    // was once named with. Domain terms and route-derived names are not here.
    rules: {
      'id-denylist': [
        'error',
        ...'titre texte etape etapes echec annuler ouvrir creer corriger preciser preparer revenir enregistrer enregistrement effacer requis refus sujet inchange conteneur contenu formulaire suppression doublon annonce marquer chargement courant passe valeur prochain seul autres aucun trouves demain aujourdhui retard delai verifiee periode apercu feuille tampon entete existant chronologie statut faites signet barre bouton champ adresse resultat alerte nombre mois debut reponse lien liste avancement enCours marge connecte retour choix erreur utilisateur envoi invalide ancien supprimer libelle saisie recherche choisi choisie'.split(
          ' ',
        ),
      ],
    },
  },
  {
    // The three rules of apps/web/CLAUDE.md the linter can hold: requests go
    // through src/lib/api (one place for loading, errors and the French
    // message), dates through src/i18n/date.ts, logging only where a route
    // handler answers for itself.
    files: ['src/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Requests go through src/lib/api (TanStack Query).',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]',
          message: 'Dates are formatted by src/i18n/date.ts.',
        },
      ],
      'no-console': 'error',
    },
  },
  {
    files: ['src/lib/api/**', 'src/i18n/date.ts'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-syntax': 'off' },
  },
  {
    files: ['src/**/route.ts', 'src/lib/one-click-unsubscribe.ts'],
    rules: { 'no-console': 'off' },
  },
  globalIgnores(['.next/**', 'out/**', 'next-env.d.ts']),
]);
