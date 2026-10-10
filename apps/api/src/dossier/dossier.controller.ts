import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { DossierApercu } from '@mon-sinistre/contracts';
import { Public } from 'src/auth/public.decorator';
import { CreateSinistreDto } from 'src/sinistres/dto/create-sinistre.dto';
import { DossierApercuResponseDto } from './dto/dossier-apercu-response.dto';
import { DossierService } from './dossier.service';

/** Public on the class, as `CommunesController` is: the global `JwtAuthGuard`
 * would otherwise answer 401 without a token. */
@Public()
@ApiTags('dossier')
@Controller('dossier')
export class DossierController {
  constructor(private readonly dossier: DossierService) {}

  @Get('apercu')
  @ApiOperation({
    summary: 'Preview the plan three parameters would get as a sinistre',
    description:
      'Public endpoint. Same dates, statuses and déclaration deadline as ' +
      'POST /sinistres would answer with for the same commune, risque and ' +
      'eventDate — computed and not stored: no sinistre and no step is ' +
      'created. An unknown commune, a future eventDate or a risque outside ' +
      'the enum answers 400, which the page reads as “ask for the missing ' +
      'parameter”, not as a server error.',
  })
  @ApiOkResponse({ type: DossierApercuResponseDto })
  @ApiBadRequestResponse({
    description: 'Unknown commune, future eventDate, or unknown risque',
  })
  apercu(@Query() dto: CreateSinistreDto): Promise<DossierApercu> {
    return this.dossier.apercu(dto);
  }
}
