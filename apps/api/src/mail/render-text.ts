import type { ResolvedMailBlock } from 'src/mail/mail-message';

/**
 * The plain-text version: visible text and full addresses, nothing else. No
 * markup and no HTML entities — it is read as is, by a client that shows no
 * HTML and by a reader who turned it off (docs/research/emails.md).
 */

/** U+00A0: French typography keeps the colon attached to the word before it. */
const NBSP = ' ';

/** Separates the footer, as in a mail signature. */
const FOOTER_RULE = '--';

const renderBlock = (block: ResolvedMailBlock): string => {
  switch (block.kind) {
    case 'paragraph':
      return block.text;
    // The label stays next to its address: a bare URL tells the reader nothing
    // about where it leads, and the label alone is not clickable here.
    case 'link':
      return `${block.text}${NBSP}: ${block.url}`;
    case 'list':
      return block.items.map((item) => `- ${item}`).join('\n');
  }
};

export const renderText = (
  body: readonly ResolvedMailBlock[],
  footer: readonly ResolvedMailBlock[],
): string =>
  [...body.map(renderBlock), FOOTER_RULE, ...footer.map(renderBlock)].join(
    '\n\n',
  ) + '\n';
