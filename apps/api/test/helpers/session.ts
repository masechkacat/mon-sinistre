import * as bcrypt from 'bcrypt';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DAY_MS } from 'src/common/time';
import { PrismaService } from 'src/prisma/prisma.service';
import { REFRESH_COOKIE_NAME } from 'src/auth/auth.controller';

/** Cheap on purpose — this is a test fixture's cost, not a real account's. */
const TEST_SALT_ROUNDS = 4;
export const PASSWORD = 'Abc12345';

/**
 * The one `User` fixture of every auth `*.int-spec.ts`: confirmed unless
 * `confirmedAt: null`, password `PASSWORD`, a confirmation window still open
 * unless overridden. Returns the address, which is what `login` needs.
 */
export const createUser = async (
  prisma: PrismaService,
  overrides: {
    email?: string;
    confirmedAt?: Date | null;
    confirmTokenHash?: string;
    confirmExpiresAt?: Date;
  } = {},
): Promise<string> => {
  const email = overrides.email ?? `victime-${Math.random()}@example.fr`;
  await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(PASSWORD, TEST_SALT_ROUNDS),
      confirmTokenHash: overrides.confirmTokenHash ?? `token-${Math.random()}`,
      confirmExpiresAt:
        overrides.confirmExpiresAt ?? new Date(Date.now() + DAY_MS),
      confirmedAt:
        overrides.confirmedAt === undefined
          ? new Date()
          : overrides.confirmedAt,
    },
  });
  return email;
};

export const login = (app: NestFastifyApplication, email: string) =>
  app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: PASSWORD },
  });

/** Empty `cookie` sends no `Cookie` header at all. */
const withCookie = (cookie: string) => (cookie ? { cookie } : {});

export const refresh = (app: NestFastifyApplication, cookie: string) =>
  app.inject({
    method: 'POST',
    url: '/auth/refresh',
    headers: withCookie(cookie),
  });

export const logout = (app: NestFastifyApplication, cookie: string) =>
  app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: withCookie(cookie),
  });

/** `undefined` sends no `Authorization` header at all. */
export const withBearer = (accessToken?: string) =>
  accessToken ? { authorization: `Bearer ${accessToken}` } : {};

export const accessTokenOf = (res: { payload: string }): string =>
  (JSON.parse(res.payload) as { accessToken: string }).accessToken;

/** The whole `Set-Cookie` header for the refresh cookie, or `undefined` when
 * the response carries none — a `clearCookie` response has one too, with an
 * empty value and `Max-Age=0`. */
export const refreshSetCookieOf = (res: {
  headers: Record<string, unknown>;
}): string | undefined => {
  const setCookie = res.headers['set-cookie'];
  return (Array.isArray(setCookie) ? setCookie : [setCookie]).find(
    (value): value is string =>
      typeof value === 'string' && value.startsWith(`${REFRESH_COOKIE_NAME}=`),
  );
};

/** The `name=value` segment only, ready to be replayed as the `Cookie`
 * request header — the signature suffix `@fastify/cookie` appended stays
 * inside the value. */
export const refreshCookieOf = (res: {
  headers: Record<string, unknown>;
}): string => {
  const raw = refreshSetCookieOf(res);
  if (!raw) throw new Error('no refresh cookie in response');
  return raw.replace(/;.*$/, '');
};
