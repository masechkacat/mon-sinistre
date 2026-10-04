'use client';

import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { AnnouncedResult } from '@/components/announced-result';
import { MessageScreen } from '@/components/message-screen';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';

// Each mailing mounts this from a thin client component of its own instead of
// straight from its `page.tsx`: `mutationFn` is a function, and a server page
// cannot hand one across the boundary.
export function TokenConfirmScreen({
  mutationFn,
  title,
  description,
  confirmLabel,
  pendingLabel,
  done,
  testId,
}: {
  mutationFn: (token: string) => Promise<void>;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  done: { title: string; description: string };
  testId: string;
}) {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const mutation = useMutation({ mutationFn: () => mutationFn(token) });

  return (
    <AnnouncedResult
      result={mutation.isSuccess ? done : undefined}
      announce={mutation.isSuccess}
      testId={testId}
    >
      <MessageScreen title={title} description={description}>
        <Button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? pendingLabel : confirmLabel}
        </Button>
        {mutation.isError ? <RequestError /> : null}
      </MessageScreen>
    </AnnouncedResult>
  );
}
