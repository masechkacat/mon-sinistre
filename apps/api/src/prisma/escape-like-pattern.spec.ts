import { escapeLikePattern } from './escape-like-pattern';

/**
 * The only place where user input reaches a LIKE pattern, so it is tested
 * without a database: the integration suite that exercises the same rule
 * through `GET /communes` needs Docker and does not run in the pre-commit
 * hook, where a regression here would otherwise pass unnoticed.
 */
describe('escapeLikePattern', () => {
  it.each([
    ['ch%', 'ch\\%'],
    ['c_ateau', 'c\\_ateau'],
    ['%%', '\\%\\%'],
    ['__', '\\_\\_'],
  ])('escapes the LIKE wildcards of %s', (input, expected) => {
    expect(escapeLikePattern(input)).toBe(expected);
  });

  it.each([
    // The escape character itself: escaped last (or not at all), it would
    // swallow the backslashes added for % and _ and turn them back into
    // wildcards. A single pass over [\\%_] makes the order irrelevant.
    ['test\\', 'test\\\\'],
    ['a\\%b', 'a\\\\\\%b'],
    ['\\_', '\\\\\\_'],
  ])(
    'escapes the backslash in %s without re-escaping its own output',
    (input, expected) => {
      expect(escapeLikePattern(input)).toBe(expected);
    },
  );

  it.each(['chateau', "l'isle-adam", 'sainte-marie', '2a004', ''])(
    'leaves %s untouched — no metacharacter, no change',
    (input) => {
      expect(escapeLikePattern(input)).toBe(input);
    },
  );

  it('is not idempotent, and must be applied exactly once', () => {
    // Guards against a future caller "making sure" by escaping twice: the
    // second pass escapes the escapes and the pattern stops matching.
    expect(escapeLikePattern(escapeLikePattern('ch%'))).toBe('ch\\\\\\%');
  });
});
