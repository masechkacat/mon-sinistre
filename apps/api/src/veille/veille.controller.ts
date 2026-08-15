import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CreateVeilleDto } from './dto/create-veille.dto';
import { VeilleService } from './veille.service';

/**
 * Tighter than the global 100/min because every accepted request mails a
 * third-party address: this is the only limit that bounds mailing to *many*
 * addresses at once (the per-address limit of the PRD, phase 3, counts one
 * address at a time and would let 100 victims through). A human fills the form
 * once. Exported for the integration test, which must not restate the number.
 */
export const VEILLE_FORM_RATE_LIMIT = { ttl: 60_000, limit: 5 } as const;

/** Public — no authentication: anyone with an email may subscribe. */
@ApiTags('veille')
@Controller('veille')
export class VeilleController {
  constructor(private readonly veille: VeilleService) {}

  @Throttle({ default: VEILLE_FORM_RATE_LIMIT })
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Subscribe to notifications for the chosen communes',
    description:
      'Body validation (email, commune codes) answers 400 in the usual way. ' +
      'Once validated, the response is 204 whatever the address turns out to ' +
      'be — anti-enumeration, docs/research/veille-subscription-lifecycle.md.',
  })
  @ApiNoContentResponse()
  async subscribe(@Body() dto: CreateVeilleDto): Promise<void> {
    await this.veille.subscribe(dto);
  }
}
