// Walks a dictionary branch instead of listing keys so that a string added to
// it but forgotten on the page fails without editing the test.
export function stringLeaves(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (node && typeof node === 'object')
    return Object.values(node).flatMap(stringLeaves);
  return [];
}
