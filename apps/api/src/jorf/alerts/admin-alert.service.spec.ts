import { AdminAlertService } from 'src/jorf/alerts/admin-alert.service';
import type { MonitorAlertForMail } from 'src/jorf/mail/monitor-alert-mail';
import { MailComposer } from 'src/mail/compose/mail-composer';
import { composerOptionsFrom } from 'src/mail/mail.module';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ADMIN_EMAIL } from 'test/helpers/admin-email';
import { configFor } from 'test/helpers/config';
import { captureLogs } from 'test/helpers/mail-log';
import { RecordingTransport } from 'test/helpers/mail-transport';

const ALERTS: readonly MonitorAlertForMail[] = [
  {
    kind: 'UNMATCHED_COMMUNE',
    detail: 'NOR INTJ2600801A: Commune Fictive (Département Fictif)',
  },
];

const logs = captureLogs();

describe('AdminAlertService', () => {
  let transport: RecordingTransport;
  let create: jest.Mock;

  beforeEach(() => {
    transport = new RecordingTransport();
    create = jest.fn().mockResolvedValue(ALERTS[0]);
  });

  const serviceWith = (adminEmail: string | undefined): AdminAlertService => {
    const config = configFor({ ADMIN_EMAIL: adminEmail });
    return new AdminAlertService(
      { monitorAlert: { create } } as unknown as PrismaService,
      new MailService(new MailComposer(composerOptionsFrom(config)), transport),
      config,
    );
  };

  it('stays silent on a clone with no ADMIN_EMAIL configured', async () => {
    await serviceWith(undefined).notifyAdmin(ALERTS);

    expect(transport.sent).toHaveLength(0);
    expect(logs.levels()).toEqual([]);
  });

  it('stays silent when there is nothing to report', async () => {
    await serviceWith(ADMIN_EMAIL).notifyAdmin([]);

    expect(transport.sent).toHaveLength(0);
  });

  it('commits a single alert and mails it in one call', async () => {
    await serviceWith(ADMIN_EMAIL).raise({
      kind: 'NOTIFICATION_STUCK',
      detail: 'rappels: utilisateur 42 не отправлено после 4 попыток',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(transport.sent).toHaveLength(1);
  });

  it('logs a failed send instead of letting it reach the caller', async () => {
    transport.failNext = true;

    await expect(
      serviceWith(ADMIN_EMAIL).notifyAdmin(ALERTS),
    ).resolves.toBeUndefined();

    // The service's own line, not the one `MailService` writes about the
    // undelivered message: both land in the log, and only this one proves the
    // catch ran.
    expect(logs.text()).toContain('alert email to admin failed');
    logs.expectNoTraceOf(ADMIN_EMAIL);
  });
});
