import { plainToInstance } from 'class-transformer';
import { validate as validateInstance } from 'class-validator';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_CHAR_CLASSES,
  PASSWORD_MIN_LENGTH,
} from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import { RegisterDto } from './register.dto';

const VALID = { email: 'victime@example.fr', password: 'Abc12345' };

const errorsFor = (payload: unknown) =>
  validateInstance(plainToInstance(RegisterDto, payload));

describe('RegisterDto', () => {
  it('accepts a valid payload', async () => {
    expect(await errorsFor(VALID)).toEqual([]);
  });

  it('trims and lower-cases the email, so two spellings normalize the same', () => {
    const dto = plainToInstance(RegisterDto, {
      ...VALID,
      email: ' User@Example.FR ',
    });

    expect(dto.email).toBe('user@example.fr');
  });

  it('rejects a malformed email', async () => {
    const errors = await errorsFor({ ...VALID, email: 'not-an-email' });

    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects a password with fewer than the required character categories', async () => {
    const errors = await errorsFor({ ...VALID, password: 'abcdefgh' });

    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it(`rejects a password shorter than ${PASSWORD_MIN_LENGTH} characters`, async () => {
    const errors = await errorsFor({ ...VALID, password: 'Abc123' });

    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('states every requirement at once, in French, on a rejected password', async () => {
    const errors = await errorsFor({ ...VALID, password: 'short' });

    const passwordError = errors.find((e) => e.property === 'password');
    expect(Object.values(passwordError?.constraints ?? {})).toContain(
      fr.auth.password.requirements(
        String(PASSWORD_MIN_LENGTH),
        String(PASSWORD_MAX_BYTES),
        String(PASSWORD_MIN_CHAR_CLASSES),
      ),
    );
  });
});
