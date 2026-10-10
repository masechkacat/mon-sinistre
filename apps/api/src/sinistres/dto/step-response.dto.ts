import { ApiProperty } from '@nestjs/swagger';
import {
  DurationUnit,
  StepAnchor,
  StepKind,
  StepStatus,
  type IsoDate,
  type Step,
  type StepView,
} from '@mon-sinistre/contracts';
import { SourceReferenceDto } from './source-reference.dto';

export class StepDelayDto {
  @ApiProperty()
  value: number;

  @ApiProperty({ enum: DurationUnit })
  unit: DurationUnit;
}

/**
 * Swagger-only mirror of {@link StepView} — `implements` makes the compiler
 * fail here whenever the contract changes. Split off {@link StepResponseDto}
 * the way the contract splits the two: the dossier aperçu answers with steps
 * that have no identity and no marks.
 */
export class StepViewResponseDto implements StepView {
  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ enum: StepKind })
  kind: StepKind;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  plannedDate: IsoDate | null;

  @ApiProperty({ enum: StepStatus })
  status: StepStatus;

  @ApiProperty({ enum: StepAnchor, nullable: true })
  anchor: StepAnchor | null;

  @ApiProperty({ type: SourceReferenceDto, nullable: true })
  source: SourceReferenceDto | null;

  @ApiProperty({ nullable: true })
  daysLeft: number | null;

  @ApiProperty({ type: StepDelayDto, nullable: true })
  delay: StepDelayDto | null;

  @ApiProperty()
  order: number;
}

/** Swagger-only mirror of {@link Step} — the saved step: a {@link
 * StepViewResponseDto} that exists in the database. */
export class StepResponseDto extends StepViewResponseDto implements Step {
  @ApiProperty()
  id: string;

  @ApiProperty()
  sinistreId: string;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  completedAt: IsoDate | null;

  @ApiProperty()
  fromTemplate: boolean;
}
