import {
  type ArgumentsHost,
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { Prisma } from 'src/generated/prisma/client';

import { AllExceptionsFilter } from './all-exceptions.filter';

const ADDRESS = 'destinataire@example.test';

/** A failed query as the client throws it, message and meta included. */
const prismaError = (
  code: string,
  meta?: Record<string, unknown>,
): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on the fields: (\`email\`) = (${ADDRESS})`,
    { code, clientVersion: '7.9.1', meta },
  );

const hostFor = (url = '/communes') => {
  const reply = {
    status: jest.fn((): unknown => reply),
    send: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url }),
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;

  return { host, reply };
};

/** Everything the logger was handed for one call, as one searchable string. */
const loggedText = (spy: jest.SpyInstance): string =>
  (spy.mock.calls as unknown[][]).map((call) => call.join('\n')).join('\n');

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();
  let error: jest.SpyInstance;

  beforeEach(() => {
    // restoreMocks in the jest config undoes this after every test.
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  describe('the answer', () => {
    it('lets an HttpException answer exactly as it would without the filter', () => {
      const { host, reply } = hostFor();

      filter.catch(new NotFoundException(), host);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 404 }),
      );
    });

    it('keeps the body a validation error carries', () => {
      // This is the one body a client actually reads: the pipe puts the list of
      // failed constraints in it, and a filter that flattened it would break
      // every form in the web application.
      const { host, reply } = hostFor();
      const failed = new BadRequestException({
        statusCode: 400,
        message: ['q must be longer than or equal to 2 characters'],
        error: 'Bad Request',
      });

      filter.catch(failed, host);

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: ['q must be longer than or equal to 2 characters'],
        }),
      );
    });

    it('answers an unknown error with the 500 Nest sends by default', () => {
      const { host, reply } = hostFor();

      filter.catch(new Error(`duplicate key: ${ADDRESS}`), host);

      expect(reply.status).toHaveBeenCalledWith(500);
      expect(reply.send).toHaveBeenCalledWith({
        statusCode: 500,
        message: 'Internal server error',
      });
    });

    it('tells the client nothing about what failed', () => {
      const { host, reply } = hostFor();

      filter.catch(new Error(`Unique constraint on (${ADDRESS})`), host);

      expect(JSON.stringify(reply.send.mock.calls)).not.toContain(ADDRESS);
    });

    it('honours the status of an error that already carries one', () => {
      // Fastify raises these for a malformed body: they are not HttpExceptions
      // and Nest's own filter answers them by their statusCode. A filter that
      // turned them into 500 would break a caller that reads the difference.
      const { host, reply } = hostFor();

      filter.catch(
        { statusCode: 400, message: 'Unexpected end of JSON' },
        host,
      );

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({
        statusCode: 400,
        message: 'Unexpected end of JSON',
      });
    });

    it('keeps the message of such an error to itself once it is a 5xx', () => {
      // The one place this filter is stricter than Nest: a server-side failure
      // answers with the generic body whatever it named itself.
      const { host, reply } = hostFor();

      filter.catch({ statusCode: 503, message: `pool: ${ADDRESS}` }, host);

      expect(reply.status).toHaveBeenCalledWith(503);
      // The status it named, the body it does not get to write.
      expect(reply.send).toHaveBeenCalledWith({
        statusCode: 503,
        message: 'Internal server error',
      });
    });

    it('wraps the bare string of an HttpException built with one', () => {
      // getResponse() gives back what the exception was built with, and for
      // `new HttpException(<string>, status)` that is the string itself. Nest
      // wraps it; sending it raw would answer a JSON string, and a client
      // reading `message` off the body would find nothing.
      const { host, reply } = hostFor();

      filter.catch(new HttpException('Interdit', 403), host);

      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith({
        statusCode: 403,
        message: 'Interdit',
      });
    });

    it('lets a 5xx HttpException answer with the body it was given', () => {
      // The stricter 5xx rule is about foreign errors carrying a statusCode.
      // What one of ours says at 500 was written by whoever threw it, and this
      // filter does not second-guess it — nor does Nest.
      const { host, reply } = hostFor();

      filter.catch(new ServiceUnavailableException('maintenance'), host);

      expect(reply.status).toHaveBeenCalledWith(503);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'maintenance' }),
      );
    });

    it('answers 500 for something thrown that is not an Error at all', () => {
      const { host, reply } = hostFor();

      filter.catch('boom', host);

      expect(reply.status).toHaveBeenCalledWith(500);
      expect(reply.send).toHaveBeenCalledWith({
        statusCode: 500,
        message: 'Internal server error',
      });
    });
  });

  describe('a failed query', () => {
    it('answers 404 when the row addressed is not there', () => {
      // Ownership is part of the where clause, so "someone else's" arrives
      // here as "not found" — and must leave as 404, never 403.
      const { host, reply } = hostFor('/sinistres/42');

      filter.catch(prismaError('P2025', { modelName: 'Sinistre' }), host);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 404 }),
      );
    });

    it('answers 500 when a unique constraint refused the write', () => {
      // Deliberately not a 409: at an endpoint taking an email address that
      // answer would say the address is already registered. A write that owes
      // the caller a 409 catches P2002 itself; unhandled, it is a failure of
      // ours like any other.
      const { host, reply } = hostFor('/veille');

      filter.catch(prismaError('P2002', { modelName: 'Watcher' }), host);

      expect(reply.status).toHaveBeenCalledWith(500);
      expect(reply.send).toHaveBeenCalledWith({
        statusCode: 500,
        message: 'Internal server error',
      });
    });

    it('says nothing of the row in either answer', () => {
      const { host, reply } = hostFor();

      filter.catch(prismaError('P2002', { modelName: 'Commune' }), host);
      filter.catch(prismaError('P2025', { modelName: 'Commune' }), host);

      expect(JSON.stringify(reply.send.mock.calls)).not.toContain(ADDRESS);
    });

    it('does not log a query that failed by the caller’s mistake', () => {
      // It left as a 4xx, and 4xx are the caller's business, not an incident.
      filter.catch(
        prismaError('P2025', { modelName: 'Sinistre' }),
        hostFor().host,
      );

      expect(error).not.toHaveBeenCalled();
    });

    it('answers 500 for a code with no answer true of every endpoint', () => {
      // P2003 is a foreign key violation: whether that is the caller's fault
      // depends on the endpoint, so the filter refuses to guess.
      const { host, reply } = hostFor();

      filter.catch(prismaError('P2003', { modelName: 'Commune' }), host);

      expect(reply.status).toHaveBeenCalledWith(500);
    });

    it('logs the code and the model of a failure, and nothing else of it', () => {
      // With the message off limits, these two are all that says which query
      // failed and why — and both are schema, not data.
      filter.catch(
        prismaError('P2003', { modelName: 'Commune' }),
        hostFor().host,
      );

      expect(loggedText(error)).toContain('P2003 on Commune');
      expect(loggedText(error)).not.toContain(ADDRESS);
      expect(loggedText(error)).not.toContain('email');
    });

    it('logs the code alone when the error names no model', () => {
      filter.catch(prismaError('P2003'), hostFor().host);

      expect(loggedText(error)).toContain('P2003');
      expect(loggedText(error)).not.toContain(ADDRESS);
    });
  });

  describe('the log', () => {
    it('says nothing about a client error', () => {
      // A 4xx is the caller's mistake and its body is built from what the
      // caller sent — there is nothing here worth writing input to disk for.
      filter.catch(new NotFoundException(), hostFor().host);
      filter.catch(new BadRequestException(), hostFor().host);

      expect(error).not.toHaveBeenCalled();
    });

    it('names the class, the method and the path of a failure', () => {
      filter.catch(new TypeError('boom'), hostFor('/communes').host);

      expect(loggedText(error)).toContain('GET /communes → 500 TypeError');
    });

    it('never logs the message of the error', () => {
      // The message is where Prisma quotes the values of the fields that
      // failed, and in this product those are addresses and inventory entries.
      filter.catch(
        new Error(`Unique constraint failed: ${ADDRESS}`),
        hostFor().host,
      );

      expect(loggedText(error)).not.toContain(ADDRESS);
      expect(loggedText(error)).toContain('Error');
    });

    it('keeps the query string out of the path it logs', () => {
      // `q` is what the reader typed; a later endpoint could take an address
      // the same way.
      filter.catch(
        new Error('boom'),
        hostFor(`/communes?q=${encodeURIComponent(ADDRESS)}`).host,
      );

      expect(loggedText(error)).toContain('GET /communes ');
      expect(loggedText(error)).not.toContain('q=');
    });

    it('logs the frames of the stack', () => {
      filter.catch(new Error('boom'), hostFor().host);

      expect(loggedText(error)).toContain('at ');
      expect(loggedText(error)).toContain('all-exceptions.filter.spec.ts');
    });

    it('drops a whole multi-line message, not just its first line', () => {
      // Prisma writes several lines and indents them; only the first belongs
      // to the header of the stack, so dropping "the first line" would leave
      // the rest.
      filter.catch(
        new Error(`Invalid query\n  where: { email: "${ADDRESS}" }`),
        hostFor().host,
      );

      expect(loggedText(error)).not.toContain(ADDRESS);
    });

    it('drops a message that imitates a stack frame', () => {
      // The frames are told apart by shape, so a message shaped like one would
      // survive the filter if the header were not removed by length first.
      filter.catch(new Error(`boom\n    at ${ADDRESS}`), hostFor().host);

      expect(loggedText(error)).not.toContain(ADDRESS);
    });

    it('logs the frames of an error that carries no message', () => {
      // The stack is written out by hand in the format V8 produces, because
      // jest does not run in it: source-map-support rebuilds every stack it
      // touches and puts a ": " after the name even when there is no message,
      // so a spec throwing a real `new Error()` would pass either way. In
      // production the header is the bare name — and an error with nothing but
      // a class name is the one whose frames are all there is to go on.
      const bare = new Error();
      bare.stack = 'Error\n    at quelquePart (/app/dist/main.js:1:1)';

      filter.catch(bare, hostFor().host);

      expect(loggedText(error)).toContain('at quelquePart');
    });

    it('logs no stack rather than an unrecognised one', () => {
      // A stack that does not start with the header is not one this filter can
      // trim safely, and half a leak is a leak.
      const odd = new Error(ADDRESS);
      odd.stack = `something else entirely: ${ADDRESS}\n    at somewhere`;

      filter.catch(odd, hostFor().host);

      expect(loggedText(error)).not.toContain(ADDRESS);
      expect(error).toHaveBeenCalledWith(expect.any(String), undefined);
    });
  });
});
