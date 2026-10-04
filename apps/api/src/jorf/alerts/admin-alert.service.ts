import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errorSummary, stackOf } from 'src/common/error-report';
import type { EnvironmentVariables } from 'src/config/env.validation';
import type { Prisma } from 'src/generated/prisma/client';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
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
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** One alert and its email in a single call: a row committed without the
   * message is an alert nobody will see. Rows raised in bulk inside one
   * transaction take {@link notifyAdmin} directly instead. */
  async raise(alert: Prisma.MonitorAlertUncheckedCreateInput): Promise<void> {
    await this.notifyAdmin([
      await this.prisma.monitorAlert.create({ data: alert }),
    ]);
  }

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
