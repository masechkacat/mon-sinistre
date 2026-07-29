import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Schema for every variable in .env.example. Validation runs once at
 * bootstrap (ConfigModule `validate`), so a missing or malformed value stops
 * the application immediately instead of failing on first use.
 *
 * SMTP variables stay optional until the mail module lands — tighten them
 * when it does. New environment variables must be added here and to
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

  @IsOptional()
  @IsString()
  FRONTEND_URL?: string;

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

  // --- почта (необязательна, пока нет модуля рассылки) ---
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

  @IsOptional()
  @IsString()
  MAIL_FROM?: string;
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
