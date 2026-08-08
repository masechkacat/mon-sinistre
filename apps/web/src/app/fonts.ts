import { Geist } from 'next/font/google';

// Shared between layout.tsx and global-error.tsx — the latter replaces the
// layout entirely and must re-apply the font itself.
export const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });
