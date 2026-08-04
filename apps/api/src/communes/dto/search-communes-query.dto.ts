import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * A single letter matches thousands of communes and the database would scan
 * for every one of them; two is the shortest prefix worth an index lookup.
 * Two is also enough for the INSEE branch to be wrong about — "2A" is not a
 * code — which costs one empty answer and no scan.
 */
export const MIN_QUERY_LENGTH = 2;

/**
 * The longest commune name in the COG is 45 characters
 * (Saint-Remy-en-Bouzemont-Saint-Genest-et-Isson); 64 leaves headroom while
 * keeping arbitrarily long input away from the LIKE query.
 */
export const MAX_QUERY_LENGTH = 64;

export class SearchCommunesQueryDto {
  /**
   * Name prefix or exact INSEE code. No digits-only format on purpose:
   * Corsican codes contain letters (2A004).
   */
  @ApiProperty({
    description: 'Commune name prefix or exact INSEE code (e.g. 2A004)',
    example: 'Château',
    minLength: MIN_QUERY_LENGTH,
    maxLength: MAX_QUERY_LENGTH,
  })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(MIN_QUERY_LENGTH)
  @MaxLength(MAX_QUERY_LENGTH)
  q: string;
}
