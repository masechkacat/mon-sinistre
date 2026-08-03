import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsFQDN,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  Min,
  MinLength,
  registerDecorator,
  ValidateIf,
  validateSync,
  type ValidationArguments,
} from 'class-validator';

import {
  MAIL_TRANSPORT_NAMES,
  SENDING_TRANSPORT,
  type MailTransportName,
} from 'src/mail/mail-transport-name';

/**
 * Scheme and host, nothing after them. The mail skeleton joins paths onto this
 * value with the URL parser, which drops any path prefix of the base: a
 * FRONTEND_URL of "https://example.fr/app" would silently produce links to
 * https://example.fr/… — right host, wrong site, and nothing to notice it by
 * until a reader clicks. Refusing it at bootstrap is the only place the
 * mistake is visible.
 */
const ORIGIN_ONLY = /^https?:\/\/[^/?#]+\/?$/;

const NODE_ENV_NAMES = ['development', 'test', 'production'] as const;

const sendsForReal = (env: EnvironmentVariables): boolean =>
  env.MAIL_TRANSPORT === SENDING_TRANSPORT;

/**
 * Refuses a production start that would write emails to the local outbox
 * instead of sending them. The application would come up perfectly healthy and
 * every notification would land in a file: nobody is told an arrêté was
 * published, and the reader finds out by missing the 30-day deadline. The
 * transport left unset counts as local, because that is what the factory makes
 * of it.
 */
function SendsForRealInProduction() {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'sendsForRealInProduction',
      target: object.constructor,
      propertyName,
      validator: {
        validate: (value: unknown, args: ValidationArguments): boolean =>
          value !== 'production' ||
          sendsForReal(args.object as EnvironmentVariables),
        defaultMessage: () =>
          `MAIL_TRANSPORT must be "${SENDING_TRANSPORT}" when NODE_ENV is production: the local transport writes messages to files and sends nothing`,
      },
    });
  };
}

/**
 * Schema for every variable in .env.example. Validation runs once at
 * bootstrap (ConfigModule `validate`), so a missing or malformed value stops
 * the application immediately instead of failing on first use.
 *
 * New environment variables must be added here and to .env.example in the same
 * commit.
 */
class EnvironmentVariables {
  // --- окружение ---
  /**
   * Set by whatever starts the process, not by .env as a rule — it is declared
   * here because the mail guard below turns on it, and a typo such as "prod"
   * would switch that guard off without a word.
   */
  @IsOptional()
  @IsIn(NODE_ENV_NAMES)
  @SendsForRealInProduction()
  NODE_ENV?: (typeof NODE_ENV_NAMES)[number];

  // --- база данных ---
  @IsNotEmpty()
  @IsString()
  DB_HOST: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT: number;

  @IsNotEmpty()
  @IsString()
  DB_USER: string;

  @IsNotEmpty()
  @IsString()
  DB_PASSWORD: string;

  @IsNotEmpty()
  @IsString()
  DB_NAME: string;

  // --- приложение ---
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT?: number;

  @IsOptional()
  @IsString()
  HOST?: string;

  /**
   * Required, and an absolute address: the mail skeleton builds every link of
   * every email from it, including the unsubscribe link each message must
   * carry. require_tld is off on purpose — http://localhost:3000 of
   * .env.example would otherwise fail and break local development.
   */
  @IsNotEmpty()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  @Matches(ORIGIN_ONLY, {
    message:
      'FRONTEND_URL must carry a scheme and a host only, with no path prefix',
  })
  FRONTEND_URL: string;

  // --- секреты ---
  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET: string;

  @IsString()
  @MinLength(32)
  COOKIE_SECRET: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(31)
  SALT_ROUNDS?: number;

  @IsOptional()
  @IsString()
  ACCESS_TOKEN_EXPIRY?: string;

  @IsOptional()
  @IsString()
  REFRESH_TOKEN_EXPIRY?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  HTTPS_ENABLED?: boolean;

  // --- почта ---
  /**
   * Required: the mail skeleton refuses to compose a message without a sender
   * address, and the refusal would otherwise surface at the first send — in a
   * nightly job, with nobody watching.
   */
  @IsNotEmpty()
  @IsEmail()
  MAIL_FROM: string;

  /**
   * Which transport sends. Unset means the local one: a fresh clone runs, and
   * develops against, an API that needs no provider account — production is
   * held to the opposite by the guard on NODE_ENV above.
   */
  @IsOptional()
  @IsIn(MAIL_TRANSPORT_NAMES)
  MAIL_TRANSPORT?: MailTransportName;

  /**
   * Where the local transport writes; unset means .mail-outbox. Empty is not
   * unset: it would resolve to the working directory, and the files carry real
   * addresses in their To: header while only .mail-outbox is in .gitignore.
   */
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  MAIL_OUTBOX_DIR?: string;

  /**
   * The domain verified at the provider (SPF, DKIM, DMARC). Phase 3 checks
   * MAIL_FROM against it at bootstrap — a typo in the sender address otherwise
   * surfaces as mail silently refused by the provider. A domain, not a URL:
   * that is what phase 3 compares the part after the @ with.
   */
  @ValidateIf(sendsForReal)
  @IsNotEmpty()
  @IsFQDN()
  MAIL_SENDER_DOMAIN?: string;

  /**
   * Credentials of the provider, required only when it is the transport: they
   * are what a local clone must not need. Missing here stops the application at
   * bootstrap rather than at the first send — which happens in a nightly job,
   * with nobody watching.
   */
  @ValidateIf(sendsForReal)
  @IsNotEmpty()
  @IsString()
  SCW_SECRET_KEY?: string;

  /** A UUID at Scaleway; checked as one so the two values above cannot be swapped. */
  @ValidateIf(sendsForReal)
  @IsNotEmpty()
  @IsUUID()
  SCW_PROJECT_ID?: string;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config);
  const errors = validateSync(validated, { whitelist: false });

  if (errors.length > 0) {
    // Only property names and constraint messages: values may be secrets.
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join('; '))
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${details}`);
  }

  return validated;
}
