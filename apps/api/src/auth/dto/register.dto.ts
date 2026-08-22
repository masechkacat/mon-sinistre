import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';
import { NormalizeEmail } from 'src/common/normalize-email.decorator';
import { IsAccountPassword } from '../is-account-password.decorator';

export class RegisterDto {
  /**
   * Normalized before validation — trimmed and lower-cased — so
   * " User@X.fr " and "user@x.fr" reach the service as the same address
   * (docs/research/user-account.md).
   */
  @ApiProperty({ example: 'victime@example.fr' })
  @NormalizeEmail()
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Abc12345' })
  @IsString()
  @IsAccountPassword()
  password: string;
}
