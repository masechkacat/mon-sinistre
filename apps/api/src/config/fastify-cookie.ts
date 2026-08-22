import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';

/**
 * Registered by both `main.ts` and `createIntTestApp`: the refresh cookie
 * (login, and later refresh/logout) needs `@fastify/cookie` active in every
 * `NestFastifyApplication` the auth endpoints run in, integration tests
 * included — without it `reply.setCookie` does not exist.
 *
 * Takes the secret itself, not the `ConfigService` — `.get('COOKIE_SECRET', {
 * infer: true })` only comes back typed as `string` when TypeScript resolves
 * it at the call site against a concrete `ConfigService<EnvironmentVariables,
 * true>`; routed through a second function parameter the same call infers
 * `unknown` instead.
 */
export async function registerCookiePlugin(
  app: NestFastifyApplication,
  cookieSecret: string,
): Promise<void> {
  await app.register(fastifyCookie, { secret: cookieSecret });
}
