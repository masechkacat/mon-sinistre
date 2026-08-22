import { ApiProperty } from '@nestjs/swagger';
import {
  ACCOUNT_CONFIRMATION_STATUSES,
  type AccountConfirmationResponse,
  type AccountConfirmationStatus,
} from '@mon-sinistre/contracts';

/**
 * Swagger-only mirror of {@link AccountConfirmationResponse} — `implements`
 * makes the compiler fail here whenever the contract changes.
 */
export class AccountConfirmationResponseDto implements AccountConfirmationResponse {
  @ApiProperty({ enum: ACCOUNT_CONFIRMATION_STATUSES })
  status: AccountConfirmationStatus;
}
