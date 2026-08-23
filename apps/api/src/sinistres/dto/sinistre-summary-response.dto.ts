import { ApiProperty } from '@nestjs/swagger';
import {
  RisqueCatnat,
  SinistreStatus,
  type IsoDate,
  type IsoDateTime,
  type SinistreSummary,
} from '@mon-sinistre/contracts';

/**
 * Swagger-only mirror of {@link SinistreSummary} — `implements` makes the
 * compiler fail here whenever the contract changes. {@link
 * SinistreDetailResponseDto} extends this rather than repeating its fields.
 */
export class SinistreSummaryResponseDto implements SinistreSummary {
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
}
