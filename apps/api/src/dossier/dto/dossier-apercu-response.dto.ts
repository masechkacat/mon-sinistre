import { ApiProperty } from '@nestjs/swagger';
import {
  ArreteEntryOutcome,
  RisqueCatnat,
  SinistreStatus,
  type Commune,
  type DossierApercu,
  type IsoDate,
} from '@mon-sinistre/contracts';
import { CommuneResponseDto } from 'src/communes/dto/commune-response.dto';
import { DeclarationDeadlineResponseDto } from 'src/sinistres/dto/declaration-deadline-response.dto';
import { StepViewResponseDto } from 'src/sinistres/dto/step-response.dto';

class ApercuArreteDto implements NonNullable<DossierApercu['arrete']> {
  @ApiProperty({ type: String, format: 'date' })
  publishedAt: IsoDate;

  @ApiProperty()
  legifranceUrl: string;

  @ApiProperty({ enum: ArreteEntryOutcome })
  outcome: ArreteEntryOutcome;

  @ApiProperty({ type: String, format: 'date' })
  eventStart: IsoDate;

  @ApiProperty({ type: String, format: 'date' })
  eventEnd: IsoDate;
}

/**
 * Swagger-only mirror of {@link DossierApercu} — `implements` makes the
 * compiler fail here whenever the contract changes.
 */
export class DossierApercuResponseDto implements DossierApercu {
  @ApiProperty({ type: CommuneResponseDto })
  commune: Commune;

  @ApiProperty({ enum: RisqueCatnat })
  risque: RisqueCatnat;

  @ApiProperty({ type: String, format: 'date' })
  eventDate: IsoDate;

  @ApiProperty({ enum: SinistreStatus })
  status: SinistreStatus;

  @ApiProperty({ type: ApercuArreteDto, nullable: true })
  arrete: ApercuArreteDto | null;

  @ApiProperty({ type: StepViewResponseDto, isArray: true })
  steps: StepViewResponseDto[];

  @ApiProperty({ type: DeclarationDeadlineResponseDto, nullable: true })
  declarationDeadline: DeclarationDeadlineResponseDto | null;
}
