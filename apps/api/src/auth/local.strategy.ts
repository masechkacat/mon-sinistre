import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { normalizeEmail } from 'src/common/normalize-email.decorator';
import { fr } from 'src/i18n/fr';
import { AuthService, type AuthenticatedUser } from './auth.service';

/**
 * Reads `email`/`password` off the raw request body — Nest runs guards before
 * pipes, so `LoginDto`'s `NormalizeEmail` transform has not run yet here;
 * `normalizeEmail` is called again directly (`src/common/normalize-email.decorator.ts`).
 */
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly auth: AuthService) {
    super({ usernameField: 'email' });
  }

  async validate(email: string, password: string): Promise<AuthenticatedUser> {
    const user = await this.auth.validateCredentials(
      normalizeEmail(email),
      password,
    );
    if (!user) throw new UnauthorizedException(fr.auth.login.invalid);
    return user;
  }
}
