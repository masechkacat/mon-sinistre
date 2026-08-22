import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Body of `POST /auth/login`, validated after `LocalStrategy` has already
 * authenticated off the raw body: the decorators here only mark the fields
 * as known to `forbidNonWhitelisted` — a stricter check would reject nothing
 * the strategy has not already answered 401 to. No password-policy check
 * either — unlike `RegisterDto`, an existing account's password must still be
 * accepted even if today's rules tightened after it was set
 * (`docs/research/user-account.md`, «Ограничения и риски»).
 */
export class LoginDto {
  @ApiProperty({ example: 'victime@example.fr' })
  @IsString()
  email: string;

  @ApiProperty({ example: 'Abc12345' })
  @IsString()
  password: string;
}
