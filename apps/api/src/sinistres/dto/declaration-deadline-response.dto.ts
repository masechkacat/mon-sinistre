import { ApiProperty } from '@nestjs/swagger';
import type { DeclarationDeadline, IsoDate } from '@mon-sinistre/contracts';
import { SourceReferenceDto } from './source-reference.dto';

export class DeclarationDeadlineResponseDto implements DeclarationDeadline {
  @ApiProperty({ type: String, format: 'date' })
  date: IsoDate;

  @ApiProperty()
  daysLeft: number;

  @ApiProperty({ type: SourceReferenceDto })
  source: SourceReferenceDto;
}
