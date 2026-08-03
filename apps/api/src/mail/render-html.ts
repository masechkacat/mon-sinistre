import type { ResolvedMailBlock } from 'src/mail/mail-message';

/**
 * The HTML version: one column inside a table, inline styles, no external
 * images, fonts or <style> blocks — mail clients strip those and Outlook on
 * the Word engine ignores max-width on a div (docs/research/emails.md).
 *
 * Accessibility is a hard constraint of the product and an email is an
 * interface too: lang="fr", body text at 16 px, link and text contrast above
 * 4.5:1 on white, links underlined and named by their action.
 */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/**
 * Everything that comes from outside — commune names, reasons, link labels —
 * goes through here. One pass over the class, so an escape is never escaped
 * twice.
 */
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);

const FONT = 'Arial, Helvetica, sans-serif';
const TEXT = `margin:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:1.5;color:#1f2933;`;
const FOOTER_TEXT = `margin:0 0 12px 0;font-family:${FONT};font-size:14px;line-height:1.5;color:#3f3f46;`;
const LINK = 'color:#12457d;text-decoration:underline;';
const INDENT = 'padding-left:20px;';

const renderBlock =
  (style: string) =>
  (block: ResolvedMailBlock): string => {
    switch (block.kind) {
      case 'paragraph':
        return `<p style="${style}">${escapeHtml(block.text)}</p>`;
      case 'link':
        return `<p style="${style}"><a href="${escapeHtml(block.url)}" style="${LINK}">${escapeHtml(block.text)}</a></p>`;
      case 'list':
        return `<ul style="${style}${INDENT}">${block.items
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join('')}</ul>`;
    }
  };

export const renderHtml = (
  subject: string,
  body: readonly ResolvedMailBlock[],
  footer: readonly ResolvedMailBlock[],
): string => `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;">
<tr>
<td align="center" style="padding:24px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr>
<td style="padding:24px;">
${body.map(renderBlock(TEXT)).join('\n')}
</td>
</tr>
<tr>
<td style="padding:24px;border-top:1px solid #d4d4d8;">
${footer.map(renderBlock(FOOTER_TEXT)).join('\n')}
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>
`;
