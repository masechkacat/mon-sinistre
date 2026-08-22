import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';
import { NormalizeEmail } from 'src/common/normalize-email.decorator';

/**
 * Body of `POST /auth/password-reset` — email only. No password here: the
 * CNIL policy applies to the one the token endpoint sets
 * (`docs/plan/user-account.md`, phase 3, next issue).
 */
export class RequestPasswordResetDto {
  @ApiProperty({ example: 'victime@example.fr' })
  @NormalizeEmail()
  @IsEmail()
  email: string;
}
