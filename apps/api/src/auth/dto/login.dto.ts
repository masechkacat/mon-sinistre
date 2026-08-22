import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { NormalizeEmail } from 'src/common/normalize-email.decorator';

/**
 * Body of `POST /auth/login`. No password-policy check here — unlike
 * `RegisterDto`, an existing account's password must still be accepted even
 * if today's rules tightened after it was set (`docs/research/user-account.md`,
 * «Ограничения и риски»).
 */
export class LoginDto {
  @ApiProperty({ example: 'victime@example.fr' })
  @NormalizeEmail()
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Abc12345' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
