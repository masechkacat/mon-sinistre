import { requireTestRoute } from '@/lib/test-routes';
import { TestCommuneSelect } from './test-commune-select';

export const dynamic = 'force-dynamic';

export default function TestCommuneSelectPage() {
  requireTestRoute();
  return <TestCommuneSelect />;
}
