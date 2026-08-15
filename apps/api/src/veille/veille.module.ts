import { Module } from '@nestjs/common';
import { VeilleController } from './veille.controller';
import { VeilleService } from './veille.service';

@Module({
  controllers: [VeilleController],
  providers: [VeilleService],
})
export class VeilleModule {}
