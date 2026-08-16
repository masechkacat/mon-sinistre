import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import { errorSummary, stackOf } from 'src/common/error-report';
import { httpExceptionForPrisma } from 'src/prisma/prisma-error';

/** Declared rather than imported: fastify arrives under
 * @nestjs/platform-fastify and is not a direct dependency of this package. */
interface HttpReply {
  status(code: number): HttpReply;
  send(body: unknown): unknown;
}

interface HttpRequest {
  readonly method: string;
  readonly url: string;
}

/** What Nest's own filter sends, kept to the byte. */
const internalErrorBody = (status: number) => ({
  statusCode: status,
  message: 'Internal server error',
});

/**
 * Fastify raises these for a malformed body or an oversized payload. Replicated
 * so that registering this filter changes no answer: without the branch a
 * protocol complaint that used to be a 400 would become a 500.
 */
interface HttpErrorLike {
  readonly statusCode: number;
  readonly message: string;
}

/**
 * The body of an HttpException, in the shape Nest's own filter sends it.
 *
 * `getResponse()` hands back whatever the exception was built with: an object
 * for `new NotFoundException()` and every other built-in class, but a bare
 * string for `new HttpException('Interdit', 403)`. Nest wraps that string in
 * the usual `{ statusCode, message }`; passing it on as it comes would answer
 * such an endpoint with a JSON string, and a client reading `message` off the
 * body would find nothing there.
 */
const httpExceptionBody = (
  exception: HttpException,
  status: number,
): unknown => {
  const response = exception.getResponse();
  return typeof response === 'object' && response !== null
    ? response
    : { statusCode: status, message: response };
};

const asHttpError = (exception: unknown): HttpErrorLike | undefined => {
  if (typeof exception !== 'object' || exception === null) {
    return undefined;
  }
  const { statusCode, message } = exception as Partial<HttpErrorLike>;
  return typeof statusCode === 'number' && typeof message === 'string'
    ? { statusCode, message }
    : undefined;
};

/** Typed as a number: what is compared against it is a status, not an enum. */
const FIRST_SERVER_STATUS: number = HttpStatus.INTERNAL_SERVER_ERROR;

/**
 * The last stop of every failed request. It does not change the response shape;
 * it exists so that nothing of an unhandled error reaches the client, and
 * nothing of it reaches the log beyond its class and where it happened.
 *
 * Client errors are not logged at all: a 4xx body is built from what the caller
 * sent.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const reply = http.getResponse<HttpReply>();

    // Both are kept: the translated one decides the answer, the original is
    // what gets logged when it stays a failure.
    const answer = httpExceptionForPrisma(exception) ?? exception;

    const httpError = asHttpError(answer);
    const status =
      answer instanceof HttpException
        ? answer.getStatus()
        : (httpError?.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR);

    if (status >= FIRST_SERVER_STATUS) {
      this.logFailure(exception, status, request);
    }

    // An HttpException answers with its own body at any status — what a 500 of
    // ours says is written by whoever threw it. A foreign http-error is
    // stricter than Nest on purpose: its message is passed on only below 500,
    // because a server-side failure has nothing to tell a client that is worth
    // the risk of what it might quote.
    const body =
      answer instanceof HttpException
        ? httpExceptionBody(answer, status)
        : status < FIRST_SERVER_STATUS && httpError
          ? httpError
          : internalErrorBody(status);

    reply.status(status).send(body);
  }

  private logFailure(
    exception: unknown,
    status: number,
    request: HttpRequest,
  ): void {
    // Without the query string: `q` is what the reader typed, and a future
    // endpoint could take an address the same way.
    const path = request.url.split('?')[0];

    this.logger.error(
      `${request.method} ${path} → ${status} ${errorSummary(exception)}`,
      stackOf(exception),
    );
  }
}
