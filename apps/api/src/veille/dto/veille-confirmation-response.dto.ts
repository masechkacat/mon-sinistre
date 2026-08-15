import { ApiProperty } from '@nestjs/swagger';
import type {
  VeilleConfirmationResponse,
  VeilleConfirmationStatus,
} from '@mon-sinistre/contracts';

/**
 * Swagger-only mirror of {@link VeilleConfirmationResponse} —
 * `implements` makes the compiler fail here whenever the contract changes.
 */
export class VeilleConfirmationResponseDto implements VeilleConfirmationResponse {
  @ApiProperty({ enum: ['pending', 'active', 'invalid'] })
  status: VeilleConfirmationStatus;
}
