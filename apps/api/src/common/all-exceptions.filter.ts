import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import {
  httpExceptionForPrisma,
  prismaErrorDetail,
} from 'src/prisma/prisma-error';

/**
 * The two methods this filter calls on the reply, and the two properties it
 * reads off the request. `fastify` is not a direct dependency of this package —
 * it arrives under @nestjs/platform-fastify — so naming what is used keeps a
 * phantom import out of application code.
 */
interface HttpReply {
  status(code: number): HttpReply;
  send(body: unknown): unknown;
}

interface HttpRequest {
  readonly method: string;
  readonly url: string;
}

/**
 * What Nest's own filter sends for an unhandled error, kept to the byte — the
 * status is a parameter only so that an error naming 503 is not answered with a
 * body that says 500.
 */
const internalErrorBody = (status: number) => ({
  statusCode: status,
  message: 'Internal server error',
});

/**
 * An error that is not ours and not Nest's, but already carries a status —
 * Fastify raises those for a malformed body or an oversized payload, and the
 * `http-errors` shape is what Nest's own filter recognises here. Replicated so
 * that registering this filter changes no answer: without the branch a
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

/**
 * Enough to find the failing line, far short of a full trace of the framework.
 */
const MAX_LOGGED_FRAMES = 12;

/** Typed as a number: what is compared against it is a status, not an enum. */
const FIRST_SERVER_STATUS: number = HttpStatus.INTERNAL_SERVER_ERROR;

/**
 * The frames of a stack and nothing else.
 *
 * The header of a V8 stack is `${name}: ${message}`, and the message is exactly
 * what must not reach the logs: a Prisma error spells the offending values out
 * in it, and those values are addresses, names and inventory entries. The
 * header is therefore removed by exact length, not by dropping the first line —
 * a message with newlines in it occupies several. What survives is then kept
 * only if it looks like a frame, so a message that faked its own header leaves
 * nothing behind either.
 *
 * Anything that does not match this shape yields no stack at all. Losing the
 * trace of an odd error costs a debugging session; the other direction costs
 * personal data in a log file, which the project does not allow (`CLAUDE.md`).
 */
const framesOf = (exception: unknown): string | undefined => {
  if (!(exception instanceof Error) || !exception.stack) {
    return undefined;
  }
  // An error with no message has no ": " in its header either — V8 writes the
  // name alone. Spelling the separator out regardless would fail the match
  // below and cost the frames of exactly the error that has nothing else to
  // show. Under jest this is invisible: source-map-support rewrites the stack
  // and puts the separator back, so the case is recorded with a stack written
  // out by hand in the spec.
  const header = exception.message
    ? `${exception.name}: ${exception.message}`
    : exception.name;
  if (!exception.stack.startsWith(header)) {
    return undefined;
  }
  const frames = exception.stack
    .slice(header.length)
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .slice(0, MAX_LOGGED_FRAMES);

  return frames.length > 0 ? frames.join('\n') : undefined;
};

/** The class that was thrown — never its message. */
const nameOf = (exception: unknown): string =>
  exception instanceof Error ? exception.constructor.name : typeof exception;

/**
 * The last stop of every request that failed.
 *
 * It exists for two reasons, and neither is the response shape — an
 * HttpException already answers exactly as it did before this filter:
 *
 * - **nothing of an unhandled error reaches the client**: whatever it carries,
 *   the answer is the same 500 Nest sends by default;
 * - **nothing of it reaches the log either, beyond its class and where it
 *   happened**. Prisma is the reason: its errors quote the values of the fields
 *   that failed, and in this product those are postal addresses, email
 *   addresses and inventory entries. What a Prisma error is allowed to say is
 *   decided in `src/prisma/prisma-error.ts` — its code and model name, never
 *   its message.
 *
 * Client errors are not logged at all. A 4xx is a caller's mistake, its body
 * is built from what the caller sent, and there is nothing in it worth the risk
 * of writing input to disk.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const reply = http.getResponse<HttpReply>();

    // A failed query that is really the caller's mistake answers as that
    // mistake; everything below then treats it like any other HttpException,
    // logging included — which is to say, not at all. The original is what
    // gets logged when it stays a failure, so both are kept.
    const answer = httpExceptionForPrisma(exception) ?? exception;

    const httpError = asHttpError(answer);
    const status =
      answer instanceof HttpException
        ? answer.getStatus()
        : (httpError?.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR);

    if (status >= FIRST_SERVER_STATUS) {
      this.logFailure(exception, status, request);
    }

    // An HttpException answers with its own body at any status, exactly as it
    // did before this filter: what a 500 of ours says is written by whoever
    // threw it. The stricter rule below is about the other kind — an error that
    // merely carries a statusCode: its status is honoured, its message passed
    // on only under 500. Nest hands that message over at any status, and this
    // is the one place the filter deliberately does not, because a foreign
    // server-side failure has nothing to tell a client that is worth the risk
    // of what it might quote.
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
    // The path without its query string: `q` is what the reader typed, and a
    // future endpoint could take an address the same way.
    const path = request.url.split('?')[0];

    // The Prisma code and model when there is one: with the message off
    // limits, it is the only thing that says which query failed and why.
    const detail = prismaErrorDetail(exception);

    this.logger.error(
      `${request.method} ${path} → ${status} ${nameOf(exception)}` +
        (detail ? ` ${detail}` : ''),
      framesOf(exception),
    );
  }
}
