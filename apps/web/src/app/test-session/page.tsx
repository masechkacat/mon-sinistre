import { requireTestRoute } from '@/lib/test-routes';
import { TestSession } from './test-session';

export const dynamic = 'force-dynamic';

export default function TestSessionPage() {
  requireTestRoute();
  return <TestSession />;
}
