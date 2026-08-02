import { Controller, Get, Query } from '@nestjs/common';
import { Commune } from '@mon-sinistre/contracts';
import { CommunesService } from './communes.service';
import { SearchCommunesQueryDto } from './dto/search-communes-query.dto';

/** Public commune search — no authentication: it powers the veille signup. */
@Controller('communes')
export class CommunesController {
  constructor(private readonly communes: CommunesService) {}

  @Get()
  search(@Query() query: SearchCommunesQueryDto): Promise<Commune[]> {
    return this.communes.search(query.q);
  }
}
