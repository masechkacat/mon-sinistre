import * as bcrypt from 'bcrypt';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DAY_MS } from 'src/common/time';
import { PrismaService } from 'src/prisma/prisma.service';
import { REFRESH_COOKIE_NAME } from './auth.controller';

/** Cheap on purpose — this is a test fixture's cost, not a real account's. */
export const TEST_SALT_ROUNDS = 4;
export const PASSWORD = 'Abc12345';

/** Shared by every `*.int-spec.ts` that needs a session already open —
 * `refresh` and `logout` today. Creates a confirmed account so `login`
 * succeeds. */
export const createConfirmedUser = async (
  prisma: PrismaService,
): Promise<string> => {
  const email = `victime-${Math.random()}@example.fr`;
  await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(PASSWORD, TEST_SALT_ROUNDS),
      confirmTokenHash: `token-${Math.random()}`,
      confirmExpiresAt: new Date(Date.now() + DAY_MS),
      confirmedAt: new Date(),
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

/** The `name=value` segment of a `Set-Cookie` response header, ready to be
 * replayed as the `Cookie` request header — the signature suffix
 * `@fastify/cookie` appended stays untouched either way. */
export const refreshCookieOf = (res: {
  headers: Record<string, unknown>;
}): string => {
  const setCookie = res.headers['set-cookie'];
  const raw = (Array.isArray(setCookie) ? setCookie : [setCookie]).find(
    (value): value is string =>
      typeof value === 'string' && value.startsWith(`${REFRESH_COOKIE_NAME}=`),
  );
  if (!raw) throw new Error('no refresh cookie in response');
  return raw.split(';')[0] ?? raw;
};
