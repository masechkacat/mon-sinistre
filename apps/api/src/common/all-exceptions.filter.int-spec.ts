import {
  Controller,
  Get,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createIntTestApp } from 'src/app.int-helper';
import { Public } from 'src/auth/public.decorator';
import { Prisma } from 'src/generated/prisma/client';

const ADDRESS = 'destinataire@example.test';

/**
 * A route per way of failing. It is added to the testing module, not to
 * AppModule: the filter under test is registered globally in AppModule, so a
 * controller declared beside it is covered by the very registration this spec
 * exists to prove. `@Public()` — the filter is what's under test here, not
 * the global JwtAuthGuard; without it every route below would 401 before
 * ever reaching the filter.
 */
@Public()
@Controller('boom')
class BoomController {
  @Get('unhandled')
  unhandled(): never {
    throw new Error(`Unique constraint failed: ${ADDRESS}`);
  }

  @Get('missing')
  missing(): never {
    throw new Prisma.PrismaClientKnownRequestError(
      `Record to update not found: ${ADDRESS}`,
      { code: 'P2025', clientVersion: '7.9.1', meta: { modelName: 'Commune' } },
    );
  }

  @Get('duplicate')
  duplicate(): never {
    throw new Prisma.PrismaClientKnownRequestError(
      `Unique constraint failed on the fields: (\`email\`) = (${ADDRESS})`,
      { code: 'P2002', clientVersion: '7.9.1', meta: { modelName: 'Commune' } },
    );
  }

  @Get('unmapped')
  unmapped(): never {
    throw new Prisma.PrismaClientKnownRequestError(
      `Foreign key constraint failed: ${ADDRESS}`,
      { code: 'P2003', clientVersion: '7.9.1', meta: { modelName: 'Commune' } },
    );
  }

  @Get('not-found')
  notFound(): never {
    throw new NotFoundException();
  }

  @Get('string-body')
  stringBody(): never {
    // The shape a hand-written throw takes: the exception carries a string,
    // not an object, and the answer has to come out as JSON all the same.
    throw new HttpException('Interdit', 403);
  }
}

describe('AllExceptionsFilter (integration)', () => {
  let app: NestFastifyApplication;
  let logged: string[];

  const get = (path: string) => app.inject({ method: 'GET', url: path });

  beforeAll(async () => {
    app = await createIntTestApp({
      metadata: { controllers: [BoomController] },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    logged = [];
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((...args: unknown[]) => {
        logged.push(args.map((arg) => String(arg)).join('\n'));
      });
  });

  it('answers an unhandled error with 500 and says nothing of it', async () => {
    const res = await get('/boom/unhandled');

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
    expect(res.body).not.toContain(ADDRESS);
  });

  it('keeps the address out of the log of that failure', async () => {
    // The point of the whole filter: without it Nest logs the message, and a
    // Prisma message is where the values of the failed fields are quoted.
    await get('/boom/unhandled');

    expect(logged.join('\n')).not.toContain(ADDRESS);
    expect(logged.join('\n')).toContain('GET /boom/unhandled → 500');
  });

  it('answers 404 for a row that is not there', async () => {
    const res = await get('/boom/missing');

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(ADDRESS);
    // A 4xx is not an incident, and its body is the caller's business.
    expect(logged).toEqual([]);
  });

  it('answers 500 for a unique constraint, logging code and model', async () => {
    // Not a 409: the endpoint that owes one catches P2002 itself, because at
    // an endpoint taking an email address 409 would say the address is
    // already registered.
    const res = await get('/boom/duplicate');

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(ADDRESS);
    expect(logged.join('\n')).toContain('P2002 on Commune');
    expect(logged.join('\n')).not.toContain(ADDRESS);
  });

  it('answers an HttpException built with a string as JSON', async () => {
    const res = await get('/boom/string-body');

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ statusCode: 403, message: 'Interdit' });
  });

  it('answers 500 for a Prisma code with no answer of its own, logging code and model', async () => {
    const res = await get('/boom/unmapped');

    expect(res.statusCode).toBe(500);
    expect(logged.join('\n')).toContain('P2003 on Commune');
    expect(logged.join('\n')).not.toContain(ADDRESS);
  });

  it('leaves an HttpException exactly as it was', async () => {
    const res = await get('/boom/not-found');

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      statusCode: 404,
      message: 'Not Found',
    });
  });

  it('still answers 404 on a route that does not exist', async () => {
    // The adapter's own not-found handler goes through the filter too; a
    // registration that swallowed it would turn every typo into a 500.
    const res = await get('/pas-une-route');

    expect(res.statusCode).toBe(404);
  });

  it('leaves the search endpoint answering as it did', async () => {
    // The one live endpoint of the API: its validation error is built by the
    // pipe and read by the web form, and the filter must not reshape it.
    const res = await get('/communes?q=a');

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ statusCode: 400 });
  });
});
