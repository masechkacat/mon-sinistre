import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { StepPersistedStatus } from 'src/generated/prisma/enums';

/**
 * The two `StepStatus` values a client may set directly — the same
 * restriction `StepPersistedStatus` encodes in the schema
 * (docs/research/sinistre-plan.md, «Статусы шагов на чтении»). `null` unmarks
 * the step and falls back to the computed status.
 */
export class UpdateStepDto {
  @ApiProperty({ enum: StepPersistedStatus, nullable: true })
  @IsIn([StepPersistedStatus.FAIT, StepPersistedStatus.NON_APPLICABLE, null])
  status: StepPersistedStatus | null;
}
