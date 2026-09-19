import { ApiProperty } from '@nestjs/swagger';
import {
  RisqueCatnat,
  SinistreStatus,
  type Commune,
  type IsoDate,
  type IsoDateTime,
  type SinistreSummary,
} from '@mon-sinistre/contracts';
import { CommuneResponseDto } from 'src/communes/dto/commune-response.dto';

/**
 * Swagger-only mirror of {@link SinistreSummary} — `implements` makes the
 * compiler fail here whenever the contract changes. {@link
 * SinistreDetailResponseDto} extends this rather than repeating its fields.
 */
export class SinistreSummaryResponseDto implements SinistreSummary {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: CommuneResponseDto })
  commune: Commune;

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
