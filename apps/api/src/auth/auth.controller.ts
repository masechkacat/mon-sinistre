import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
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
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EnvironmentVariables } from 'src/config/env.validation';
import { fr } from 'src/i18n/fr';
import type { AuthenticatedUser, RefreshTokenIssued } from './auth.service';
import { AuthService } from './auth.service';
import { AccountConfirmationResponseDto } from './dto/account-confirmation-response.dto';
import { AccountTokenDto } from './dto/account-token.dto';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { RegisterDto } from './dto/register.dto';
import { LocalAuthGuard } from './local-auth.guard';
import { Public } from './public.decorator';

/** Name and path shared by every place that writes or clears the refresh
 * cookie — login, refresh, logout and account deletion (`MeController`). */
export const REFRESH_COOKIE_NAME = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/auth';

/** Shared by `logout` below and `MeController.deleteAccount` — the only two
 * places that end a session by clearing the cookie rather than setting a
 * fresh one. */
export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

interface RequestWithUser {
  readonly user: AuthenticatedUser;
}

/**
 * Public — no authentication: anyone may attempt to register or log in.
 * `login` is also gated by `LocalAuthGuard`, and `refresh`/`logout` read
 * their own token off the cookie — none of the four go through the global
 * `JwtAuthGuard`'s bearer-token check, so the whole controller carries
 * `@Public()` rather than repeating it endpoint by endpoint.
 */
@Public()
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly cookieSecure: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    // `env.validation.ts` refuses a production start without it.
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
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    const { access, refresh } = await this.auth.login(req.user.id);
    this.setRefreshCookie(reply, refresh);
    return access;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh cookie and issue a fresh access token',
    description:
      'No body — the refresh token comes only from the httpOnly cookie. ' +
      'The presented token is revoked and replaced by a new one (rotation): ' +
      'reusing it afterwards, or presenting a missing/invalid/expired ' +
      'cookie, answers 401 with one generic message. Reusing an ' +
      'already-rotated token additionally revokes every other live refresh ' +
      'token of that account — src/auth/CLAUDE.md.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse()
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    const token = this.readRefreshCookie(req);
    if (!token) {
      throw new UnauthorizedException(fr.auth.session.expired);
    }

    const { access, refresh } = await this.auth.refresh(token);
    this.setRefreshCookie(reply, refresh);
    return access;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Log out: revoke the cookie's refresh token and clear the cookie",
    description:
      'No body — same source as refresh, the httpOnly cookie. Always ' +
      'answers 204: a missing, tampered, expired or already-revoked token ' +
      'is not an error — repeating logout, or logging out with no session ' +
      'at all, is not a failure. The cookie is cleared either way.',
  })
  @ApiNoContentResponse()
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const token = this.readRefreshCookie(req);
    if (token) {
      await this.auth.logout(token);
    }
    clearRefreshCookie(reply);
  }

  private setRefreshCookie(
    reply: FastifyReply,
    refresh: RefreshTokenIssued,
  ): void {
    reply.setCookie(REFRESH_COOKIE_NAME, refresh.token, {
      path: REFRESH_COOKIE_PATH,
      httpOnly: true,
      sameSite: 'strict',
      secure: this.cookieSecure,
      signed: true,
      expires: refresh.expiresAt,
    });
  }

  /** Shared by `refresh` and `logout` — the only two places that read the
   * refresh cookie back off a request. `undefined` covers every invalid
   * shape alike: missing, unsigned or a signature that fails to verify. */
  private readRefreshCookie(req: FastifyRequest): string | undefined {
    const raw = req.cookies[REFRESH_COOKIE_NAME];
    const unsigned = raw ? req.unsignCookie(raw) : undefined;
    return unsigned?.valid ? unsigned.value : undefined;
  }
}
