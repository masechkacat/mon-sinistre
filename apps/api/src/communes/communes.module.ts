import { Module } from '@nestjs/common';
import { CommuneReferentialCheck } from './commune-referential.check.js';
import { CommunesController } from './communes.controller.js';
import { CommunesService } from './communes.service.js';

@Module({
  controllers: [CommunesController],
  providers: [CommunesService, CommuneReferentialCheck],
})
export class CommunesModule {}
