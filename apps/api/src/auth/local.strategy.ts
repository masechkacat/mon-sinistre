import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { FastifyRequest } from 'fastify';
import { Strategy } from 'passport-local';
import { normalizeEmail } from 'src/common/normalize-email.decorator';
import { fr } from 'src/i18n/fr';
import { AuthService, type AuthenticatedUser } from './auth.service';

/**
 * Reads `email`/`password` off the raw request body — Nest runs guards before
 * pipes, so `LoginDto`'s `NormalizeEmail` transform has not run yet here;
 * `normalizeEmail` is called again directly (`src/common/normalize-email.decorator.ts`).
 *
 * The request is taken instead of passport's own arguments on purpose:
 * passport-local falls back to the query string, and a password in a URL ends
 * up in every proxy's access log. Only the body counts here, and only when
 * both fields are strings — anything else is the same 401 as a wrong password.
 */
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly auth: AuthService) {
    super({ usernameField: 'email', passReqToCallback: true });
  }

  async validate(req: FastifyRequest): Promise<AuthenticatedUser> {
    const { email, password } = (req.body ?? {}) as Record<string, unknown>;
    const user =
      typeof email === 'string' && typeof password === 'string'
        ? await this.auth.validateCredentials(normalizeEmail(email), password)
        : null;
    if (!user) throw new UnauthorizedException(fr.auth.login.invalid);
    return user;
  }
}
