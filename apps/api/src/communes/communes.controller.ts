import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Commune } from '@mon-sinistre/contracts';
import { CommunesService } from './communes.service';
import { CommuneResponseDto } from './dto/commune-response.dto';
import { SearchCommunesQueryDto } from './dto/search-communes-query.dto';

/** Public commune search — no authentication: it powers the veille signup. */
@ApiTags('communes')
@Controller('communes')
export class CommunesController {
  constructor(private readonly communes: CommunesService) {}

  @Get()
  @ApiOperation({
    summary: 'Search communes by name prefix or exact INSEE code',
    description:
      'Public endpoint. Matches active communes only; the result is capped ' +
      'at COMMUNE_SEARCH_LIMIT entries sorted by name.',
  })
  @ApiOkResponse({ type: [CommuneResponseDto] })
  @ApiBadRequestResponse({
    description: 'q is missing, shorter than 2 or longer than 64 characters',
  })
  search(@Query() query: SearchCommunesQueryDto): Promise<Commune[]> {
    return this.communes.search(query.q);
  }
}
