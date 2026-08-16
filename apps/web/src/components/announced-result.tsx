'use client';

import { MessageScreen } from '@/components/message-screen';
import { useFocusOnSuccess } from '@/lib/use-focus-on-success';

/**
 * The result screen of a form/action flow: a pre-mounted `role="status"`
 * live region (only its text changes) plus a focus target for the
 * `announce` transition. `announce` is decoupled from "is this the result
 * state" — a status reached by a plain page load (not by the action that
 * `announce` reports on) must render silently.
 */
export function AnnouncedResult({
  title,
  description,
  announce,
  testId,
}: {
  title: string;
  description: string;
  announce: boolean;
  testId?: string;
}) {
  const resultRef = useFocusOnSuccess(announce);
  return (
    <>
      <div role="status" className="sr-only">
        {announce ? `${title} ${description}` : null}
      </div>
      <div
        ref={resultRef}
        tabIndex={-1}
        data-testid={testId}
        className="outline-none"
      >
        <MessageScreen title={title} description={description} />
      </div>
    </>
  );
}
