import { createHash, createHmac } from 'node:crypto';

import { hashVeilleFormEmail } from './veille-email-hash';

describe('hashVeilleFormEmail', () => {
  it('matches an HMAC-SHA256 keyed with the given secret', () => {
    const hash = hashVeilleFormEmail('riverain@example.fr', 'secret');

    expect(hash).toBe(
      createHmac('sha256', 'secret')
        .update('riverain@example.fr')
        .digest('hex'),
    );
  });

  it('is neither the address nor its keyless SHA-256 digest', () => {
    const email = 'riverain@example.fr';
    const hash = hashVeilleFormEmail(email, 'secret');

    expect(hash).not.toBe(email);
    expect(hash).not.toBe(createHash('sha256').update(email).digest('hex'));
  });

  it('differs when the secret differs, for the same address', () => {
    const first = hashVeilleFormEmail('riverain@example.fr', 'secret-one');
    const second = hashVeilleFormEmail('riverain@example.fr', 'secret-two');

    expect(first).not.toBe(second);
  });
});
