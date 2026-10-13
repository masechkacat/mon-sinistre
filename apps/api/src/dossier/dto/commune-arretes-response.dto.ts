import { ApiProperty } from '@nestjs/swagger';
import {
  RisqueCatnat,
  type Commune,
  type CommuneArrete,
  type CommuneArretes,
} from '@mon-sinistre/contracts';
import { CommuneResponseDto } from 'src/communes/dto/commune-response.dto.js';
import { DeclarationDeadlineResponseDto } from 'src/sinistres/dto/declaration-deadline-response.dto.js';
import { ArreteCoverageResponseDto } from './arrete-coverage-response.dto.js';

class CommuneArreteDto
  extends ArreteCoverageResponseDto
  implements CommuneArrete
{
  @ApiProperty()
  arreteEntryId: string;

  @ApiProperty({ example: 'INTE2614404A' })
  nor: string;

  @ApiProperty({ example: 'Inondations et coulées de boue' })
  risqueLabel: string;

  @ApiProperty({ enum: RisqueCatnat, isArray: true })
  risques: RisqueCatnat[];

  @ApiProperty({ type: DeclarationDeadlineResponseDto, nullable: true })
  declarationDeadline: DeclarationDeadlineResponseDto | null;
}

/**
 * Swagger-only mirror of {@link CommuneArretes} — `implements` makes the
 * compiler fail here whenever the contract changes.
 */
export class CommuneArretesResponseDto implements CommuneArretes {
  @ApiProperty({ type: CommuneResponseDto })
  commune: Commune;

  @ApiProperty({ type: CommuneArreteDto, isArray: true })
  arretes: CommuneArreteDto[];
}
