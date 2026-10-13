import { Module } from '@nestjs/common';
import { AdminAlertService } from './alerts/admin-alert.service.js';
import { DilaClient } from './dila/dila.client.js';
import { JorfMonitorService } from './jorf-monitor.service.js';

@Module({
  providers: [
    JorfMonitorService,
    AdminAlertService,
    { provide: DilaClient, useFactory: () => new DilaClient() },
  ],
  exports: [AdminAlertService],
})
export class JorfModule {}
