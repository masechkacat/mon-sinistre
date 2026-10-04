/** The address alert emails of a suite go to — deliberately not `admin@…`:
 * `expectNoTraceOf` also looks for the local part alone, and "admin" occurs in
 * paths and log lines of its own. */
export const ADMIN_EMAIL = 'supervision@mon-sinistre.test';

/**
 * Puts {@link ADMIN_EMAIL} in the environment for the suite and takes it back
 * out afterwards — `maxWorkers: 1` means every integration spec shares one
 * process, so a variable left behind would reach the next file. ConfigModule
 * reads it when the application compiles, so this must be called above the
 * `beforeAll` that builds it.
 */
export const withAdminEmail = (): string => {
  const original = process.env.ADMIN_EMAIL;

  beforeAll(() => {
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  });

  afterAll(() => {
    if (original === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = original;
    }
  });

  return ADMIN_EMAIL;
};
