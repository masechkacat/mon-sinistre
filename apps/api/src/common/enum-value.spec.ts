import { describe, it, expect } from 'vitest';
import { SinistreStatus } from '@mon-sinistre/contracts';
import { enumValue } from './enum-value.js';

describe('enumValue', () => {
  it('returns a known value as the member and refuses any other string', () => {
    expect(enumValue(SinistreStatus, 'CLOS')).toBe(SinistreStatus.CLOS);
    expect(() => enumValue(SinistreStatus, 'clos')).toThrow(/clos/);
    expect(() => enumValue(SinistreStatus, '')).toThrow();
  });
});
