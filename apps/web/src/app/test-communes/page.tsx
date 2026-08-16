import { Suspense } from 'react';
import { requireTestRoute } from '@/lib/test-routes';
import { TestCommunes } from './test-communes';

export const dynamic = 'force-dynamic';

export default function TestCommunesPage() {
  requireTestRoute();
  return (
    <Suspense>
      <TestCommunes />
    </Suspense>
  );
}
