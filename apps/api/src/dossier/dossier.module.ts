import { Module } from '@nestjs/common';
import { DossierController } from './dossier.controller';
import { DossierService } from './dossier.service';

@Module({
  controllers: [DossierController],
  providers: [DossierService],
})
export class DossierModule {}
