import { IsString, MaxLength } from 'class-validator';
import { SECURE_TOKEN_LENGTH } from './secure-token';

/**
 * Body of every `POST` that activates by a mailed link token (veille
 * confirmation/change/unsubscribe, account confirmation). `MaxLength`, not an
 * exact `Length`: a token truncated by a mail client must answer the same
 * "invalid" as an unknown one, not a 400 — the bound only keeps
 * megabyte-sized strings away from sha256. One implementation, extended by
 * each feature's own class so Swagger still names it per endpoint.
 */
export class TokenDto {
  @IsString()
  @MaxLength(SECURE_TOKEN_LENGTH)
  token: string;
}
