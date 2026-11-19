import { expect, it } from '@rstest/core';
import { nextScreenName } from '../src/screen-naming';

it('continues the numeric screen sequence across custom names', () => {
  expect(nextScreenName([{ name: 'Computer' }, { name: 'PJA110' }])).toBe(
    'Screen 3',
  );
  expect(
    nextScreenName([
      { name: 'Computer' },
      { name: 'PJA110' },
      { name: 'Screen 3' },
    ]),
  ).toBe('Screen 4');
});
