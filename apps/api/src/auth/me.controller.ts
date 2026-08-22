import { Controller, Get, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUserResponse } from '@mon-sinistre/contracts';
import { AuthService } from './auth.service';
import { CurrentUserResponseDto } from './dto/current-user-response.dto';
import type { JwtUser } from './jwt.strategy';

interface RequestWithJwtUser {
  readonly user: JwtUser;
}

/** Kept out of `AuthController`, whose class-level `@Public()` this endpoint
 * must not inherit — why: `src/auth/CLAUDE.md`. */
@ApiTags('auth')
@Controller('auth')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get the email of the currently authenticated user',
    description:
      'Requires a valid access token — the global JwtAuthGuard answers 401 ' +
      'otherwise. Used by the web client to populate espace personnel.',
  })
  @ApiOkResponse({ type: CurrentUserResponseDto })
  async me(@Req() req: RequestWithJwtUser): Promise<CurrentUserResponse> {
    return this.auth.currentUser(req.user.id);
  }
}
