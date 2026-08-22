import { applyDecorators } from '@nestjs/common';
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

import { DEFAULT_MAIL_OUTBOX_DIR } from 'src/mail/file-mail.transport';
import {
  MAIL_TRANSPORT_NAMES,
  SENDING_TRANSPORT,
  type MailTransportName,
} from 'src/mail/mail-transport-name';

/**
 * Scheme and host, nothing after them. The URL parser drops any path prefix of
 * the base, so a FRONTEND_URL of "https://example.fr/app" would silently
 * produce links to https://example.fr/… — right host, wrong site.
 */
const ORIGIN_ONLY = /^https?:\/\/[^/?#]+\/?$/;

const NODE_ENV_NAMES = ['development', 'test', 'production'] as const;

/** The other two spellings of each are meant to be there: the line of
 * .env.example and the port published by docker-compose. */
const DEFAULT_PORT = 3001;
const DEFAULT_HOST = '0.0.0.0';

/** docs/research/user-account.md, «Хеширование пароля». */
const DEFAULT_SALT_ROUNDS = 12;

/** docs/research/user-account.md, «Сессия: access 15 минут … refresh 30 дней». */
const DEFAULT_ACCESS_TOKEN_EXPIRY = '15m';
const DEFAULT_REFRESH_TOKEN_EXPIRY = '30d';

/** 0 means "let the kernel pick one", which a reachable service never wants. */
const MAX_PORT = 65535;
const IsPortNumber = () =>
  applyDecorators(
    Type(() => Number),
    IsInt(),
    Min(1),
    Max(MAX_PORT),
  );

/** `openssl rand -base64 48` clears this twice over: the floor exists for a
 * value typed by hand and for a "changeme" left from the example file. */
const MIN_SECRET_LENGTH = 32;
const IsSecret = () =>
  applyDecorators(IsString(), MinLength(MIN_SECRET_LENGTH));

const sendsForReal = (env: EnvironmentVariables): boolean =>
  env.MAIL_TRANSPORT === SENDING_TRANSPORT;

/**
 * A production writing emails to the local outbox comes up perfectly healthy
 * and tells nobody an arrêté was published. Unset counts as local, because that
 * is what the factory makes of it.
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

const domainOf = (address: string): string =>
  address.slice(address.lastIndexOf('@') + 1).toLowerCase();

/**
 * Insurance against a typo in MAIL_FROM, which otherwise costs nothing at
 * bootstrap and every message afterwards. Exact equality, because that is what
 * the provider verifies: a subdomain is a separate domain to it.
 */
function AtSenderDomain() {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'atSenderDomain',
      target: object.constructor,
      propertyName,
      validator: {
        validate: (value: unknown, args: ValidationArguments): boolean => {
          const domain = (
            args.object as EnvironmentVariables
          ).MAIL_SENDER_DOMAIN?.trim();
          return (
            !domain ||
            (typeof value === 'string' &&
              domainOf(value) === domain.toLowerCase())
          );
        },
        defaultMessage: () =>
          'MAIL_FROM must be an address at MAIL_SENDER_DOMAIN: the provider refuses a sender outside the domain verified with it, and a subdomain is not that domain',
      },
    });
  };
}

/**
 * Schema for every variable in .env.example, validated once at bootstrap. It is
 * also what ConfigService is parameterised with, so reading a variable this
 * class does not declare stops the compiler.
 */
export class EnvironmentVariables {
  // --- окружение ---
  /** Declared here because the mail guard below turns on it: a typo such as
   * "prod" would switch that guard off without a word. */
  @IsOptional()
  @IsIn(NODE_ENV_NAMES)
  @SendsForRealInProduction()
  NODE_ENV?: (typeof NODE_ENV_NAMES)[number];

  // --- база данных ---
  @IsNotEmpty()
  @IsString()
  DB_HOST: string;

  @IsPortNumber()
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
  @IsPortNumber()
  PORT: number = DEFAULT_PORT;

  @IsNotEmpty()
  @IsString()
  HOST: string = DEFAULT_HOST;

  /** require_tld is off on purpose — http://localhost:3000 of .env.example
   * would otherwise fail and break local development. */
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
  @IsSecret()
  JWT_SECRET: string;

  @IsSecret()
  JWT_REFRESH_SECRET: string;

  @IsSecret()
  COOKIE_SECRET: string;

  /** Keys the veille form's per-address email hash (`VeilleFormEmail`) —
   * separate from the other secrets above so rotating one never resets the
   * other's guarantee (JWT rotation must not reset the anti-spam counter). */
  @IsSecret()
  VEILLE_EMAIL_HASH_SECRET: string;

  /** bcrypt cost factor; default lives here so callers never need `?? 12`. */
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(31)
  SALT_ROUNDS: number = DEFAULT_SALT_ROUNDS;

  @IsString()
  ACCESS_TOKEN_EXPIRY: string = DEFAULT_ACCESS_TOKEN_EXPIRY;

  @IsString()
  REFRESH_TOKEN_EXPIRY: string = DEFAULT_REFRESH_TOKEN_EXPIRY;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  HTTPS_ENABLED?: boolean;

  // --- почта ---
  /** The address lives here and only here: changing it is an edit of .env,
   * never of code. */
  @IsNotEmpty()
  @IsEmail()
  @AtSenderDomain()
  MAIL_FROM: string;

  /** Unset means a fresh clone with no admin inbox configured yet: monitor
   * alerts still land in `MonitorAlert` (src/jorf/), the email is a push
   * channel on top of that row, not the record of it. */
  @IsOptional()
  @IsEmail()
  ADMIN_EMAIL?: string;

  /** Unset means the local transport: a fresh clone needs no provider account. */
  @IsOptional()
  @IsIn(MAIL_TRANSPORT_NAMES)
  MAIL_TRANSPORT?: MailTransportName;

  /**
   * The default is applied here rather than in the transport, so the transport
   * is always handed a directory. Empty is not unset: it would resolve to the
   * working directory, and only .mail-outbox is in .gitignore while the files
   * carry real addresses.
   */
  @IsNotEmpty()
  @IsString()
  MAIL_OUTBOX_DIR: string = DEFAULT_MAIL_OUTBOX_DIR;

  /**
   * Required of the sending transport, but checked for shape wherever it is
   * written: AtSenderDomain reads it under every transport, so a URL left here
   * would stop the application complaining about MAIL_FROM, which is right.
   */
  @ValidateIf(
    (env: EnvironmentVariables) =>
      sendsForReal(env) || Boolean(env.MAIL_SENDER_DOMAIN?.trim()),
  )
  @IsNotEmpty()
  @IsFQDN()
  MAIL_SENDER_DOMAIN?: string;

  @ValidateIf(sendsForReal)
  @IsNotEmpty()
  @IsString()
  SCW_SECRET_KEY?: string;

  /** Checked as a UUID so the two values cannot be swapped. */
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
