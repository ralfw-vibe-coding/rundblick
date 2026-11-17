// Tests der kleinen Provider: Einstellungen, IDs, Uhr – und die Ordner-Beobachtung des JSONL-Stores.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { dateiAnhaenge, speicherAnhaenge } from './anhaenge/datei';
import { jsonEinstellungen, speicherEinstellungen } from './einstellungen/json';
import { hlcFormat, stromVergleich } from './eventstore/hlc';
import { JsonlEventStore } from './eventstore/jsonl';
import { ulid, ulidGenerator, zaehlerIds } from './ids/ulid';
import { datumLokal, festeUhr, systemUhr } from './uhr/system';

const ordner = mkdtempSync(join(tmpdir(), 'rb-prov-'));
afterAll(() => rmSync(ordner, { recursive: true, force: true }));

describe('Einstellungen', () => {
  it('JSON-Datei: Standardwert, schreiben, neu lesen, atomar ersetzt', () => {
    const p = join(ordner, 'sub', 'geraet.json');
    const e = jsonEinstellungen(p);
    expect(e.lesen('x', 5)).toBe(5);
    e.schreiben('x', { a: 1 });
    expect(jsonEinstellungen(p).lesen('x', null)).toEqual({ a: 1 });
    expect(existsSync(p + '.tmp')).toBe(false);
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ x: { a: 1 } });
  });
  it('kaputte Datei → leere Einstellungen', () => {
    const p = join(ordner, 'kaputt.json');
    writeFileSync(p, '{nein');
    expect(jsonEinstellungen(p).lesen('x', 'std')).toBe('std');
  });
  it('im Speicher', () => {
    const e = speicherEinstellungen({ a: 1 });
    expect(e.lesen('a', 0)).toBe(1);
    e.schreiben('b', 2);
    expect(e.lesen('b', 0)).toBe(2);
    expect(e.lesen('c', 3)).toBe(3);
  });
});

describe('Anhänge als Dateien', () => {
  it('speichert, liest und entfernt; lehnt unsichere IDs ab', () => {
    const a = dateiAnhaenge(join(ordner, 'anh'));
    expect(a.lesen('X1')).toBeNull();
    a.speichern('X1', new Uint8Array([1, 2, 3]));
    expect([...a.lesen('X1')!]).toEqual([1, 2, 3]);
    a.entfernen('X1');
    a.entfernen('X1');
    expect(a.lesen('X1')).toBeNull();
    expect(() => a.speichern('../boese', new Uint8Array([1]))).toThrow('Ungültige');
  });
  it('im Speicher', () => {
    const a = speicherAnhaenge();
    a.speichern('a', new Uint8Array([9]));
    expect(a.lesen('a')).toEqual(new Uint8Array([9]));
    a.entfernen('a');
    expect(a.lesen('a')).toBeNull();
  });
});

describe('IDs', () => {
  it('ULID: 26 Zeichen Crockford-Base32, zeitlich sortierbar', () => {
    const a = ulid(1_000), b = ulid(2_000);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a < b).toBe(true);
    expect(ulid(0, new Uint8Array(16))).toBe('0'.repeat(26));
    expect(ulidGenerator.neu()).not.toBe(ulidGenerator.neu());
  });
  it('Zähler-IDs', () => {
    const g = zaehlerIds('p');
    expect([g.neu(), g.neu()]).toEqual(['p1', 'p2']);
    expect(zaehlerIds().neu()).toBe('id1');
  });
});

describe('Uhr', () => {
  it('System-Uhr liefert konsistente Werte', () => {
    expect(systemUhr.heute()).toBe(datumLokal(new Date()));
    expect(systemUhr.jetzt()).toBeInstanceOf(Date);
    expect(systemUhr.minuteDesTages()).toBeGreaterThanOrEqual(0);
    expect(systemUhr.minuteDesTages()).toBeLessThan(24 * 60);
  });
  it('feste Uhr', () => {
    const u = festeUhr('2026-03-05T07:09:00');
    expect([u.heute(), u.minuteDesTages(), u.jetzt().getMinutes()]).toEqual(['2026-03-05', 429, 9]);
  });
});

describe('Stromreihenfolge', () => {
  const e = (hlc: string, geraet: string, id: string) => ({ id, meta: { hlc, geraet } });
  it('sortiert nach HLC, dann Gerät, dann ID', () => {
    const h1 = hlcFormat(1, 0), h2 = hlcFormat(2, 0);
    expect(stromVergleich(e(h1, 'b', 'x'), e(h2, 'a', 'x'))).toBe(-1);
    expect(stromVergleich(e(h2, 'a', 'x'), e(h1, 'b', 'x'))).toBe(1);
    expect(stromVergleich(e(h1, 'a', 'x'), e(h1, 'b', 'x'))).toBe(-1);
    expect(stromVergleich(e(h1, 'b', 'x'), e(h1, 'a', 'x'))).toBe(1);
    expect(stromVergleich(e(h1, 'a', 'x'), e(h1, 'a', 'y'))).toBe(-1);
    expect(stromVergleich(e(h1, 'a', 'y'), e(h1, 'a', 'x'))).toBe(1);
    expect(stromVergleich(e(h1, 'a', 'x'), e(h1, 'a', 'x'))).toBe(0);
  });
});

describe('JSONL-Store: Ordner beobachten', () => {
  it('übernimmt Events, die ein anderes Gerät in seine Datei schreibt (z. B. per Dropbox)', async () => {
    const o = join(ordner, 'daten');
    let n = 0;
    const mac = new JsonlEventStore(o, 'Mac', () => `m${++n}`, () => new Date());
    const iphone = new JsonlEventStore(o, 'iPhone', () => `i${++n}`, () => new Date());
    const fremd: number[] = [];
    mac.abonnieren(a => { if (a.fremd) fremd.push(a.events.length); });
    const stopp = mac.beobachten();
    iphone.anhaengen([{ typ: 'FristEntfernt', tags: ['aufgabe:a'], daten: { aufgabeId: 'a' } }]);
    // eigene Datei und Nicht-Event-Dateien werden ignoriert
    mac.anhaengen([{ typ: 'FristEntfernt', tags: ['aufgabe:b'], daten: { aufgabeId: 'b' } }]);
    writeFileSync(join(o, 'events', 'notiz.txt'), 'x');
    await new Promise(r => setTimeout(r, 900));
    stopp();
    expect(fremd).toEqual([1]);
    expect(mac.lesen().events).toHaveLength(2);
    expect(mac.einlesen(join(o, 'events', 'gibtsnicht.jsonl'))).toBe(0);
  });

  it('Gerätename wird zum Dateinamen; Events aus einer neueren Schema-Version werden übersprungen', () => {
    const o = join(ordner, 'daten2');
    const es = new JsonlEventStore(o, ' Mac von Ralf! ', () => 'x', () => new Date());
    expect(es.pfad.endsWith('mac-von-ralf.jsonl')).toBe(true);
    expect(new JsonlEventStore(join(ordner, 'daten3'), '***', () => 'y', () => new Date()).pfad.endsWith('geraet.jsonl')).toBe(true);
    writeFileSync(join(o, 'events', 'zukunft.jsonl'), JSON.stringify({ typ: 'FristEntfernt', tags: [], daten: { aufgabeId: 'a' }, id: 'z', zeit: '', meta: { schema: 99, geraet: 'z', hlc: hlcFormat(1, 0) } }) + '\n');
    expect(new JsonlEventStore(o, 'Mac von Ralf', () => 'x', () => new Date()).lesen().events).toHaveLength(0);
  });
});
