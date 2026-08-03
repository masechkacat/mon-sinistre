import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import fastifyCookie from '@fastify/cookie';
import { AppModule } from './app.module';
import type { EnvironmentVariables } from './config/env.validation';
import { createGlobalValidationPipe } from './config/validation-pipe';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  // The container hands back the one ConfigService; the parameters say what it
  // was validated against, so every name below is checked at compile time.
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  // Without these SIGTERM kills the process abruptly: scheduled jobs keep
  // running mid-tick and onModuleDestroy never fires, Prisma's disconnect
  // included.
  app.enableShutdownHooks();

  await app.register(helmet, { contentSecurityPolicy: false });
  // A binding, not inline: the option accepts a union of half a dozen types and
  // inferring the lookup against it lands on unknown.
  const cookieSecret = config.get('COOKIE_SECRET', { infer: true });
  await app.register(fastifyCookie, { secret: cookieSecret });

  app.enableCors({
    origin: config.get('FRONTEND_URL', { infer: true }),
    credentials: true,
  });

  app.useGlobalPipes(createGlobalValidationPipe());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Mon Sinistre API')
    .setDescription(
      'Veille des arrêtés de catastrophe naturelle et suivi du sinistre',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'JWT',
    )
    .build();

  SwaggerModule.setup('docs', app, () =>
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  // No fallback: the schema carries the defaults.
  const port = config.get('PORT', { infer: true });
  const host = config.get('HOST', { infer: true });

  await app.listen(port, host);

  const logger = new Logger('Bootstrap');
  logger.log(`API      http://localhost:${port}`);
  logger.log(`OpenAPI  http://localhost:${port}/docs`);
}

void bootstrap();
