import { Module } from '@nestjs/common';
import { CommuneSearchKeyCheck } from './commune-search-key.check';
import { CommunesController } from './communes.controller';
import { CommunesService } from './communes.service';

@Module({
  controllers: [CommunesController],
  providers: [CommunesService, CommuneSearchKeyCheck],
})
export class CommunesModule {}
