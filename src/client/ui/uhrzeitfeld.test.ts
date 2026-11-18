import { describe, expect, it } from 'vitest';
import { uhrzeitLesen } from './uhrzeitfeld';

describe('Uhrzeitfeld: freie Eingabe → Viertelstunde', () => {
  it.each([
    ['930', '09:30'], ['9:30', '09:30'], ['9.30', '09:30'], ['9', '09:00'], ['16', '16:00'], ['1631', '16:30'],
    ['16:38', '16:45'], ['16:3', '16:30'], ['7h', '07:00'], ['23:59', '23:45'], ['0', '00:00'], ['', ''], ['  ', ''],
    ['24', null], ['12:60', null], ['abc', null], ['12345', null],
  ])('%s → %s', (ein, aus) => expect(uhrzeitLesen(ein)).toBe(aus));
});
