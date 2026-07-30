import { Logger, ValidationPipe } from '@nestjs/common';
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

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const config = app.get(ConfigService);

  // Without shutdown hooks SIGTERM kills the process abruptly: scheduled
  // jobs keep running mid-tick and lifecycle hooks (onModuleDestroy,
  // onApplicationShutdown) never fire — including Prisma's disconnect
  // once PrismaModule lands.
  app.enableShutdownHooks();

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(fastifyCookie, {
    secret: config.getOrThrow<string>('COOKIE_SECRET'),
  });

  app.enableCors({
    origin: config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000',
    credentials: true,
  });

  // whitelist strips properties absent from the DTO; forbidNonWhitelisted
  // rejects them outright so unexpected input fails loudly rather than silently.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

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

  const port = config.get<number>('PORT') ?? 3001;
  const host = config.get<string>('HOST') ?? '0.0.0.0';

  await app.listen(port, host);

  const logger = new Logger('Bootstrap');
  logger.log(`API      http://localhost:${port}`);
  logger.log(`OpenAPI  http://localhost:${port}/docs`);
}

void bootstrap();
