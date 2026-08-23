import { ApiProperty } from '@nestjs/swagger';
import type { SinistreDetail } from '@mon-sinistre/contracts';
import { SinistreSummaryResponseDto } from './sinistre-summary-response.dto';
import { StepResponseDto } from './step-response.dto';

/**
 * Swagger-only mirror of {@link SinistreDetail} — `implements` makes the
 * compiler fail here whenever the contract changes. Extends {@link
 * SinistreSummaryResponseDto} rather than repeating its fields.
 */
export class SinistreDetailResponseDto
  extends SinistreSummaryResponseDto
  implements SinistreDetail
{
  @ApiProperty({ type: StepResponseDto, isArray: true })
  steps: StepResponseDto[];
}
