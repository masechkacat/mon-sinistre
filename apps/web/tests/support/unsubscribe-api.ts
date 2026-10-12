import type { APIRequestContext } from '@playwright/test';

/** The request a mail client sends — why: src/lib/one-click-unsubscribe.ts. */
export function oneClickPost(request: APIRequestContext, url: string) {
  return request.post(url, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: 'List-Unsubscribe=One-Click',
    maxRedirects: 0,
  });
}
