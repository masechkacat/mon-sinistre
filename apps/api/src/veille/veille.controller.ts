import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateVeilleDto } from './dto/create-veille.dto';
import { VeilleService } from './veille.service';

/** Public — no authentication: anyone with an email may subscribe. */
@ApiTags('veille')
@Controller('veille')
export class VeilleController {
  constructor(private readonly veille: VeilleService) {}

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
