import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { VeilleConfirmationResponse } from '@mon-sinistre/contracts';
import { CreateVeilleDto } from './dto/create-veille.dto';
import { VeilleConfirmationQueryDto } from './dto/veille-confirmation-query.dto';
import { VeilleConfirmationResponseDto } from './dto/veille-confirmation-response.dto';
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

  @Get('confirmation')
  @ApiOperation({
    summary: 'Read the status of a confirmation link',
    description:
      'Read-only: visiting this link (e.g. a mail client preview) never ' +
      'confirms the subscription. An unknown token answers the same ' +
      '"invalid" as an expired one — the cause is not told apart.',
  })
  @ApiOkResponse({ type: VeilleConfirmationResponseDto })
  async getConfirmationStatus(
    @Query() query: VeilleConfirmationQueryDto,
  ): Promise<VeilleConfirmationResponse> {
    return { status: await this.veille.getConfirmationStatus(query.token) };
  }
}
