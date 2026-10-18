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
  globalIgnores(['.next/**', 'out/**', 'next-env.d.ts']),
]);
