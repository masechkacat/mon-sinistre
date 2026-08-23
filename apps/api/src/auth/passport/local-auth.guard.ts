import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Runs `LocalStrategy` against `POST /auth/login`'s body. */
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {}
