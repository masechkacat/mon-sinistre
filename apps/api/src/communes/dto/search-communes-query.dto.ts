import { Transform } from 'class-transformer';
import { IsString, MinLength } from 'class-validator';

export class SearchCommunesQueryDto {
  /**
   * Name prefix or exact INSEE code. No digits-only format on purpose:
   * Corsican codes contain letters (2A004). Minimum length keeps one-letter
   * scans off the database.
   */
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  q: string;
}
