import { ApiProperty } from '@nestjs/swagger';
import {
  ArreteEntryOutcome,
  type ArreteCoverage,
  type IsoDate,
} from '@mon-sinistre/contracts';

/**
 * Swagger-only mirror of {@link ArreteCoverage} — what one annexe line says
 * about the event it covers. Both public responses print it: the aperçu as
 * its matched arrêté, the commune answer as the head of every listed entry.
 */
export class ArreteCoverageResponseDto implements ArreteCoverage {
  @ApiProperty({ type: String, format: 'date' })
  publishedAt: IsoDate;

  @ApiProperty()
  legifranceUrl: string;

  @ApiProperty({ enum: ArreteEntryOutcome })
  outcome: ArreteEntryOutcome;

  @ApiProperty({ type: String, format: 'date' })
  eventStart: IsoDate;

  @ApiProperty({ type: String, format: 'date' })
  eventEnd: IsoDate;
}
