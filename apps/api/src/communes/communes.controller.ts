import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  COMMUNE_SEARCH_LIMIT,
  COMMUNE_SEARCH_MIN_QUERY_LENGTH,
  Commune,
} from '@mon-sinistre/contracts';
import { Public } from 'src/auth/public.decorator';
import { CommunesService } from './communes.service';
import { CommuneResponseDto } from './dto/commune-response.dto';
import {
  MAX_QUERY_LENGTH,
  SearchCommunesQueryDto,
} from './dto/search-communes-query.dto';

/** Public commune search — no authentication: it powers the veille signup. */
@Public()
@ApiTags('communes')
@Controller('communes')
export class CommunesController {
  constructor(private readonly communes: CommunesService) {}

  @Get()
  @ApiOperation({
    summary: 'Search communes by name prefix or exact INSEE code',
    // Every number here comes from the constant that enforces it: this text is
    // read in /docs by someone who cannot look our source up, so a limit
    // spelled out by hand would eventually describe an API we no longer serve.
    description:
      'Public endpoint. The name match ignores case and diacritics ' +
      '("chateau" finds "Château-Thierry"); the INSEE code must match ' +
      'exactly, case aside. Matches active communes only; the result is ' +
      `capped at ${COMMUNE_SEARCH_LIMIT} entries sorted by name.`,
  })
  @ApiOkResponse({ type: [CommuneResponseDto] })
  @ApiBadRequestResponse({
    description: `q is missing, shorter than ${COMMUNE_SEARCH_MIN_QUERY_LENGTH} or longer than ${MAX_QUERY_LENGTH} characters`,
  })
  search(@Query() query: SearchCommunesQueryDto): Promise<Commune[]> {
    return this.communes.search(query.q);
  }
}
