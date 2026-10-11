import { requireTestRoute } from '@/lib/test-routes';
import { TestPlan } from './test-plan';

export const dynamic = 'force-dynamic';

export default function TestPlanPage() {
  requireTestRoute();
  return <TestPlan />;
}
