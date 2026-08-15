import { ApiProperty } from '@nestjs/swagger';
import {
  VEILLE_CONFIRMATION_STATUSES,
  type VeilleConfirmationResponse,
  type VeilleConfirmationStatus,
} from '@mon-sinistre/contracts';

/**
 * Swagger-only mirror of {@link VeilleConfirmationResponse} —
 * `implements` makes the compiler fail here whenever the contract changes.
 */
export class VeilleConfirmationResponseDto implements VeilleConfirmationResponse {
  @ApiProperty({ enum: VEILLE_CONFIRMATION_STATUSES })
  status: VeilleConfirmationStatus;
}
