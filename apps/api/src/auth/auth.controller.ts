import {
  Body,
  Controller,
  Delete,
  Get,
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
import { Throttle } from '@nestjs/throttler';
import type {
  AccountConfirmationResponse,
  CurrentUserResponse,
  LoginResponse,
  ResetPasswordResponse,
} from '@mon-sinistre/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EnvironmentVariables } from 'src/config/env.validation';
import { fr } from 'src/i18n/fr';
import type { AuthenticatedUser, RefreshTokenIssued } from './auth.service';
import { AuthService } from './auth.service';
import { AccountConfirmationResponseDto } from './dto/account-confirmation-response.dto';
import { AccountTokenDto } from './dto/account-token.dto';
import { CurrentUserResponseDto } from './dto/current-user-response.dto';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ResetPasswordResponseDto } from './dto/reset-password-response.dto';
import type { RequestWithJwtUser } from './passport/jwt.strategy';
import { LocalAuthGuard } from './passport/local-auth.guard';
import { Public } from './public.decorator';

/** Exported for the specs, which replay the cookie by name. */
export const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/auth';

/**
 * Per-IP cap on the two cookie-driven endpoints, on top of the global one
 * (`app.module.ts`). Without it, one stale rotated-out cookie replayed in a
 * loop at `/auth/refresh` is a zero-cost forced logout of the account — each
 * replay past the grace window kills every live session again
 * (`AuthService.refresh`). A real client refreshes once per access-token
 * lifetime; a NAT with a hundred people behind it still fits. Exported for
 * the spec, which must not restate the number.
 */
export const SESSION_RATE_LIMIT = { ttl: 60_000, limit: 30 } as const;

/**
 * Per-IP cap on the public auth endpoints that mail nobody — confirmation,
 * login, password-reset confirm — on top of the global one (`app.module.ts`)
 * and, for login, the per-address counter
 * (`AuthService.validateCredentials`, `LOGIN_ATTEMPT_LIMIT`). Roomier than
 * `AUTH_MAIL_RATE_LIMIT` below because the cost of a request here stops at
 * this server: a person mistyping a password, and a mail client prefetching
 * a confirmation link, both fit. Exported for the spec, which must not
 * restate the number.
 */
export const AUTH_FORM_RATE_LIMIT = { ttl: 60_000, limit: 30 } as const;

/**
 * Per-IP cap on the two endpoints that mail a third-party address (register,
 * password-reset request) — the same number and the same reasoning as
 * veille's form endpoint (`VEILLE_FORM_RATE_LIMIT`, its own docblock has the
 * "why"): this is the only limit that bounds mailing to *many* addresses at
 * once, since the per-address limit (`ACCOUNT_EMAIL_LIMIT`) counts one
 * address at a time and would let a victim per request through. A human
 * registers, or asks for a reset, once. Exported for the spec, which must
 * not restate the number.
 */
export const AUTH_MAIL_RATE_LIMIT = { ttl: 60_000, limit: 5 } as const;

interface RequestWithUser {
  readonly user: AuthenticatedUser;
}

/**
 * `@Public()` is per handler, never on the class: the global `JwtAuthGuard`
 * is fail-closed, and a handler added here later must inherit the lock, not
 * the exemption. The ones marked are public by their nature — nobody has a
 * session before register/confirmation/login/password-reset, and
 * refresh/logout identify the caller by the cookie, not by a bearer.
 */
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

  @Public()
  @Throttle({ default: AUTH_MAIL_RATE_LIMIT })
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

  @Public()
  @Throttle({ default: AUTH_FORM_RATE_LIMIT })
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

  @Public()
  @Throttle({ default: AUTH_MAIL_RATE_LIMIT })
  @Post('password-reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Request a password-reset link',
    description:
      'Always 204, whatever the address turns out to be — ' +
      'anti-enumeration (docs/prd/user-account.md). A mail with a reset ' +
      'link goes out only when the address matches an existing account.',
  })
  @ApiNoContentResponse()
  async requestPasswordReset(
    @Body() dto: RequestPasswordResetDto,
  ): Promise<void> {
    await this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Throttle({ default: AUTH_FORM_RATE_LIMIT })
  @Post('password-reset/confirm')
  // Nest answers 201 to a POST by default; the contract of this endpoint is
  // 200 { status } whatever the token turns out to be.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set a new password from a password-reset link',
    description:
      'Body validation (new password policy) answers 400 before the token ' +
      'is ever looked at. Past that, the token is single-use: an unknown, ' +
      'expired or already-used one all answer "invalid", the cause not ' +
      'told apart. A successful reset revokes every refresh token of the ' +
      'account — every other device is signed out.',
  })
  @ApiOkResponse({ type: ResetPasswordResponseDto })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<ResetPasswordResponse> {
    return { status: await this.auth.resetPassword(dto.token, dto.password) };
  }

  @Public()
  @Throttle({ default: AUTH_FORM_RATE_LIMIT })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'Passport-local runs first and answers 401 with one generic message ' +
      'for every cause — unknown address, wrong password, unconfirmed ' +
      'account — anti-enumeration (src/auth/CLAUDE.md). Past too many failed ' +
      'attempts for the address within the past hour, every cause answers ' +
      '429 instead, identically for an existing and a nonexistent address. ' +
      'On success the access token comes back in the body and the refresh ' +
      'token is set as an httpOnly cookie, never in the body.',
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

  @Public()
  @Throttle({ default: SESSION_RATE_LIMIT })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh cookie and issue a fresh access token',
    description:
      'No body — the refresh token comes only from the httpOnly cookie. ' +
      'The presented token is revoked and replaced by a new one (rotation). ' +
      'Presenting it again within a few seconds (a second tab, a retry) ' +
      'issues another fresh pair; later than that it is treated as a ' +
      'replay of a stolen token and every live session of the account is ' +
      'ended — src/auth/CLAUDE.md. A missing/invalid/expired cookie answers ' +
      '401 with one generic message.',
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

  @Public()
  @Throttle({ default: SESSION_RATE_LIMIT })
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
    this.clearRefreshCookie(reply);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get the email of the currently authenticated user',
    description:
      'Requires a valid access token — the global JwtAuthGuard answers 401 ' +
      'otherwise. Used by the web client to populate espace personnel.',
  })
  @ApiOkResponse({ type: CurrentUserResponseDto })
  @ApiUnauthorizedResponse()
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
    this.clearRefreshCookie(reply);
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

  /** Same `path` as `setRefreshCookie`, or the browser finds no cookie to
   * delete. */
  private clearRefreshCookie(reply: FastifyReply): void {
    reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  }

  /** `undefined` covers every invalid shape alike: missing, unsigned or a
   * signature that fails to verify. */
  private readRefreshCookie(req: FastifyRequest): string | undefined {
    const raw = req.cookies[REFRESH_COOKIE_NAME];
    const unsigned = raw ? req.unsignCookie(raw) : undefined;
    return unsigned?.valid ? unsigned.value : undefined;
  }
}
