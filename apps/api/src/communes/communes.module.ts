import { Module } from '@nestjs/common';
import { CommuneReferentialCheck } from './commune-referential.check';
import { CommunesController } from './communes.controller';
import { CommunesService } from './communes.service';

@Module({
  controllers: [CommunesController],
  providers: [CommunesService, CommuneReferentialCheck],
})
export class CommunesModule {}
