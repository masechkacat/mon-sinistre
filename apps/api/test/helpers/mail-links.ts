/**
 * Every address a rendered message names, as a set — shared by the tests of the
 * composer and of the local transport, which ask the same question of different
 * artefacts. A set, not a list: the unsubscribe link travels both as a header
 * and in the footer.
 */
const URL_ANYWHERE = /https?:\/\/[^\s"<>]+/g;

export const mailLinksOf = (contents: string): Set<string> =>
  new Set(
    // &amp; in an attribute is the same address as & in the text version:
    // comparing the two raw would report a difference no reader sees.
    Array.from(contents.match(URL_ANYWHERE) ?? [], (url) =>
      url.replaceAll('&amp;', '&'),
    ),
  );

/**
 * The `token` query param of the one link in `message` containing `path` —
 * shared by every veille spec that needs the token a mail actually carried,
 * rather than the one a fixture wrote to the database.
 */
export const tokenFrom = (message: { text: string }, path: string): string => {
  const url = [...mailLinksOf(message.text)].find((link) =>
    link.includes(path),
  );
  if (!url) throw new Error(`no link containing "${path}" in the mail`);
  const token = new URL(url).searchParams.get('token');
  if (!token) throw new Error(`link "${url}" carries no token`);
  return token;
};
