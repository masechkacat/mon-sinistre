'use client';

import { useSession } from '@/lib/api/use-session';

function SessionStatus({ testId }: { testId: string }) {
  const status = useSession();

  return <p data-testid={testId}>{status}</p>;
}

export function TestSession() {
  return (
    <div>
      <SessionStatus testId="session-status-a" />
      <SessionStatus testId="session-status-b" />
    </div>
  );
}
