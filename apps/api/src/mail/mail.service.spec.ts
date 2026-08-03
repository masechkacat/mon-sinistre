import { Injectable, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import { FileMailTransport } from 'src/mail/file-mail.transport';
import { MailComposer } from 'src/mail/mail-composer';
import { MailCompositionError } from 'src/mail/mail-composition.error';
import { MailDeliveryError } from 'src/mail/mail-delivery.error';
import type { ComposeMailInput, MailMessage } from 'src/mail/mail-message';
import { MAIL_TRANSPORT, type MailTransport } from 'src/mail/mail-transport';
import { MailModule } from 'src/mail/mail.module';
import { MailService } from 'src/mail/mail.service';

const RECIPIENT = 'destinataire@example.test';
const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';

// A stub rather than the real configuration: the test must not depend on
// whatever FRONTEND_URL the developer has exported.
const VALUES: Record<string, string> = { FRONTEND_URL, MAIL_FROM };
const configStub = {
  get: (key: string): string | undefined => VALUES[key],
} as unknown as ConfigService;

const input = (
  overrides: Partial<ComposeMailInput> = {},
): ComposeMailInput => ({
  to: RECIPIENT,
  subject: 'Votre commune est concernée',
  reason: 'vous suivez la commune de Nîmes',
  unsubscribePath: '/desabonnement/jeton-123',
  blocks: [{ kind: 'paragraph', text: 'Un texte de test suffisamment long.' }],
  ...overrides,
});

class RecordingTransport implements MailTransport {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

const TRANSPORT_FAILURE = 'transport responded 500';
const TRANSPORT_CAUSE = 'connection reset by peer';

class FailingTransport implements MailTransport {
  // A transport that honours the contract: a status and a reason, never the
  // address nor the body. The real reason of phase 2 lives in the cause — a
  // stack does not carry it, and the log must (docs/research/emails.md).
  send(): Promise<void> {
    return Promise.reject(
      new MailDeliveryError(TRANSPORT_FAILURE, {
        cause: new Error(TRANSPORT_CAUSE),
      }),
    );
  }
}

class LeakingTransport implements MailTransport {
  // A transport that breaks the contract twice over: it throws a plain Error,
  // and it puts the recipient address in it. Neither may reach the caller as
  // an unknown type nor the address the logs.
  send(message: MailMessage): Promise<void> {
    return Promise.reject(new Error(`ENOENT: ${message.to}.eml`));
  }
}

class ShoutingTransport implements MailTransport {
  // The same leak, in the case a provider answers about the address in a
  // casing of its own: the domain is case-insensitive by RFC 5321, so this is
  // the same person as the address that was handed over.
  send(message: MailMessage): Promise<void> {
    return Promise.reject(
      new Error(`550 unknown mailbox ${message.to.toUpperCase()}`),
    );
  }
}

const serviceWith = (transport: MailTransport): MailService =>
  new MailService(new MailComposer(configStub), transport);

const LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;

type LogEntry = {
  readonly level: (typeof LEVELS)[number];
  readonly text: string;
};

let written: LogEntry[];

// Installed for every test, not only for those that read it: the Logger of
// this service is loud on the failure paths, and a test run is not the place
// to print those stacks.
beforeEach(() => {
  written = [];
  for (const level of LEVELS) {
    jest
      .spyOn(Logger.prototype, level)
      .mockImplementation((...args: unknown[]) => {
        written.push({ level, text: serialize(args) });
      });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

/**
 * Every argument of a Logger call, serialized. Checking the first one is not
 * enough: an address leaks just as easily through the context parameter or from
 * inside a thrown error (docs/research/emails.md).
 */
const serialize = (args: unknown[]): string =>
  JSON.stringify(args, (_key, value: unknown) =>
    value instanceof Error
      ? {
          name: value.name,
          message: value.message,
          stack: value.stack,
          cause: value.cause,
        }
      : value,
  );

const loggedText = (): string => written.map((entry) => entry.text).join('\n');
const loggedLevels = (): string[] => written.map((entry) => entry.level);

/**
 * The address and its local part alike: a log that kept "destinataire" of
 * "destinataire@example.test" would still name the person. Compared in one
 * casing, because an address in another one names them just as well.
 */
const expectNoRecipientLogged = (): void => {
  expect(loggedText().toLowerCase()).not.toContain(RECIPIENT);
  expect(loggedText().toLowerCase()).not.toContain('destinataire');
};

describe('MailService', () => {
  it('hands the composed message to the transport', async () => {
    const transport = new RecordingTransport();

    await serviceWith(transport).send(input());

    expect(transport.sent).toHaveLength(1);
    const [message] = transport.sent;
    expect(message?.to).toBe(RECIPIENT);
    expect(message?.subject).toBe('Votre commune est concernée');
    expect(message?.text).not.toBe('');
    expect(message?.html).not.toBe('');
  });

  it('keeps the recipient address out of the logs of a successful send', async () => {
    await serviceWith(new RecordingTransport()).send(input());

    // The send is logged at all, and at the level of an ordinary event —
    // otherwise this assertion would pass on an empty log for the wrong reason.
    expect(loggedLevels()).toEqual(['log']);
    expectNoRecipientLogged();
  });

  it('reports a message it cannot compose as a failure, and sends nothing', async () => {
    const transport = new RecordingTransport();

    // A message without the link that stops the emails: the skeleton refuses
    // it, and the caller must learn that nothing left.
    await expect(
      serviceWith(transport).send(input({ unsubscribePath: '' })),
    ).rejects.toThrow(MailCompositionError);
    expect(transport.sent).toHaveLength(0);
  });

  it('keeps the recipient address out of the logs when composition fails', async () => {
    await expect(
      serviceWith(new RecordingTransport()).send(
        input({ unsubscribePath: '' }),
      ),
    ).rejects.toThrow(MailCompositionError);

    expect(loggedLevels()).toEqual(['error']);
    expectNoRecipientLogged();
  });

  it('reports a transport failure to the caller instead of returning quietly', async () => {
    // There is no "sent: false" to ignore: success and failure differ by the
    // promise, so a silent success cannot happen.
    await expect(
      serviceWith(new FailingTransport()).send(input()),
    ).rejects.toThrow(MailDeliveryError);
  });

  it('logs a transport failure with its reason and its cause, at the error level', async () => {
    await expect(
      serviceWith(new FailingTransport()).send(input()),
    ).rejects.toThrow(MailDeliveryError);

    expect(loggedLevels()).toEqual(['error']);
    expect(loggedText()).toContain(TRANSPORT_FAILURE);
    // Without the chain the log would say "the transport failed" and never
    // whether it was a timeout, a refused connection or a bad answer.
    expect(loggedText()).toContain(TRANSPORT_CAUSE);
    expectNoRecipientLogged();
  });

  it('reports a transport that breaks the contract as a delivery failure all the same', async () => {
    // A plain Error from a transport must not reach the caller as an unknown
    // type: features are promised MailDeliveryError, and a caller branching on
    // it would silently take the wrong path.
    await expect(
      serviceWith(new LeakingTransport()).send(input()),
    ).rejects.toThrow(MailDeliveryError);
  });

  it('strips the recipient address from a transport failure that carries it', async () => {
    await expect(
      serviceWith(new LeakingTransport()).send(input()),
    ).rejects.toThrow(MailDeliveryError);

    // The guarantee cannot rest on every transport getting it right: this
    // service is the only place able to enforce it, and it knows the address.
    expect(loggedLevels()).toEqual(['error']);
    expect(loggedText()).toContain('ENOENT');
    expectNoRecipientLogged();
  });

  it('strips the recipient address whatever casing it comes back in', async () => {
    await expect(
      serviceWith(new ShoutingTransport()).send(input()),
    ).rejects.toThrow(MailDeliveryError);

    // An exact match would have let "DESTINATAIRE@EXAMPLE.TEST" through, and
    // the domain of an address is case-insensitive by RFC 5321: whichever
    // casing a provider answers in, it is the same person.
    expect(loggedText()).toContain('550 unknown mailbox');
    expectNoRecipientLogged();
  });
});

/**
 * A feature as they will be written: it injects MailService without importing
 * MailModule. Its module compiles only while MailModule is global and exports
 * the service — which is what makes this the test of both.
 */
@Injectable()
class FeatureNeedingMail {
  constructor(readonly mail: MailService) {}
}

@Module({ providers: [FeatureNeedingMail] })
class FeatureModule {}

describe('MailModule', () => {
  const moduleWith = async (
    transport?: MailTransport,
  ): Promise<TestingModule> => {
    const builder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MailModule,
        FeatureModule,
      ],
    }).overrideProvider(ConfigService);
    const withConfig = builder.useValue(configStub);

    return transport
      ? withConfig
          .overrideProvider(MAIL_TRANSPORT)
          .useValue(transport)
          .compile()
      : withConfig.compile();
  };

  it('gives the single sending point to a feature that does not import it', async () => {
    const moduleRef = await moduleWith(new RecordingTransport());

    expect(moduleRef.get(FeatureNeedingMail).mail).toBeInstanceOf(MailService);
    await moduleRef.close();
  });

  it('lets a caller substitute the transport through the token, without touching the environment', async () => {
    const transport = new RecordingTransport();
    const moduleRef = await moduleWith(transport);

    await moduleRef.get(MailService).send(input());

    expect(transport.sent).toHaveLength(1);
    await moduleRef.close();
  });

  it('keeps mail local by default, without a key and without an account', async () => {
    // No transport substituted: what a developer gets on a fresh checkout is
    // the local outbox, not a message on its way to a real address. The class
    // stands in for the behaviour here because the factory takes no arguments
    // yet; once it reads MAIL_OUTBOX_DIR in phase 2, this becomes an assertion
    // on what a send actually writes (docs/plan/emails.md).
    const moduleRef = await moduleWith();

    expect(moduleRef.get(MAIL_TRANSPORT)).toBeInstanceOf(FileMailTransport);
    await moduleRef.close();
  });
});
