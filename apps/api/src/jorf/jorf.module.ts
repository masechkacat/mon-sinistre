import { Module } from '@nestjs/common';
import { AdminAlertService } from './alerts/admin-alert.service';
import { DilaClient } from './dila/dila.client';
import { JorfMonitorService } from './jorf-monitor.service';

@Module({
  providers: [
    JorfMonitorService,
    AdminAlertService,
    { provide: DilaClient, useFactory: () => new DilaClient() },
  ],
  exports: [AdminAlertService],
})
export class JorfModule {}
