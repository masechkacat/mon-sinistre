import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { EnvironmentVariables } from 'src/config/env.validation';

interface AccessTokenPayload {
  sub: string;
}

/** What `validate` below returns — Passport attaches it to the request as
 * `req.user` once `JwtAuthGuard` defers to this strategy. */
export interface JwtUser {
  id: string;
}

/**
 * Verifies the access token from the `Authorization: Bearer` header against
 * `JWT_SECRET` — the same secret `AuthService.issueTokens` signs it with.
 * Expiry is checked by the library, not here. The payload only carries
 * `sub`: an endpoint that needs the email looks it up itself, this strategy
 * does not query the database on every request.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  validate(payload: AccessTokenPayload): JwtUser {
    return { id: payload.sub };
  }
}
