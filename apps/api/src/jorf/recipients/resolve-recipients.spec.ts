import {
  type SubscribedCommune,
  resolveRecipients,
  subtractCoveredCommunes,
} from './resolve-recipients';

function sub(overrides: Partial<SubscribedCommune>): SubscribedCommune {
  return {
    veilleId: 'veille-1',
    codeInsee: '30189',
    confirmed: true,
    ...overrides,
  };
}

describe('resolveRecipients', () => {
  it('gives a confirmed subscriber of an entry commune as a recipient', () => {
    const recipients = resolveRecipients(['30189'], new Map(), [
      sub({ codeInsee: '30189' }),
    ]);

    expect(recipients).toEqual([
      { veilleId: 'veille-1', codeInsee: ['30189'] },
    ]);
  });

  it('excludes an unconfirmed subscription (critère № 6)', () => {
    const recipients = resolveRecipients(['30189'], new Map(), [
      sub({ codeInsee: '30189', confirmed: false }),
    ]);

    expect(recipients).toEqual([]);
  });

  it('excludes a subscriber of a commune the arrêté does not name', () => {
    const recipients = resolveRecipients(['30189'], new Map(), [
      sub({ codeInsee: '30001' }),
    ]);

    expect(recipients).toEqual([]);
  });

  it('resolves a subscriber of a merged commune to its successor', () => {
    const recipients = resolveRecipients(
      ['30190'],
      new Map([['30189', '30190']]),
      [sub({ codeInsee: '30189' })],
    );

    expect(recipients).toEqual([
      { veilleId: 'veille-1', codeInsee: ['30190'] },
    ]);
  });

  it('follows a chain of successors across repeated mergers', () => {
    const recipients = resolveRecipients(
      ['30191'],
      new Map([
        ['30189', '30190'],
        ['30190', '30191'],
      ]),
      [sub({ codeInsee: '30189' })],
    );

    expect(recipients).toEqual([
      { veilleId: 'veille-1', codeInsee: ['30191'] },
    ]);
  });

  it('does not hang on a cyclic successor chain', () => {
    const recipients = resolveRecipients(
      ['30189'],
      new Map([
        ['30189', '30190'],
        ['30190', '30189'],
      ]),
      [sub({ codeInsee: '30189' })],
    );

    expect(recipients).toEqual([]);
  });

  it('groups a watcher of two communes of the same arrêté into one recipient (critère № 5)', () => {
    const recipients = resolveRecipients(['30189', '30001'], new Map(), [
      sub({ codeInsee: '30189' }),
      sub({ codeInsee: '30001' }),
    ]);

    expect(recipients).toEqual([
      { veilleId: 'veille-1', codeInsee: ['30001', '30189'] },
    ]);
  });

  it('keeps distinct watchers as distinct recipients', () => {
    const recipients = resolveRecipients(['30189'], new Map(), [
      sub({ veilleId: 'veille-1', codeInsee: '30189' }),
      sub({ veilleId: 'veille-2', codeInsee: '30189' }),
    ]);

    expect(recipients).toEqual([
      { veilleId: 'veille-1', codeInsee: ['30189'] },
      { veilleId: 'veille-2', codeInsee: ['30189'] },
    ]);
  });

  it('gives an empty list for an arrêté with no matching subscribers', () => {
    expect(resolveRecipients(['30189'], new Map(), [])).toEqual([]);
  });
});

describe('subtractCoveredCommunes', () => {
  it('drops a covered commune and keeps the rest (critère PRD № 14)', () => {
    expect(
      subtractCoveredCommunes(['30189', '30001'], new Set(['30189'])),
    ).toEqual(['30001']);
  });

  it('returns every code unchanged when nothing is covered', () => {
    expect(subtractCoveredCommunes(['30189', '30001'], new Set())).toEqual([
      '30189',
      '30001',
    ]);
  });

  it('returns an empty list when every code is covered', () => {
    expect(subtractCoveredCommunes(['30189'], new Set(['30189']))).toEqual([]);
  });

  it('ignores a covered code the list does not carry', () => {
    expect(subtractCoveredCommunes(['30189'], new Set(['99999']))).toEqual([
      '30189',
    ]);
  });
});
