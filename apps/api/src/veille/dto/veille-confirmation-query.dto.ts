import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class VeilleConfirmationQueryDto {
  @ApiProperty({ description: 'Token carried by the confirmation link' })
  @IsString()
  token: string;
}
