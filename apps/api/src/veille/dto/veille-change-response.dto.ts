import { ApiProperty } from '@nestjs/swagger';
import {
  VEILLE_CHANGE_STATUSES,
  type VeilleChangeResponse,
  type VeilleChangeStatus,
} from '@mon-sinistre/contracts';

/** One commune of the pending request's new composition. */
class VeilleChangeCommuneDto {
  @ApiProperty({ example: 'Nîmes' })
  name: string;

  @ApiProperty({ example: 'Gard' })
  departementName: string;
}

/**
 * Swagger-only mirror of {@link VeilleChangeResponse} — `implements` makes the
 * compiler fail here whenever the contract changes.
 */
export class VeilleChangeResponseDto implements VeilleChangeResponse {
  @ApiProperty({ enum: VEILLE_CHANGE_STATUSES })
  status: VeilleChangeStatus;

  @ApiProperty({ type: VeilleChangeCommuneDto, isArray: true, required: false })
  communes?: { name: string; departementName: string }[];
}
