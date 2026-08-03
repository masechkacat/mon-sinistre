/**
 * A message is described once, as blocks, and rendered twice — text and HTML.
 * "The set of links in the text version equals the set in the HTML one" then
 * holds by construction: both renderers must emit the same block.
 */

export interface MailAddress {
  readonly name: string;
  readonly email: string;
}

/** A link carries a path, never a full address: the base is joined by the
 * skeleton alone. */
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
  /** The body; the footer is added by the skeleton. */
  readonly blocks: readonly MailBlock[];
  /** Why this address is on the list, in the words of the feature that owns the
   * email ("vous suivez la commune de Nîmes"). */
  readonly reason: string;
  /** Path of the page that stops the emails. Required for every message of the
   * product; MailComposer checks it again at runtime. */
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
