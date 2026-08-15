import { IsString, MaxLength } from 'class-validator';
import { VEILLE_TOKEN_LENGTH } from '../veille-token';

/**
 * Body of both token-carrying POSTs — confirmation and desinscription: the
 * confirm/unsubscribe tokens differ only in which hash column the service
 * looks them up against. (Confirmation's GET reads its token from a bare
 * `@Query('token')` instead — see the note in the controller.)
 */
export class VeilleTokenDto {
  /** Token carried by the veille link. */
  @IsString()
  // MaxLength, not an exact Length: a token truncated by a mail client must
  // answer the same "invalid" as an unknown one, not a 400 — the bound only
  // keeps megabyte-sized strings away from sha256.
  @MaxLength(VEILLE_TOKEN_LENGTH)
  token: string;
}
