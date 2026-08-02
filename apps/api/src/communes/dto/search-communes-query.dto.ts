import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The longest commune name in the COG is 45 characters
 * (Saint-Remy-en-Bouzemont-Saint-Genest-et-Isson); 64 leaves headroom while
 * keeping arbitrarily long input away from the LIKE query.
 */
const MAX_QUERY_LENGTH = 64;

export class SearchCommunesQueryDto {
  /**
   * Name prefix or exact INSEE code. No digits-only format on purpose:
   * Corsican codes contain letters (2A004). Minimum length keeps one-letter
   * scans off the database.
   */
  @ApiProperty({
    description: 'Commune name prefix or exact INSEE code (e.g. 2A004)',
    example: 'Château',
    minLength: 2,
    maxLength: MAX_QUERY_LENGTH,
  })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(MAX_QUERY_LENGTH)
  q: string;
}
