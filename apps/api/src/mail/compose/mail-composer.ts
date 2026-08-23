import { fr } from 'src/i18n/fr';
import { MailCompositionError } from 'src/mail/mail-composition.error';
import type {
  ComposeMailInput,
  MailBlock,
  MailMessage,
  ResolvedMailBlock,
} from 'src/mail/mail-message';
import { renderHtml } from 'src/mail/compose/render-html';
import { renderText } from 'src/mail/compose/render-text';

export interface MailComposerOptions {
  /** FRONTEND_URL: the base every link of every email is built on. */
  readonly baseUrl: string;
  /** MAIL_FROM: what ends up in the "From:" header. */
  readonly senderEmail: string;
}

/**
 * The skeleton every email of the product goes through. It owns the only place
 * where a path becomes an absolute address: features hand over paths, the base
 * comes from FRONTEND_URL.
 */
export class MailComposer {
  constructor(private readonly options: MailComposerOptions) {}

  compose(input: ComposeMailInput): MailMessage {
    const baseUrl = this.required(this.options.baseUrl, 'FRONTEND_URL');
    const senderEmail = this.required(this.options.senderEmail, 'MAIL_FROM');

    // Validated at bootstrap too: the guarantee belongs to the place that
    // writes the header, not to the one that validated the value earlier.
    if (!isBareAddress(senderEmail)) {
      throw new MailCompositionError(
        'MAIL_FROM must be a single bare address, such as "no-reply@…"',
      );
    }

    // Carried as a header: a break would forge a header below it, and a second
    // address would let two subscribers see each other.
    if (!isBareAddress(input.to)) {
      throw new MailCompositionError(
        'the recipient must be a single bare address on a single line',
      );
    }

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
        // is what makes the mail client offer its own one-click button.
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };
  }

  /**
   * The message names the environment variable, not the option. A value of
   * nothing but blanks passes @IsNotEmpty in the schema and trims to empty
   * here, and every link would then read "undefined/…".
   */
  private required(value: string, variable: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new MailCompositionError(`${variable} is not configured`);
    }
    return trimmed;
  }
}

/**
 * Deliberately narrower than the address grammar of RFC 5322: a header this
 * skeleton writes carries one plain address, with no display name, no angle
 * brackets and no second address.
 */
const BARE_ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+$/;

const isBareAddress = (value: string): boolean => BARE_ADDRESS.test(value);

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

const resolveBlock = (block: MailBlock, baseUrl: string): ResolvedMailBlock => {
  switch (block.kind) {
    case 'link':
      return {
        kind: 'link',
        text: block.text,
        url: resolveUrl(block.path, baseUrl, 'link path'),
      };
    case 'externalLink':
      return {
        kind: 'externalLink',
        text: block.text,
        url: requireHttpsUrl(block.url, 'link url'),
      };
    case 'paragraph':
    case 'list':
      return block;
  }
};

/**
 * `externalLink` is the one block whose address does not resolve against
 * FRONTEND_URL, so it must gate itself: a scheme other than `https:`
 * (`javascript:`, `data:`, a bare host typed without `https://`) would still
 * render as a normal-looking link in the HTML version. Parsed with `new URL`,
 * like `resolveUrl` below, rather than a regex prefix check — a stray control
 * character or unencoded space in the value would otherwise reach the `href`
 * attribute verbatim.
 */
const requireHttpsUrl = (value: string, field: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new MailCompositionError(
      `${field} must be an absolute https:// address`,
      { cause },
    );
  }
  if (url.protocol !== 'https:') {
    throw new MailCompositionError(
      `${field} must be an absolute https:// address`,
    );
  }
  return url.toString();
};

const resolveUrl = (path: string, baseUrl: string, field: string): string => {
  // The message names the field and never its value — an unsubscribe path
  // carries a token.
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

  // Compared after parsing, not guessed from the string before it: for http(s)
  // the URL parser treats a backslash as a slash and strips tabs and newlines,
  // so "/\ailleurs.test" resolves to another host while looking like an
  // ordinary rooted path. This link goes into List-Unsubscribe, which mail
  // clients POST to on one click.
  if (url.origin !== base.origin) {
    throw new MailCompositionError(
      `${field} must stay on the site of FRONTEND_URL`,
    );
  }

  return url.toString();
};
