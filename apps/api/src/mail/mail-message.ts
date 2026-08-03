/**
 * The shape of an email as the rest of the API describes it, and as the
 * transports of the next phases receive it.
 *
 * A message is described once, as blocks, and rendered twice — text and HTML
 * (docs/research/emails.md). The requirement "the set of links in the text
 * version equals the set in the HTML one" then holds by construction: a link
 * exists as a single block, both renderers must emit it, and they have nowhere
 * to drift apart.
 */

export interface MailAddress {
  readonly name: string;
  readonly email: string;
}

/**
 * A link carries a path of the site, never a full address: the base comes from
 * FRONTEND_URL and is joined by the skeleton alone. A second place joining it
 * would be a second place to get it wrong.
 */
export type MailBlock =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly path: string }
  | { readonly kind: 'list'; readonly items: readonly string[] };

/** A block with its address already resolved — what the renderers consume. */
export type ResolvedMailBlock =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly url: string }
  | { readonly kind: 'list'; readonly items: readonly string[] };

export interface ComposeMailInput {
  readonly to: string;
  readonly subject: string;
  /** The body of the message; the footer is added by the skeleton. */
  readonly blocks: readonly MailBlock[];
  /**
   * Why this address is on the list, in the words of the feature that owns the
   * email ("vous suivez la commune de Nîmes"): only it knows. Rendered through
   * fr.mail.footer.why.
   */
  readonly reason: string;
  /**
   * Path of the page that stops the emails. Required — every message of the
   * product carries such a link (PRD, "Ограничения"), so the type does not let
   * a caller leave it out and MailComposer checks it again at runtime.
   * The path itself is declared as a constant in packages/contracts by the
   * feature that owns the email (docs/plan/emails.md).
   */
  readonly unsubscribePath: string;
}

export interface MailMessage {
  readonly from: MailAddress;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly headers: Readonly<Record<string, string>>;
}
