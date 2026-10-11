import { predecessorCodesOf } from './predecessor-codes';

describe('predecessorCodesOf', () => {
  it('gives nothing for a commune nothing merged into', () => {
    expect(predecessorCodesOf('30189', new Map())).toEqual([]);
  });

  it('gives the code of a commune merged into it', () => {
    expect(predecessorCodesOf('30190', new Map([['30189', '30190']]))).toEqual([
      '30189',
    ]);
  });

  it('excludes a code that merged into another commune', () => {
    expect(predecessorCodesOf('30190', new Map([['30189', '30191']]))).toEqual(
      [],
    );
  });

  it('gives every code of a chain of repeated mergers, sorted whatever the map order', () => {
    const successorOf = new Map([
      ['30190', '30191'],
      ['30189', '30190'],
    ]);

    expect(predecessorCodesOf('30191', successorOf)).toEqual([
      '30189',
      '30190',
    ]);
  });

  it('gives nothing for a cycle in the map instead of looping', () => {
    const successorOf = new Map([
      ['30189', '30190'],
      ['30190', '30189'],
    ]);

    expect(predecessorCodesOf('30189', successorOf)).toEqual([]);
  });
});
