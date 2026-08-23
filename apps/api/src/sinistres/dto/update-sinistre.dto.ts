import { ApiProperty } from '@nestjs/swagger';
import type { IsoDate } from '@mon-sinistre/contracts';
import { IsNotFutureIsoDateOrNull } from '../is-not-future-iso-date.decorator';

/** `null` declares nothing yet, or un-declares — it clears `declarationDate`
 * and every date it drove (docs/research/sinistre-plan.md, «Контракт API»). */
export class UpdateSinistreDto {
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-06-20',
  })
  @IsNotFutureIsoDateOrNull()
  declarationDate: IsoDate | null;
}
