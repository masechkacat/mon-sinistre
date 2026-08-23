/** The one `User` row shape needed by schema-level specs (raw `PrismaClient`,
 * no NestJS bootstrap) — `user-schema.int-spec.ts`, `password-reset-schema.int-spec.ts`.
 * App-level specs use `createUser` (`session.ts`) instead. */
export function userData(overrides: Partial<{ email: string }> = {}) {
  return {
    email: overrides.email ?? `victime-${Math.random()}@example.fr`,
    passwordHash: 'bcrypt-hash',
    confirmTokenHash: `confirm-${Math.random()}`,
    confirmExpiresAt: new Date('2026-08-29'),
  };
}
