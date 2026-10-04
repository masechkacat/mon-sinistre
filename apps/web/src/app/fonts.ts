import localFont from 'next/font/local';

// Shared between layout.tsx and global-error.tsx — the latter replaces the
// layout entirely and must re-apply the fonts itself.
export const luciole = localFont({
  src: [
    { path: './fonts/Luciole-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Luciole-Italic.woff2', weight: '400', style: 'italic' },
    { path: './fonts/Luciole-Bold.woff2', weight: '700', style: 'normal' },
    {
      path: './fonts/Luciole-BoldItalic.woff2',
      weight: '700',
      style: 'italic',
    },
  ],
  variable: '--font-sans',
  display: 'swap',
});

export const newsreader = localFont({
  src: './fonts/Newsreader-variable.woff2',
  weight: '200 800',
  variable: '--font-heading',
  display: 'swap',
  // Default fallback is Arial: a serif heading would be drawn sans-serif
  // until the file lands, then jump.
  adjustFontFallback: 'Times New Roman',
});
