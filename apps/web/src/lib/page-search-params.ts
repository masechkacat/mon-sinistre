/**
 * Next's `searchParams` prop as the `URLSearchParams` the parsers read.
 * A page that reads it is rendered per request, with its form in the HTML:
 * `useSearchParams` under a fallback-less `<Suspense>` would prerender the
 * page without it.
 */
export async function pageSearchParams(
  searchParams: PageProps<'/'>['searchParams'],
): Promise<URLSearchParams> {
  const result = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) {
    // `URLSearchParams.get` answers a repeated name with its first value too.
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) result.set(name, first);
  }
  return result;
}
