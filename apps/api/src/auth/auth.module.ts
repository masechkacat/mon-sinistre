import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { LocalStrategy } from './local.strategy';
import { MeController } from './me.controller';

/**
 * `JwtModule.register({})` only makes `JwtService` injectable — access and
 * refresh tokens use two different secrets (`JWT_SECRET`,
 * `JWT_REFRESH_SECRET`), passed explicitly on every `sign`/`decode` call in
 * `AuthService`, never a module-wide default that one call could forget to
 * override.
 */
@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController, MeController],
  providers: [AuthService, LocalStrategy, JwtStrategy],
})
export class AuthModule {}
