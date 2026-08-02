import { Module } from '@nestjs/common';
import { CommunesController } from './communes.controller';
import { CommunesService } from './communes.service';

@Module({
  controllers: [CommunesController],
  providers: [CommunesService],
})
export class CommunesModule {}
