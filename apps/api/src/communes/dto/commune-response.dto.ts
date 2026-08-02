import { ApiProperty } from '@nestjs/swagger';
import { Commune } from '@mon-sinistre/contracts';

/**
 * Swagger-only mirror of the {@link Commune} contract: the service keeps
 * returning plain contract objects, this class exists so /docs can render the
 * response schema. `implements Commune` makes the compiler fail here whenever
 * the contract gains or renames a field.
 */
export class CommuneResponseDto implements Commune {
  @ApiProperty({
    description: 'INSEE code (not the postal code)',
    example: '02168',
  })
  codeInsee: string;

  @ApiProperty({ example: 'Château-Thierry' })
  name: string;

  @ApiProperty({ description: 'INSEE department code', example: '02' })
  departementCode: string;

  @ApiProperty({ example: 'Aisne' })
  departementName: string;
}
