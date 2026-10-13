import { Module } from '@nestjs/common';
import { VeilleController } from './veille.controller.js';
import { VeilleService } from './veille.service.js';

@Module({
  controllers: [VeilleController],
  providers: [VeilleService],
})
export class VeilleModule {}
