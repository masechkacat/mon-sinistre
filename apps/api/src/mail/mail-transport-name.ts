/**
 * A fact of this module, not of the environment schema: src/config validates a
 * value src/mail defines. A file of its own rather than mail-transport.ts,
 * because the symbol MAIL_TRANSPORT there is the injection token and is the
 * thing most easily confused with the variable of the same name.
 */
export const MAIL_TRANSPORT_NAMES = ['file', 'scaleway'] as const;

export type MailTransportName = (typeof MAIL_TRANSPORT_NAMES)[number];

/** Anything else — an unset variable included — is the local transport. */
export const SENDING_TRANSPORT: MailTransportName = 'scaleway';
