import { Module } from '@nestjs/common';
import { DilaClient } from './dila/dila.client';
import { JorfMonitorService } from './jorf-monitor.service';

@Module({
  providers: [
    JorfMonitorService,
    { provide: DilaClient, useFactory: () => new DilaClient() },
  ],
})
export class JorfModule {}
