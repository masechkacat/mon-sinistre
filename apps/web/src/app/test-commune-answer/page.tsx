import { Suspense } from 'react';
import { requireTestRoute } from '@/lib/test-routes';
import { TestCommuneAnswer } from './test-commune-answer';

export const dynamic = 'force-dynamic';

export default function TestCommuneAnswerPage() {
  requireTestRoute();
  return (
    <Suspense>
      <TestCommuneAnswer />
    </Suspense>
  );
}
