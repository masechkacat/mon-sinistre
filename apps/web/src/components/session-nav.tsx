'use client';

import Link from 'next/link';
import { fr } from '@/i18n/fr';
import { ESPACE_PERSONNEL_PATH, LOGIN_PATH } from '@/lib/api/session';
import { useSession } from '@/lib/api/use-session';

const copy = fr.layout;

/**
 * The login is offered while the session is still being checked, not just
 * when it is known to be absent: a link that appears a moment later would
 * move the tab order under the hands of someone already walking it.
 */
export function SessionNav() {
  const connecte = useSession() === 'authenticated';

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
