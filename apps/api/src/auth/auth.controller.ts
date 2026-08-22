import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type {
  AccountConfirmationResponse,
  LoginResponse,
} from '@mon-sinistre/contracts';
import type { EnvironmentVariables } from 'src/config/env.validation';
import type { AuthenticatedUser } from './auth.service';
import { AuthService } from './auth.service';
import { AccountConfirmationResponseDto } from './dto/account-confirmation-response.dto';
import { AccountTokenDto } from './dto/account-token.dto';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { RegisterDto } from './dto/register.dto';
import { LocalAuthGuard } from './local-auth.guard';

/** Name and path shared by every place that writes or will clear the refresh
 * cookie — only login today, refresh and logout follow in phase 2. */
export const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/auth';

/**
 * Declared rather than imported: fastify arrives under
 * `@nestjs/platform-fastify` and `@fastify/cookie` and is not a direct
 * dependency of this package (same reasoning as `HttpReply`/`HttpRequest` in
 * `src/common/all-exceptions.filter.ts`). `setCookie`'s shape is
 * `@fastify/cookie`'s `CookieSerializeOptions`, narrowed to what this
 * endpoint actually passes.
 */
interface ReplyWithCookie {
  setCookie(
    name: string,
    value: string,
    options: {
      path: string;
      httpOnly: boolean;
      sameSite: 'strict';
      secure: boolean;
      signed: boolean;
      expires: Date;
    },
  ): unknown;
}

interface RequestWithUser {
  readonly user: AuthenticatedUser;
}

/** Public — no authentication: anyone may attempt to register or log in. */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly cookieSecure: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.cookieSecure = config.get('HTTPS_ENABLED', { infer: true }) === true;
  }

  @Post('register')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Register a new account',
    description:
      'Body validation (email, password policy) answers 400 in the usual ' +
      'way. Once validated, the response is 204 whatever the address turns ' +
      'out to be — anti-enumeration, docs/prd/user-account.md.',
  })
  @ApiNoContentResponse()
  async register(@Body() dto: RegisterDto): Promise<void> {
    await this.auth.register(dto);
  }

  @Post('confirmation')
  // Overridden for the same reason as veille's confirmation POST.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activate an account from its confirmation link',
    description:
      'Mutates — visiting the link itself (GET, e.g. a mail client preview) ' +
      'never activates an account, only this POST does. Sets confirmedAt. A ' +
      'second call with the same token is not an error — it answers ' +
      '"confirmed" again. An unknown or expired token answers "invalid", ' +
      'the cause not told apart.',
  })
  @ApiOkResponse({ type: AccountConfirmationResponseDto })
  async confirm(
    @Body() body: AccountTokenDto,
  ): Promise<AccountConfirmationResponse> {
    return { status: await this.auth.confirm(body.token) };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'Passport-local runs first and answers 401 with one generic message ' +
      'for every cause — unknown address, wrong password, unconfirmed ' +
      'account — anti-enumeration (src/auth/CLAUDE.md). On success the ' +
      'access token comes back in the body and the refresh token is set as ' +
      'an httpOnly cookie, never in the body.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse()
  async login(
    // Unused: LocalAuthGuard already authenticated off the raw body ahead of
    // this pipe (src/auth/local.strategy.ts) — declared so the global
    // ValidationPipe's forbidNonWhitelisted still rejects an unexpected body
    // (apps/api/CLAUDE.md, «Правила проекта»).
    @Body() _dto: LoginDto,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) reply: ReplyWithCookie,
  ): Promise<LoginResponse> {
    const { access, refresh } = await this.auth.login(req.user.id);

    reply.setCookie(REFRESH_COOKIE_NAME, refresh.token, {
      path: REFRESH_COOKIE_PATH,
      httpOnly: true,
      sameSite: 'strict',
      secure: this.cookieSecure,
      signed: true,
      expires: refresh.expiresAt,
    });

    return access;
  }
}
