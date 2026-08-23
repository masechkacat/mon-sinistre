import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';
import { NormalizeEmail } from 'src/common/http/normalize-email.decorator';

/**
 * Body of `POST /auth/password-reset` — email only. No password here: the
 * CNIL policy applies to the one the token endpoint sets
 * (`dto/reset-password.dto.ts`, `POST /auth/password-reset/confirm`).
 */
export class RequestPasswordResetDto {
  @ApiProperty({ example: 'victime@example.fr' })
  @NormalizeEmail()
  @IsEmail()
  email: string;
}
