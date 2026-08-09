import { apiBaseUrl } from './config';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
  ) {
    super(`API error ${status} on ${path}`);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  if (!response.ok) {
    throw new ApiError(response.status, path);
  }
  // A bodyless success (204/205 — deletions, unsubscribes) is still a success:
  // response.json() would reject on the empty body and surface as an error.
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}
