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
 * The two values the skeleton needs, and nothing else — the same shape the
 * transports of this module are given (ScalewayMailConfig, the outbox directory
 * of FileMailTransport). Reading the environment is the job of the one
 * useFactory of MailModule; nothing here knows a variable name except to say
 * which one an operator has to go and fix.
 */
export interface MailComposerOptions {
  /** FRONTEND_URL: the base every link of every email is built on. */
  readonly baseUrl: string;
  /** MAIL_FROM: what ends up in the "From:" header. */
  readonly senderEmail: string;
}

/**
 * The skeleton every email of the product goes through: subject, sender, both
 * bodies, the French footer and the link that stops the messages.
 *
 * It owns the only place where a path becomes an absolute address: features
 * hand over paths, the base comes from FRONTEND_URL, and no feature joins the
 * two on its own (docs/plan/emails.md).
 */
export class MailComposer {
  constructor(private readonly options: MailComposerOptions) {}

  compose(input: ComposeMailInput): MailMessage {
    const baseUrl = this.required(this.options.baseUrl, 'FRONTEND_URL');
    const senderEmail = this.required(this.options.senderEmail, 'MAIL_FROM');

    // Validated at bootstrap as well (env.validation.ts), and checked again
    // here because this is what ends up in a "From:" header: the guarantee
    // belongs to the place that writes the header, not to the one that
    // happens to have validated the value earlier.
    if (!isBareAddress(senderEmail)) {
      throw new MailCompositionError(
        'MAIL_FROM must be a single bare address, such as "no-reply@…"',
      );
    }

    // One recipient, a bare address on one line. It is carried as a header —
    // the local transport of this phase writes it as "To:" into a file — so a
    // break would forge a header below it, a second address would let two
    // subscribers see each other (RGPD: one message per address), and anything
    // that is not an address at all would only fail at the provider.
    if (!isBareAddress(input.to)) {
      throw new MailCompositionError(
        'the recipient must be a single bare address on a single line',
      );
    }

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

  /**
   * The message names the environment variable, not the option: what the reader
   * of the failure has to go and edit is a line of .env.
   *
   * The schema requires both, so nothing reaches here empty through a running
   * application — but a value of nothing but blanks passes @IsNotEmpty there
   * and trims to empty here. Without a base every link would read
   * "undefined/…", and a test asserting that the link is there would not
   * notice.
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
 * An address and nothing around it: no display name, no angle brackets, no
 * second address, no blank of any kind. Deliberately narrower than the address
 * grammar of RFC 5322 — a header this skeleton writes carries one plain
 * address, and every form the grammar also allows is a form a caller has no
 * reason to hand over. Whether the domain exists is not a question a composer
 * can answer; whether the value is shaped like an address is.
 */
const BARE_ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+$/;

const isBareAddress = (value: string): boolean => BARE_ADDRESS.test(value);

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
