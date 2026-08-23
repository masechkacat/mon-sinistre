import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Length } from 'class-validator';
import {
  INSEE_CODE_LENGTH,
  RisqueCatnat,
  type IsoDate,
} from '@mon-sinistre/contracts';
import { IsNotFutureIsoDate } from '../is-not-future-iso-date.decorator';

export class CreateSinistreDto {
  @ApiProperty({ example: '30189' })
  @IsString()
  @Length(INSEE_CODE_LENGTH, INSEE_CODE_LENGTH)
  codeInsee: string;

  @ApiProperty({ enum: RisqueCatnat })
  @IsEnum(RisqueCatnat)
  risque: RisqueCatnat;

  @ApiProperty({ type: String, format: 'date', example: '2026-06-15' })
  @IsNotFutureIsoDate()
  eventDate: IsoDate;
}
