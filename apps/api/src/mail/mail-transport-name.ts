/**
 * The transports src/mail implements, and the one list of their names.
 *
 * A fact of this module rather than of the environment schema, which is why it
 * lives here: src/config validates a value src/mail defines, the same direction
 * it reads every other variable of a module in. The factory of MailModule picks
 * a transport by comparing MAIL_TRANSPORT with SENDING_TRANSPORT below, and the
 * schema turns the credentials of the provider on by that same constant — the
 * choice and its validation have nowhere to drift apart.
 *
 * A file of its own, not mail-transport.ts: the symbol MAIL_TRANSPORT there is
 * the injection token, and the environment variable of the same name is the
 * thing most easily confused with it (src/mail/CLAUDE.md).
 */
export const MAIL_TRANSPORT_NAMES = ['file', 'scaleway'] as const;

export type MailTransportName = (typeof MAIL_TRANSPORT_NAMES)[number];

/**
 * The transport that actually sends; the other one writes files locally.
 * Anything else — an unset variable included — is local, because that is what a
 * fresh clone must get: an API that needs no provider account.
 */
export const SENDING_TRANSPORT: MailTransportName = 'scaleway';
