import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { fr } from 'src/i18n/fr';
import { MailCompositionError } from 'src/mail/mail-composition.error';
import type {
  ComposeMailInput,
  MailBlock,
  MailMessage,
  ResolvedMailBlock,
} from 'src/mail/mail-message';
import { renderHtml } from 'src/mail/render-html';
import { renderText } from 'src/mail/render-text';

/**
 * The skeleton every email of the product goes through: subject, sender, both
 * bodies, the French footer and the link that stops the messages.
 *
 * It owns the only place where a path becomes an absolute address: features
 * hand over paths, the base comes from FRONTEND_URL, and no feature joins the
 * two on its own (docs/plan/emails.md).
 */
@Injectable()
export class MailComposer {
  constructor(private readonly config: ConfigService) {}

  compose(input: ComposeMailInput): MailMessage {
    const baseUrl = this.required('FRONTEND_URL');
    const senderEmail = this.required('MAIL_FROM');

    // A subject is one line: it is carried as a header everywhere it goes, and
    // the local transport of this phase writes it as "Subject:" into a file —
    // a line break there would forge a header below it.
    if (input.subject.trim() === '' || /[\r\n]/.test(input.subject)) {
      throw new MailCompositionError('subject must be a single non-empty line');
    }

    const unsubscribeUrl = resolveUrl(
      input.unsubscribePath,
      baseUrl,
      'unsubscribePath',
    );

    const body = input.blocks.map((block) => resolveBlock(block, baseUrl));
    const footer = footerBlocks(input.reason, unsubscribeUrl);

    return {
      from: { name: fr.mail.senderName, email: senderEmail },
      to: input.to,
      subject: input.subject,
      text: renderText(body, footer),
      html: renderHtml(input.subject, body, footer),
      headers: {
        // Angle brackets are required by RFC 2369; the POST header (RFC 8058)
        // is what makes the mail client offer its own one-click button. Both
        // carry the very address the footer shows.
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };
  }

  private required(key: 'FRONTEND_URL' | 'MAIL_FROM'): string {
    const value = this.config.get<string>(key)?.trim();
    if (!value) {
      // Without a base every link would read "undefined/…", and a test
      // asserting that the link is there would not notice.
      throw new MailCompositionError(`${key} is not configured`);
    }
    return value;
  }
}

/**
 * Every message carries the same footer: why it arrived, what the service
 * does, that nobody reads the answers, and how to stop receiving messages —
 * required of all emails of the product (PRD, "Ограничения").
 */
const footerBlocks = (
  reason: string,
  unsubscribeUrl: string,
): readonly ResolvedMailBlock[] => [
  { kind: 'paragraph', text: fr.mail.footer.why(reason) },
  { kind: 'paragraph', text: fr.mail.footer.purpose },
  { kind: 'paragraph', text: fr.mail.footer.noReply },
  { kind: 'link', text: fr.mail.footer.unsubscribe, url: unsubscribeUrl },
  { kind: 'paragraph', text: fr.mail.footer.signature },
];

const resolveBlock = (block: MailBlock, baseUrl: string): ResolvedMailBlock =>
  block.kind === 'link'
    ? {
        kind: 'link',
        text: block.text,
        url: resolveUrl(block.path, baseUrl, 'link path'),
      }
    : block;

const resolveUrl = (path: string, baseUrl: string, field: string): string => {
  // A rooted path and nothing else: a full URL and a relative path are both
  // refused here, with a message that names the field and never its value —
  // an unsubscribe path carries a token.
  if (!path.startsWith('/')) {
    throw new MailCompositionError(
      `${field} must be a rooted path of the site, such as "/desabonnement/…"`,
    );
  }

  let url: URL;
  let base: URL;
  try {
    base = new URL(baseUrl);
    url = new URL(path, base);
  } catch (cause) {
    throw new MailCompositionError('FRONTEND_URL is not a valid base address', {
      cause,
    });
  }

  // The origin is compared after parsing, not guessed from the string before
  // it: for http(s) the URL parser treats a backslash as a slash and strips
  // tabs and newlines outright, so "/\ailleurs.test" and "/<TAB>/ailleurs.test"
  // both resolve to another host while looking like ordinary rooted paths. The
  // link goes into List-Unsubscribe, which mail clients POST to on one click.
  if (url.origin !== base.origin) {
    throw new MailCompositionError(
      `${field} must stay on the site of FRONTEND_URL`,
    );
  }

  return url.toString();
};
