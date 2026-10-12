import { expect, type Page } from '@playwright/test';
import { testApiBaseUrl } from './env';

/** The subscription `POST /veille`. Returns the bodies it carried, so a spec
 * can also assert that no request left the browser at all. */
export async function mockSubscribe(page: Page, status = 204) {
  const bodies: unknown[] = [];
  await page.route(`${testApiBaseUrl}/veille`, (route) => {
    expect(route.request().method()).toBe('POST');
    bodies.push(JSON.parse(route.request().postData() ?? 'null'));
    return route.fulfill({ status });
  });
  return bodies;
}
