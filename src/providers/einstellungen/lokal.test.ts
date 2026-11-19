import { describe, expect, it } from 'vitest';
import { lokaleEinstellungen } from './lokal';

describe('lokale Einstellungen (Browser)', () => {
  it('liest und schreibt JSON unter einem Präfix; Kaputtes oder Fehlendes → Standard', () => {
    const m = new Map<string, string>();
    const s = lokaleEinstellungen({ getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } });
    expect(s.lesen('geraet', 'x')).toBe('x');
    s.schreiben('geraet', { name: 'iphone' });
    expect(m.get('rundblick.geraet')).toBe('{"name":"iphone"}');
    expect(s.lesen('geraet', null)).toEqual({ name: 'iphone' });
    m.set('rundblick.kaputt', '{');
    expect(s.lesen('kaputt', 7)).toBe(7);
  });
});
