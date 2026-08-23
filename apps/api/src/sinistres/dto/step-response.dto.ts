import { ApiProperty } from '@nestjs/swagger';
import {
  StepAnchor,
  StepStatus,
  type IsoDate,
  type Step,
} from '@mon-sinistre/contracts';
import { SourceReferenceDto } from './source-reference.dto';

/**
 * Swagger-only mirror of {@link Step} — `implements` makes the compiler fail
 * here whenever the contract changes.
 */
export class StepResponseDto implements Step {
  @ApiProperty()
  id: string;

  @ApiProperty()
  sinistreId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  plannedDate: IsoDate | null;

  @ApiProperty({ enum: StepStatus })
  status: StepStatus;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  completedAt: IsoDate | null;

  @ApiProperty()
  fromTemplate: boolean;

  @ApiProperty({ enum: StepAnchor, nullable: true })
  anchor: StepAnchor | null;

  @ApiProperty({ type: SourceReferenceDto, nullable: true })
  source: SourceReferenceDto | null;
}
