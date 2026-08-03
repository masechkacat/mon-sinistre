import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';

import { FileMailTransport } from 'src/mail/file-mail.transport';
import { MailComposer } from 'src/mail/mail-composer';
import { captureLogs } from 'src/mail/mail-log.test-helper';
import { MailCompositionError } from 'src/mail/mail-composition.error';
import { MailDeliveryError } from 'src/mail/mail-delivery.error';
import type { ComposeMailInput, MailMessage } from 'src/mail/mail-message';
import { MAIL_TRANSPORT, type MailTransport } from 'src/mail/mail-transport';
import { MailModule } from 'src/mail/mail.module';
import { MailService } from 'src/mail/mail.service';
import {
  SCALEWAY_TEM_URL,
  ScalewayMailTransport,
} from 'src/mail/scaleway-mail.transport';

const RECIPIENT = 'destinataire@example.test';
const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';
const SECRET_KEY = 'scw-secret-key';
const PROJECT_ID = '11111111-2222-3333-4444-555555555555';

// A stub rather than the real configuration: the test must not depend on
// whatever FRONTEND_URL the developer has exported, and choosing a transport
// must be observable without setting process.env (docs/plan/emails.md).
const VALUES: Record<string, string> = { FRONTEND_URL, MAIL_FROM };

const configWith = (values: Record<string, string> = {}): ConfigService => {
  const all: Record<string, string> = { ...VALUES, ...values };
  return {
    get: (key: string): string | undefined => all[key],
    // Same failure as the real ConfigService: the name of the missing key and
    // nothing of its value, which is a secret for two of the three keys read.
    getOrThrow: (key: string): string => {
      const value = all[key];
      if (value === undefined) {
        throw new Error(`Configuration key "${key}" does not exist`);
      }
      return value;
    },
  } as unknown as ConfigService;
};

const configStub = configWith();

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

const logs = captureLogs();

const loggedText = (): string => logs.text();
const loggedLevels = (): string[] => logs.levels();
const expectNoRecipientLogged = (): void => {
  logs.expectNoTraceOf(RECIPIENT);
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
    options: {
      values?: Record<string, string>;
      transport?: MailTransport;
    } = {},
  ): Promise<TestingModule> => {
    const withConfig = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MailModule,
        FeatureModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(configWith(options.values));

    return options.transport
      ? withConfig
          .overrideProvider(MAIL_TRANSPORT)
          .useValue(options.transport)
          .compile()
      : withConfig.compile();
  };

  /**
   * Installed before the module is built on purpose: the provider transport
   * takes globalThis.fetch as the default value of a constructor parameter, so
   * a spy set up after the factory ran would watch a function nobody calls.
   *
   * Undone by restoreMocks of the jest configuration, not by an afterEach of
   * this file: a spy on a global that outlives its test is a failure reported
   * in some other suite, and the guarantee must not depend on which helper this
   * file happens to import.
   */
  const watchNetwork = (): jest.SpiedFunction<typeof globalThis.fetch> =>
    jest.spyOn(globalThis, 'fetch');

  /** A temporary outbox, removed even when the assertions of a test fail. */
  const withOutboxDir = async (
    body: (dir: string) => Promise<void>,
  ): Promise<void> => {
    const dir = await mkdtemp(join(tmpdir(), 'mail-outbox-'));
    try {
      await body(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  /**
   * The module of a test, closed even when its assertions fail — the same
   * reason withOutboxDir exists: a failing test is the one that leaves a Nest
   * application, and its shutdown hooks, behind for the rest of the run.
   */
  const withModule = async (
    options: Parameters<typeof moduleWith>[0],
    body: (moduleRef: TestingModule) => Promise<void>,
  ): Promise<void> => {
    const moduleRef = await moduleWith(options);
    try {
      await body(moduleRef);
    } finally {
      await moduleRef.close();
    }
  };

  it('gives the single sending point to a feature that does not import it', async () => {
    await withModule({ transport: new RecordingTransport() }, (moduleRef) => {
      expect(moduleRef.get(FeatureNeedingMail).mail).toBeInstanceOf(
        MailService,
      );
      return Promise.resolve();
    });
  });

  it('lets a caller substitute the transport through the token, without touching the environment', async () => {
    const transport = new RecordingTransport();

    await withModule({ transport }, async (moduleRef) => {
      await moduleRef.get(MailService).send(input());

      expect(transport.sent).toHaveLength(1);
    });
  });

  it('keeps mail local by default, without a key and without an account', async () => {
    // Neither MAIL_TRANSPORT nor a credential in the configuration: what a
    // developer gets on a fresh checkout is the local outbox, and the provider
    // is not built — building it would have asked for keys that are not there.
    await withModule({}, (moduleRef) => {
      expect(moduleRef.get(MAIL_TRANSPORT)).toBeInstanceOf(FileMailTransport);
      return Promise.resolve();
    });
  });

  it('writes a message to the configured outbox in local mode, and calls no provider', async () => {
    await withOutboxDir(async (dir) => {
      const fetchSpy = watchNetwork();

      await withModule(
        { values: { MAIL_TRANSPORT: 'file', MAIL_OUTBOX_DIR: dir } },
        async (moduleRef) => {
          await moduleRef.get(MailService).send(input());

          // The pair of files lands where the configuration says, and nothing
          // leaves the machine — the guarantee of local development, held by
          // the factory rather than by a branch inside MailService.
          expect((await readdir(dir)).sort().map(extensionOf)).toEqual([
            '.html',
            '.txt',
          ]);
          expect(fetchSpy).not.toHaveBeenCalled();
          // The only path where a real transport logs through the real service:
          // whatever the local mode writes to disk, the address stays out of
          // the log of the application (apps/api/CLAUDE.md, "Правила проекта").
          expectNoRecipientLogged();
        },
      );
    });
  });

  it('sends through the provider when the configuration selects it', async () => {
    const fetchSpy = watchNetwork().mockResolvedValue(
      new Response(JSON.stringify({ emails: [{ id: 'abc' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await withModule(
      {
        values: {
          MAIL_TRANSPORT: 'scaleway',
          SCW_SECRET_KEY: SECRET_KEY,
          SCW_PROJECT_ID: PROJECT_ID,
        },
      },
      async (moduleRef) => {
        expect(moduleRef.get(MAIL_TRANSPORT)).toBeInstanceOf(
          ScalewayMailTransport,
        );
        await moduleRef.get(MailService).send(input());

        // Not only the class: the credentials of the configuration are what the
        // transport was built with, and a factory handing it empty ones would
        // send unauthenticated requests that fail only against the live service.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0] ?? [];
        expect(url).toBe(SCALEWAY_TEM_URL);
        expect((init?.headers as Record<string, string>)['X-Auth-Token']).toBe(
          SECRET_KEY,
        );
        expect(typeof init?.body).toBe('string');
        expect(init?.body as string).toContain(PROJECT_ID);
      },
    );
  });

  it('refuses to start when the provider is selected and its credentials are missing', async () => {
    // The schema of the environment already requires them, but the factory is
    // the last place that can tell: a transport built with an empty key starts
    // an application that looks healthy and delivers nothing.
    await expect(
      moduleWith({ values: { MAIL_TRANSPORT: 'scaleway' } }),
    ).rejects.toThrow('SCW_SECRET_KEY');
  });
});

const extensionOf = (file: string): string => file.slice(file.lastIndexOf('.'));
