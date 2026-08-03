import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Scheme and host, nothing after them. The mail skeleton joins paths onto this
 * value with the URL parser, which drops any path prefix of the base: a
 * FRONTEND_URL of "https://example.fr/app" would silently produce links to
 * https://example.fr/… — right host, wrong site, and nothing to notice it by
 * until a reader clicks. Refusing it at bootstrap is the only place the
 * mistake is visible.
 */
const ORIGIN_ONLY = /^https?:\/\/[^/?#]+\/?$/;

/**
 * Schema for every variable in .env.example. Validation runs once at
 * bootstrap (ConfigModule `validate`), so a missing or malformed value stops
 * the application immediately instead of failing on first use.
 *
 * SMTP variables stay optional until the mail module lands — tighten them
 * when it does; MAIL_FROM is already required, the mail skeleton composes no
 * message without it. New environment variables must be added here and to
 * .env.example in the same commit.
 */
class EnvironmentVariables {
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

  // SMTP variables are left over from the skeleton and unused; the transport
  // variables of the provider arrive in phase 2 of the emails feature, which
  // removes these.
  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT?: number;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;
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
