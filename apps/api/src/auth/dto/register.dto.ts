import { ApiProperty, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import type { RegisterInput } from '@mon-sinistre/contracts';
import { NormalizeEmail } from 'src/common/http/normalize-email.decorator';
import { CreateSinistreDto } from 'src/sinistres/dto/create-sinistre.dto';
import { IsAccountPassword } from '../is-account-password.decorator';

/** `confirmNew` is the one rule of `POST /sinistres` that does not travel: a
 * brand-new account has no sinistre to collide with, and `RegisterInput`
 * omits it. */
export class PendingDossierDto extends OmitType(CreateSinistreDto, [
  'confirmNew',
] as const) {}

export class RegisterDto implements RegisterInput {
  @ApiProperty({ example: 'victime@example.fr' })
  @NormalizeEmail()
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Abc12345' })
  @IsString()
  @IsAccountPassword()
  password: string;

  /**
   * The dossier prepared without an account. `@IsObject` is not redundant
   * next to `@ValidateNested`: the latter takes an array as a list to
   * validate, so `[]` would pass every rule below it and reach the service
   * with all three fields undefined.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PendingDossierDto)
  dossier?: PendingDossierDto;
}
