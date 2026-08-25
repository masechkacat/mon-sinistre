import { requireTestRoute } from '@/lib/test-routes';
import { TestSinistres } from './test-sinistres';

export const dynamic = 'force-dynamic';

export default function TestSinistresPage() {
  requireTestRoute();
  return <TestSinistres />;
}
