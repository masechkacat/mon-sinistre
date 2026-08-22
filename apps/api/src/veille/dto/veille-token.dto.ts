import { TokenDto } from 'src/common/token.dto';

/**
 * Body of every token-carrying POST — confirmation, changement and
 * desinscription: the confirm/change/unsubscribe tokens differ only in which
 * hash column the service looks them up against. (Each endpoint's GET, where
 * it has one, reads its token from a bare `@Query('token')` instead — see
 * the note in the controller.) See {@link TokenDto} for the validation rule.
 */
export class VeilleTokenDto extends TokenDto {}
