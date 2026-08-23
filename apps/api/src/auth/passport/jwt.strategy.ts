import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { EnvironmentVariables } from 'src/config/env.validation';
import { PrismaService } from 'src/prisma/prisma.service';
import { TOKEN_TYPE, type TokenPayload } from '../auth.service';

/** What `validate` below returns — Passport attaches it to the request as
 * `req.user` once `JwtAuthGuard` defers to this strategy. */
export interface JwtUser {
  id: string;
}

/**
 * Verifies the access token from the `Authorization: Bearer` header against
 * `JWT_SECRET` — the same secret `AuthService.issueTokens` signs it with.
 * Expiry is checked by the library; `typ`, `sub` and the account's existence
 * here. The existence check is one indexed lookup per request, and it is
 * what turns a bearer outliving its deleted account into a 401 — the answer
 * the web client's refresh-then-logout flow reacts to — rather than a 404
 * or, on an endpoint that inserts rows under `userId`, a 500. Passport
 * reads a thrown error as "not authenticated", so the same 401 covers every
 * shape of a bad principal.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  async validate(payload: Partial<TokenPayload>): Promise<JwtUser> {
    const { sub, typ } = payload;
    if (typ !== TOKEN_TYPE.access || typeof sub !== 'string' || !sub) {
      throw new UnauthorizedException();
    }
    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      select: { id: true },
    });
    if (!user) throw new UnauthorizedException();
    return { id: user.id };
  }
}
