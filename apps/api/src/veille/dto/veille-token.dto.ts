import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Shared by every endpoint that reads a single token — confirmation's GET
 * (query) and POST (body), and desinscription's POST (body): Nest validates a
 * class the same way regardless of which decorator reads it, and the
 * confirm/unsubscribe tokens differ only in which hash column the service
 * looks them up against.
 */
export class VeilleTokenDto {
  @ApiProperty({ description: 'Token carried by the veille link' })
  @IsString()
  token: string;
}
