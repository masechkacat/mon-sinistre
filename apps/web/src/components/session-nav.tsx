'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { fr } from '@/i18n/fr';
import { ESPACE_PERSONNEL_PATH, LOGIN_PATH } from '@/lib/api/session';
import { useSession } from '@/lib/api/use-session';
import type { DossierPage } from '@/lib/dossier-params';

const copy = fr.layout;

// Pages whose own login link carries the dossier parameters or the return
// path (`dossierPath`, `suivant`): a second «Se connecter» in the header, same
// name, would lead past them.
const PAGES_AVEC_ENTREE: readonly DossierPage[] = [
  '/connexion',
  '/inscription',
];

/**
 * The login is offered while the session is still being checked, not just
 * when it is known to be absent: a link that appears a moment later would
 * move the tab order under the hands of someone already walking it.
 */
export function SessionNav() {
  const connecte = useSession() === 'authenticated';
  const pathname = usePathname();

  if (!connecte && PAGES_AVEC_ENTREE.includes(pathname as DossierPage))
    return null;

  return (
    <nav aria-label={copy.mainNav}>
      <Link
        href={connecte ? ESPACE_PERSONNEL_PATH : LOGIN_PATH}
        className="underline underline-offset-4"
      >
        {connecte ? copy.espace : copy.login}
      </Link>
    </nav>
  );
}
