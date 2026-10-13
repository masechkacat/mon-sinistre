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
import { NormalizeEmail } from 'src/common/http/normalize-email.decorator.js';
import { CreateSinistreDto } from 'src/sinistres/dto/create-sinistre.dto.js';
import { IsAccountPassword } from '../is-account-password.decorator.js';

/** `dossier` of {@link RegisterInput}. */
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
