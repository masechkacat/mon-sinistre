import { Suspense } from 'react';
import { requireTestRoute } from '@/lib/test-routes';
import { TestReponseCommune } from './test-reponse-commune';

export const dynamic = 'force-dynamic';

export default function TestReponseCommunePage() {
  requireTestRoute();
  return (
    <Suspense>
      <TestReponseCommune />
    </Suspense>
  );
}
