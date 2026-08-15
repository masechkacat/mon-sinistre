import { plainToInstance } from 'class-transformer';
import { validate as validateInstance } from 'class-validator';
import { VEILLE_MAX_COMMUNES } from '@mon-sinistre/contracts';

import { CreateVeilleDto } from './create-veille.dto';

const VALID = { email: 'riverain@example.fr', communeCodes: ['30189'] };

const errorsFor = (payload: unknown) =>
  validateInstance(plainToInstance(CreateVeilleDto, payload));

describe('CreateVeilleDto', () => {
  it('accepts a valid payload', async () => {
    expect(await errorsFor(VALID)).toEqual([]);
  });

  it('trims and lower-cases the email, so two spellings normalize the same', () => {
    const dto = plainToInstance(CreateVeilleDto, {
      ...VALID,
      email: ' User@Example.FR ',
    });

    expect(dto.email).toBe('user@example.fr');
  });

  it('rejects a malformed email', async () => {
    const errors = await errorsFor({ ...VALID, email: 'not-an-email' });

    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects zero communes', async () => {
    const errors = await errorsFor({ ...VALID, communeCodes: [] });

    expect(errors.some((e) => e.property === 'communeCodes')).toBe(true);
  });

  it(`rejects more than ${VEILLE_MAX_COMMUNES} communes`, async () => {
    const errors = await errorsFor({
      ...VALID,
      communeCodes: Array.from({ length: VEILLE_MAX_COMMUNES + 1 }, (_, i) =>
        String(i).padStart(5, '0'),
      ),
    });

    expect(errors.some((e) => e.property === 'communeCodes')).toBe(true);
  });

  it(`accepts exactly ${VEILLE_MAX_COMMUNES} communes`, async () => {
    const errors = await errorsFor({
      ...VALID,
      communeCodes: Array.from({ length: VEILLE_MAX_COMMUNES }, (_, i) =>
        String(i).padStart(5, '0'),
      ),
    });

    expect(errors).toEqual([]);
  });

  it.each(['3018', '301890'])(
    'rejects a commune code that is not 5 characters long (%s)',
    async (code) => {
      const errors = await errorsFor({ ...VALID, communeCodes: [code] });

      expect(errors.some((e) => e.property === 'communeCodes')).toBe(true);
    },
  );

  it('does not reject a code repeated in the form — deduplication is the service’s job', async () => {
    const errors = await errorsFor({
      ...VALID,
      communeCodes: ['30189', '30189'],
    });

    expect(errors).toEqual([]);
  });
});
