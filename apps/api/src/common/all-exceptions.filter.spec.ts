import {
  type ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AllExceptionsFilter } from './all-exceptions.filter';

const ADDRESS = 'destinataire@example.test';

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
