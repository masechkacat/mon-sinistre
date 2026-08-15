import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Shared by the GET (query) and POST (body) confirmation endpoints — Nest
 * validates a class the same way regardless of which decorator reads it.
 */
export class VeilleConfirmationTokenDto {
  @ApiProperty({ description: 'Token carried by the confirmation link' })
  @IsString()
  token: string;
}
