import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsString,
  Length,
} from 'class-validator';
import {
  INSEE_CODE_LENGTH,
  VEILLE_MAX_COMMUNES,
} from '@mon-sinistre/contracts';
import { NormalizeEmail } from 'src/common/http/normalize-email.decorator';

export class CreateVeilleDto {
  /**
   * Normalized before validation — trimmed and lower-cased — so
   * " User@Example.fr " and "user@example.fr" reach the service as the same
   * address (docs/research/veille-subscription-lifecycle.md).
   */
  @ApiProperty({ example: 'riverain@example.fr' })
  @NormalizeEmail()
  @IsEmail()
  email: string;

  @ApiProperty({
    type: [String],
    example: ['30189'],
    minItems: 1,
    maxItems: VEILLE_MAX_COMMUNES,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(VEILLE_MAX_COMMUNES)
  @IsString({ each: true })
  @Length(INSEE_CODE_LENGTH, INSEE_CODE_LENGTH, { each: true })
  communeCodes: string[];
}
