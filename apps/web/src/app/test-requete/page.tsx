import { requireTestRoute } from '@/lib/test-routes';
import { TestRequete } from './test-requete';

export const dynamic = 'force-dynamic';

export default function TestRequetePage() {
  requireTestRoute();
  return <TestRequete />;
}
