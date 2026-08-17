import { IsString, MaxLength } from 'class-validator';
import { VEILLE_TOKEN_LENGTH } from '../veille-token';

/**
 * Body of every token-carrying POST — confirmation, changement and
 * desinscription: the confirm/change/unsubscribe tokens differ only in which
 * hash column the service looks them up against. (Each endpoint's GET, where
 * it has one, reads its token from a bare `@Query('token')` instead — see
 * the note in the controller.)
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
