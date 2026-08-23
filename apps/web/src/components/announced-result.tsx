'use client';

import type { ReactNode } from 'react';
import { MessageScreen } from '@/components/message-screen';
import { useFocusOnSuccess } from '@/lib/use-focus-on-success';

/**
 * The two ends of a form/action flow: `children` while the action has no
 * result yet, the result screen once `result` arrives. Both live here instead
 * of being swapped by the caller because the `role="status"` live region has
 * to outlive the transition — mounted empty with the first screen, filled on
 * the second (apps/web/CLAUDE.md: a region inserted into the DOM already
 * carrying its text is often not announced).
 * `announce` is decoupled from "is there a result" — a result reached by a
 * plain page load (not by the action that `announce` reports on) must render
 * silently.
 */
export function AnnouncedResult({
  result,
  resultAction,
  announce,
  testId,
  children,
}: {
  result: { title: string; description: string } | undefined;
  /** What the person does next from the result screen — a link onwards. Not
   * part of `result`: the announcement above reads the outcome, and a live
   * region that also read the link would announce a control the reader is
   * about to reach anyway. */
  resultAction?: ReactNode;
  announce: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const resultRef = useFocusOnSuccess(announce && result !== undefined);
  return (
    <>
      <div role="status" className="sr-only">
        {announce && result ? `${result.title} ${result.description}` : null}
      </div>
      {result ? (
        <div
          ref={resultRef}
          tabIndex={-1}
          data-testid={testId}
          className="outline-none"
        >
          <MessageScreen title={result.title} description={result.description}>
            {resultAction}
          </MessageScreen>
        </div>
      ) : (
        children
      )}
    </>
  );
}
