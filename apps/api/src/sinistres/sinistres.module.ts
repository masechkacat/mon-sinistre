import { Module } from '@nestjs/common';
import { SinistresController } from './sinistres.controller';
import { SinistresService } from './sinistres.service';

@Module({
  controllers: [SinistresController],
  providers: [SinistresService],
})
export class SinistresModule {}
