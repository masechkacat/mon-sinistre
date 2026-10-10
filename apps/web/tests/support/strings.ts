// Walks a dictionary branch instead of listing keys so that a string added to
// it but forgotten on the page fails without editing the test.
export function stringLeaves(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (node && typeof node === 'object')
    return Object.entries(node).flatMap(([key, value]) =>
      // An href is an attribute, never text on screen: a caller asserting
      // visibility would look for the URL in the page body and never find it.
      key === 'href' ? [] : stringLeaves(value),
    );
  return [];
}
