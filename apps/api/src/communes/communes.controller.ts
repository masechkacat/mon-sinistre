import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Commune } from '@mon-sinistre/contracts';
import { CommunesService } from './communes.service';
import { SearchCommunesQueryDto } from './dto/search-communes-query.dto';

@ApiTags('communes')
@Controller('communes')
export class CommunesController {
  constructor(private readonly communesService: CommunesService) {}

  // Public endpoint: no guard by design (subscription and onboarding flows
  // run before any account exists); the global throttler still applies.
  @Get()
  @ApiOperation({ summary: 'Search communes by name prefix or INSEE code' })
  @ApiOkResponse({ description: 'Up to COMMUNE_SEARCH_LIMIT current communes' })
  search(@Query() query: SearchCommunesQueryDto): Promise<Commune[]> {
    return this.communesService.search(query.q);
  }
}
