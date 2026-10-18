import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { expect, it, vi } from 'vitest';
import { configFor } from 'test/helpers/config.js';

vi.mock('src/app.module.js', () => {
  @Module({
    providers: [
      {
        provide: ConfigService,
        useValue: configFor({ PORT: '0', HOST: '127.0.0.1' }),
      },
    ],
  })
  class AppModule {}
  return { AppModule };
});

it('control: bootstrap permits credentialed PATCH and DELETE', async () => {
  const started = Promise.withResolvers<NestFastifyApplication>();
  const create = NestFactory.create.bind(NestFactory);
  vi.spyOn(NestFactory, 'create').mockImplementation(async (...args) => {
    const app = await create<NestFastifyApplication>(...args);
    started.resolve(app);
    return app;
  });
  await import('src/main.js');
  const app = await started.promise;
  try {
    await vi.waitFor(() =>
      expect(app.getHttpAdapter().getInstance().server.listening).toBe(true),
    );
    for (const method of ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE']) {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/sinistres',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': method,
          'access-control-request-headers': 'content-type,authorization',
        },
      });
      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect
        .soft(
          String(response.headers['access-control-allow-methods']).split(
            /,\s*/,
          ),
        )
        .toContain(method);
    }
  } finally {
    await app.close();
  }
});
