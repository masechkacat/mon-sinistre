import { ApiProperty } from '@nestjs/swagger';
import type { IsoDate, SinistreConflict } from '@mon-sinistre/contracts';

class ExistingDossierDto {
  id: string;

  @ApiProperty({ type: String, format: 'date' })
  eventDate: IsoDate;
}

/** Swagger-only mirror of {@link SinistreConflict}. */
export class SinistreConflictResponseDto implements SinistreConflict {
  @ApiProperty({ enum: ['DOSSIER_EXISTANT'] })
  code: 'DOSSIER_EXISTANT';

  @ApiProperty({ type: ExistingDossierDto })
  existing: ExistingDossierDto;
}
