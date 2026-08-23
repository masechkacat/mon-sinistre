import { ApiProperty } from '@nestjs/swagger';
import {
  PASSWORD_RESET_STATUSES,
  type PasswordResetStatus,
  type ResetPasswordResponse,
} from '@mon-sinistre/contracts';

/**
 * Swagger-only mirror of {@link ResetPasswordResponse} — `implements` makes
 * the compiler fail here whenever the contract changes.
 */
export class ResetPasswordResponseDto implements ResetPasswordResponse {
  @ApiProperty({ enum: PASSWORD_RESET_STATUSES })
  status: PasswordResetStatus;
}
