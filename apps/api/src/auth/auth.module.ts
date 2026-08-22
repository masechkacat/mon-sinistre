import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalStrategy } from './local.strategy';

/**
 * `JwtModule.register({})` only makes `JwtService` injectable — access and
 * refresh tokens use two different secrets (`JWT_SECRET`,
 * `JWT_REFRESH_SECRET`), passed explicitly on every `sign`/`decode` call in
 * `AuthService`, never a module-wide default that one call could forget to
 * override.
 */
@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy],
})
export class AuthModule {}
