/**
 * Every address a rendered message names, as a set. Shared by the tests of the
 * composer and of the local transport, because both ask the same question of
 * different artefacts — "do these two versions of one message send the reader
 * to the same places?" — and two spellings of that question would answer it
 * two ways.
 *
 * Works on the text version, on the HTML one and on the file the local
 * transport writes: quotes and angle brackets end an address, so an href and a
 * List-Unsubscribe header yield the address they carry and nothing of the
 * markup around it. A set, not a list: the same address appears more than once
 * on purpose — the unsubscribe link travels both as a header and in the footer.
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
