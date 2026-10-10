import { requireTestRoute } from '@/lib/test-routes';
import { TestBejdz } from './test-bejdz';

export const dynamic = 'force-dynamic';

export default function TestBejdzPage() {
  requireTestRoute();
  return <TestBejdz />;
}
