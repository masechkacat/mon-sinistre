import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errorSummary, stackOf } from 'src/common/error-report';
import type { EnvironmentVariables } from 'src/config/env.validation';
import { MailService } from 'src/mail/mail.service';
import {
  type MonitorAlertForMail,
  monitorAlertMailFor,
} from '../mail/monitor-alert-mail';

/**
 * The push channel on top of `MonitorAlert` (docs/research/jorf-monitor.md,
 * "Алерты администратору: таблица + email"), shared by every producer of those
 * rows: the monitor's ingest and the reminders run.
 */
@Injectable()
export class AdminAlertService {
  private readonly logger = new Logger(AdminAlertService.name);

  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** Swallows its own failure, as the research above prescribes: every row is
   * already committed by the caller, so a send that fails costs the
   * notification and never the record. */
  async notifyAdmin(alerts: readonly MonitorAlertForMail[]): Promise<void> {
    const adminEmail = this.config.get('ADMIN_EMAIL', { infer: true });
    if (!adminEmail || alerts.length === 0) {
      return;
    }
    try {
      await this.mail.send(monitorAlertMailFor(adminEmail, alerts));
    } catch (error) {
      this.logger.error(
        `alert email to admin failed: ${errorSummary(error)}`,
        stackOf(error),
      );
    }
  }
}
