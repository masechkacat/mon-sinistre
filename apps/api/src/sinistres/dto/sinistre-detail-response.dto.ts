import { ApiProperty } from '@nestjs/swagger';
import {
  RisqueCatnat,
  SinistreStatus,
  type IsoDate,
  type IsoDateTime,
  type SinistreDetail,
} from '@mon-sinistre/contracts';
import { StepResponseDto } from './step-response.dto';

/**
 * Swagger-only mirror of {@link SinistreDetail} — `implements` makes the
 * compiler fail here whenever the contract changes.
 */
export class SinistreDetailResponseDto implements SinistreDetail {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: '30189' })
  communeCode: string;

  @ApiProperty({ enum: RisqueCatnat })
  risque: RisqueCatnat;

  @ApiProperty({ type: String, format: 'date' })
  eventDate: IsoDate;

  @ApiProperty({ nullable: true })
  arreteEntryId: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  declarationDate: IsoDate | null;

  @ApiProperty({ enum: SinistreStatus })
  status: SinistreStatus;

  @ApiProperty()
  createdAt: IsoDateTime;

  @ApiProperty({ type: StepResponseDto, isArray: true })
  steps: StepResponseDto[];
}
