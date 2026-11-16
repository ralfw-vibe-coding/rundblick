import { mkdtempSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NeuesEvent } from '../../schema/events';
import { Hlc, hlcFormat } from './hlc';
import type { EventStore } from './interface';
import { JsonlEventStore } from './jsonl';
import { SpeicherEventStore } from './speicher';

const ev = (titel: string, id = titel): NeuesEvent => ({
  typ: 'AufgabeErfasst', tags: [`aufgabe:${id}`],
  daten: { aufgabeId: id, titel, beschreibung: '', ort: '', verantwortlich: '', tags: [], frist: null, wiedervorlage: null, status: null },
});

let n = 0;
const ids = () => `e${++n}`;
let uhrMs = Date.parse('2026-11-16T10:00:00Z');
const uhr = () => new Date(uhrMs);

const ordner: string[] = [];
afterEach(() => { ordner.splice(0).forEach(o => rmSync(o, { recursive: true, force: true })); });
const tmp = () => { const o = mkdtempSync(join(tmpdir(), 'rb-')); ordner.push(o); return o; };

const varianten: [string, () => EventStore][] = [
  ['Speicher', () => new SpeicherEventStore('mac', ids, uhr)],
  ['JSONL', () => new JsonlEventStore(tmp(), 'mac', ids, uhr)],
];

describe.each(varianten)('EventStore-Vertrag: %s', (_name, neu) => {
  it('hängt an und liest in Reihenfolge', () => {
    const es = neu();
    es.anhaengen([ev('a'), ev('b')]);
    es.anhaengen([ev('c')]);
    const r = es.lesen();
    expect(r.events.map(e => (e.daten as { titel: string }).titel)).toEqual(['a', 'b', 'c']);
    expect(r.events.map(e => e.position)).toEqual([1, 2, 3]);
    expect(r.position).toBe(3);
  });

  it('filtert nach Tags und Typen', () => {
    const es = neu();
    es.anhaengen([ev('a'), ev('b')]);
    expect(es.lesen({ tags: ['aufgabe:b'] }).events).toHaveLength(1);
    expect(es.lesen({ typen: ['AufgabeUmbenannt'] }).events).toHaveLength(0);
    expect(es.lesen({ typen: ['AufgabeErfasst'], tags: ['aufgabe:a', 'aufgabe:b'] }).events).toHaveLength(2);
  });

  it('bedingtes Anhängen schlägt bei konkurrierendem Event fehl', () => {
    const es = neu();
    es.anhaengen([ev('a')]);
    const { position } = es.lesen({ tags: ['aufgabe:a'] });
    es.anhaengen([ev('a2', 'a')]);
    expect(es.anhaengen([ev('x', 'a')], { abfrage: { tags: ['aufgabe:a'] }, nachPosition: position }).ok).toBe(false);
    // ein unbeteiligtes Event stört nicht
    const p2 = es.lesen({ tags: ['aufgabe:a'] }).position;
    es.anhaengen([ev('b')]);
    expect(es.anhaengen([ev('y', 'a')], { abfrage: { tags: ['aufgabe:a'] }, nachPosition: p2 }).ok).toBe(true);
  });

  it('meldet neue Events an Abonnenten', () => {
    const es = neu();
    const gemeldet: number[] = [];
    es.abonnieren(a => gemeldet.push(a.events.length));
    es.anhaengen([ev('a'), ev('b')]);
    expect(gemeldet).toEqual([2]);
  });

  it('vergibt monotone HLC-Zeitstempel, auch bei stehender Uhr', () => {
    const es = neu();
    es.anhaengen([ev('a'), ev('b'), ev('c')]);
    const h = es.lesen().events.map(e => e.meta.hlc);
    expect([...h].sort()).toEqual(h);
    expect(new Set(h).size).toBe(3);
  });
});

describe('JSONL-Store', () => {
  it('liest nach Neustart alles wieder ein', () => {
    const o = tmp();
    new JsonlEventStore(o, 'mac', ids, uhr).anhaengen([ev('a'), ev('b')]);
    const es2 = new JsonlEventStore(o, 'mac', ids, uhr);
    expect(es2.lesen().events).toHaveLength(2);
  });

  it('schreibt nur in die eigene Gerätedatei und mischt fremde Dateien nach HLC ein', () => {
    const o = tmp();
    const mac = new JsonlEventStore(o, 'Mac Ralf', ids, uhr);
    // ein „iPhone“ (Uhr geht 500 ms nach) hat den Mac-Stand noch nicht gesehen
    const iphone = new JsonlEventStore(o, 'iPhone', ids, () => new Date(uhrMs - 500));
    uhrMs += 1000;
    mac.anhaengen([ev('mac1')]);
    iphone.anhaengen([ev('iphone1')]);
    expect(readFileSync(mac.pfad, 'utf8')).toContain('mac1');
    expect(readFileSync(mac.pfad, 'utf8')).not.toContain('iphone1');
    const gemeldet: boolean[] = [];
    mac.abonnieren(a => gemeldet.push(a.fremd));
    expect(mac.einlesen(iphone.pfad)).toBe(1);
    expect(gemeldet).toEqual([true]);
    // das iPhone-Event ist älter (HLC) und steht deshalb vorn
    expect(mac.lesen().events.map(e => (e.daten as { titel: string }).titel)).toEqual(['iphone1', 'mac1']);
    // nach dem Sehen des fremden Events liegt jedes neue Mac-Event dahinter
    mac.anhaengen([ev('mac2')]);
    expect(mac.lesen().events.at(-1)!.daten).toMatchObject({ titel: 'mac2' });
  });

  it('überspringt unvollständige Zeilen', () => {
    const o = tmp();
    const es = new JsonlEventStore(o, 'mac', ids, uhr);
    es.anhaengen([ev('a')]);
    appendFileSync(join(o, 'events', 'iphone.jsonl'), '{"typ":"Aufg');
    expect(new JsonlEventStore(o, 'mac', ids, uhr).lesen().events).toHaveLength(1);
  });
});

describe('Hybrid Logical Clock', () => {
  it('bleibt nach dem Sehen eines Zeitstempels aus der Zukunft monoton', () => {
    const c = new Hlc(() => 1000);
    c.sehen(hlcFormat(5000, 3));
    expect(c.neu()).toBe(hlcFormat(5000, 4));
    expect(c.neu()).toBe(hlcFormat(5000, 5));
  });
  it('folgt der Wanduhr, wenn diese vorn liegt', () => {
    let t = 1000;
    const c = new Hlc(() => t);
    c.neu(); t = 2000;
    expect(c.neu()).toBe(hlcFormat(2000, 0));
  });
});
