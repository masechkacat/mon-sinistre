import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TokenDto } from 'src/common/http/token.dto';
import { IsAccountPassword } from '../is-account-password.decorator';

/**
 * Body of `POST /auth/password-reset/confirm` — the mailed token plus the
 * chosen password, validated by the same `IsAccountPassword` rule as
 * `RegisterDto` (`is-account-password.decorator.ts`), second copy not
 * warranted.
 */
export class ResetPasswordDto extends TokenDto {
  @ApiProperty({ example: 'Abc12345' })
  @IsString()
  @IsAccountPassword()
  password: string;
}
