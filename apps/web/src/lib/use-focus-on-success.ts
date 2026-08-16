import { useEffect, useRef } from 'react';

/**
 * The control that triggered a mutation (a submit or confirm button) unmounts
 * with its own screen, so the result screen needs an explicit focus target
 * for keyboard and screen-reader users — a status reached by a plain page
 * load needs none, hence the `isSuccess` gate rather than an unconditional
 * focus on mount.
 */
export function useFocusOnSuccess(isSuccess: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isSuccess) ref.current?.focus();
  }, [isSuccess]);
  return ref;
}
