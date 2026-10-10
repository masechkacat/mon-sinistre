import { ApiProperty } from '@nestjs/swagger';
import {
  RisqueCatnat,
  SinistreStatus,
  type Commune,
  type DossierApercu,
  type IsoDate,
} from '@mon-sinistre/contracts';
import { CommuneResponseDto } from 'src/communes/dto/commune-response.dto';
import { DeclarationDeadlineResponseDto } from 'src/sinistres/dto/declaration-deadline-response.dto';
import { StepViewResponseDto } from 'src/sinistres/dto/step-response.dto';
import { ArreteCoverageResponseDto } from './arrete-coverage-response.dto';

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

  @ApiProperty({ type: ArreteCoverageResponseDto, nullable: true })
  arrete: ArreteCoverageResponseDto | null;

  @ApiProperty({ type: StepViewResponseDto, isArray: true })
  steps: StepViewResponseDto[];

  @ApiProperty({ type: DeclarationDeadlineResponseDto, nullable: true })
  declarationDeadline: DeclarationDeadlineResponseDto | null;
}
