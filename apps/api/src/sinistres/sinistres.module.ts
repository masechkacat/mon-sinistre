import { Module } from '@nestjs/common';
import { SinistresController } from './sinistres.controller.js';
import { SinistresService } from './sinistres.service.js';

@Module({
  controllers: [SinistresController],
  providers: [SinistresService],
  exports: [SinistresService],
})
export class SinistresModule {}
