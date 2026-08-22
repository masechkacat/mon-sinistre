import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CurrentUserResponse } from '@mon-sinistre/contracts';
import type { FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { clearRefreshCookie } from './auth.controller';
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

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete the currently authenticated account (RGPD)',
    description:
      'Immediate and physical — the row and everything cascading from it ' +
      '(RefreshToken) are gone, not soft-deleted. Confirming the action is ' +
      'a web-side concern (docs/plan/user-account.md, phase 5); this ' +
      'endpoint only requires a valid access token, the same as GET ' +
      '/auth/me. The refresh cookie is cleared on the response either way.',
  })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse()
  async deleteAccount(
    @Req() req: RequestWithJwtUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.deleteAccount(req.user.id);
    clearRefreshCookie(reply);
  }
}
