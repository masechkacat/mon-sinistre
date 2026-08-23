import { ApiProperty } from '@nestjs/swagger';
import type { IsoDate, SourceReference } from '@mon-sinistre/contracts';

/**
 * Swagger-only mirror of {@link SourceReference} — `implements` makes the
 * compiler fail here whenever the contract changes.
 */
export class SourceReferenceDto implements SourceReference {
  @ApiProperty()
  url: string;

  @ApiProperty({ type: String, format: 'date' })
  verifiedAt: IsoDate;

  @ApiProperty()
  possiblyOutdated: boolean;
}
