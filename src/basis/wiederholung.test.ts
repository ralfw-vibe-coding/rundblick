import { expect, it } from 'vitest';
import { wiederholungText } from './wiederholung';

it('Wiederholung als Text', () => {
  expect(wiederholungText({ einheit: 'monat', alle: 1 })).toBe('monatlich');
  expect(wiederholungText({ einheit: 'monat', alle: 3 })).toBe('vierteljährlich');
  expect(wiederholungText({ einheit: 'monat', alle: 6 })).toBe('halbjährlich');
  expect(wiederholungText({ einheit: 'tag', alle: 17 })).toBe('alle 17 Tage');
  expect(wiederholungText({ einheit: 'jahr', alle: 1 })).toBe('jährlich');
});
