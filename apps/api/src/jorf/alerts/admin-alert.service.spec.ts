import { AdminAlertService } from 'src/jorf/alerts/admin-alert.service';
import type { MonitorAlertForMail } from 'src/jorf/mail/monitor-alert-mail';
import { MailComposer } from 'src/mail/compose/mail-composer';
import { composerOptionsFrom } from 'src/mail/mail.module';
import { MailService } from 'src/mail/mail.service';
import { configFor } from 'test/helpers/config';
import { captureLogs } from 'test/helpers/mail-log';
import { RecordingTransport } from 'test/helpers/mail-transport';

// Deliberately not `admin@…`: `expectNoTraceOf` also looks for the local part
// alone, and "admin" occurs in this file's own path and in the log line below.
const ADMIN_EMAIL = 'supervision@mon-sinistre.test';

const ALERTS: readonly MonitorAlertForMail[] = [
  {
    kind: 'UNMATCHED_COMMUNE',
    detail: 'NOR INTJ2600801A: Commune Fictive (Département Fictif)',
  },
];

const logs = captureLogs();

describe('AdminAlertService', () => {
  let transport: RecordingTransport;

  beforeEach(() => {
    transport = new RecordingTransport();
  });

  const serviceWith = (adminEmail: string | undefined): AdminAlertService => {
    const config = configFor({ ADMIN_EMAIL: adminEmail });
    return new AdminAlertService(
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
