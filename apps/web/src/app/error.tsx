'use client';

import { ErrorScreen } from '@/components/error-screen';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <ErrorScreen reset={reset} />;
}
