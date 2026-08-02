import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MinLength } from 'class-validator';

export class SearchCommunesQueryDto {
  @ApiProperty({
    description: 'Name prefix or exact INSEE code',
    minLength: 2,
    example: 'Château',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  // No digits-only format: Corsican INSEE codes contain letters (2A004).
  @MinLength(2)
  q!: string;
}
