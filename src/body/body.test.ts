import { beforeEach, describe, expect, it } from 'vitest';
import { Domain } from '../domain/domain';
import { speicherAnhaenge } from '../providers/anhaenge/datei';
import { speicherEinstellungen } from '../providers/einstellungen/json';
import { SpeicherEventStore } from '../providers/eventstore/speicher';
import { zaehlerIds } from '../providers/ids/ulid';
import { kalenderCache } from '../providers/kalender/cache';
import { beispielKalender } from '../providers/kalender/fake';
import { festeUhr } from '../providers/uhr/system';
import { RundblickBody } from './body';
import type { Bereich } from './interface';
import { datumAusText, dauerAusText, parseErfassung } from './schnellerfassung/parse';

// Montag, 16.11.2026, 10:40 Uhr (lokal)
const uhr = festeUhr('2026-11-16T10:40:00');
let body: RundblickBody;
let gemeldet: Bereich[][];

beforeEach(() => {
  const es = new SpeicherEventStore('test', zaehlerIds('e').neu, () => uhr.jetzt());
  const domain = new Domain(es);
  body = new RundblickBody({
    domain, uhr, ids: zaehlerIds('x'), einstellungen: speicherEinstellungen(), kalender: beispielKalender(), cache: kalenderCache(), anhaenge: speicherAnhaenge(),
    info: { datenordner: '/tmp', geraet: 'test' },
  });
  body.einrichten();
  gemeldet = [];
  body.beiAenderung(b => gemeldet.push(b));
});

describe('Commands', () => {
  it('liefert die IDs neu angelegter Objekte und meldet die Änderung', async () => {
    const r = await body.aufgabeErfassen({ titel: 'Angebot', buchung: { datum: '2026-11-17' } });
    expect(r).toEqual({ ok: true, ids: { aufgabeId: 'x1', buchungId: 'x2' } });
    expect(gemeldet).toContainEqual(['aufgaben', 'board', 'kalender']);
  });

  it('gibt Fehler der Domain weiter', async () => {
    expect(await body.aufgabeErfassen({ titel: '' })).toMatchObject({ ok: false, fehler: ['Titel fehlt.'] });
  });

  it('Schnellerfassung: Aufgabe mit Tag, Frist, Status und Reservierung', async () => {
    await body.schnellErfassen({ text: 'Angebot Müller #kunde !fr =inarbeit >mi 2h' });
    const l = await body.liste({});
    const a = l.gruppen.find(g => g.art === 'woche')!.aufgaben[0]!;
    expect(a).toMatchObject({ titel: 'Angebot Müller', tags: ['kunde'], frist: '2026-11-20', status: { id: 'inarbeit', kategorie: 'begonnen' } });
    expect(a.buchungen).toEqual({ reservierungen: 1, termine: 0, gebucht: 120 });
  });

  it('Schnellerfassung mit führendem > legt nur eine freie Buchung an', async () => {
    await body.schnellErfassen({ text: '>fr 17:00 45m Friseur' });
    expect((await body.liste({})).offen).toBe(0);
    const z = await body.zeitraum({ von: '2026-11-20', bis: '2026-11-20' });
    expect(z.tage[0]!.termine[0]).toMatchObject({ titel: 'Friseur', aufgabeId: null, start: '17:00', dauer: 45 });
  });

  it('Schnellerfassung lehnt Unverstandenes ab', async () => {
    expect(await body.schnellErfassen({ text: 'Test !xyz' })).toMatchObject({ ok: false });
  });
});

describe('Liste und Board', () => {
  it('gruppiert nach Frist und blendet Zurückgestellte aus', async () => {
    await body.aufgabeErfassen({ titel: 'alt', frist: '2026-11-10' });
    await body.aufgabeErfassen({ titel: 'heute', frist: '2026-11-16' });
    await body.aufgabeErfassen({ titel: 'später', frist: '2026-12-01' });
    await body.aufgabeErfassen({ titel: 'ohne' });
    await body.aufgabeErfassen({ titel: 'versteckt', wiedervorlage: '2026-11-20' });
    const l = await body.liste({});
    expect(Object.fromEntries(l.gruppen.map(g => [g.art, g.aufgaben.map(a => a.titel)]))).toEqual({
      ueberfaellig: ['alt'], heute: ['heute'], woche: [], spaeter: ['später'], ohne: ['ohne'],
    });
    expect(l.zurueckgestellt.map(a => a.titel)).toEqual(['versteckt']);
    expect(l.offen).toBe(4);
  });

  it('Filter über Titel, #tag und @person', async () => {
    await body.aufgabeErfassen({ titel: 'A', tags: ['kunde'], verantwortlich: 'Ralf' });
    await body.aufgabeErfassen({ titel: 'B' });
    expect((await body.liste({ filter: '#kunde' })).offen).toBe(1);
    expect((await body.liste({ filter: '@ralf' })).offen).toBe(1);
  });

  it('abgeschlossene Aufgaben bleiben auf dem Board, verschwinden aber aus der Liste', async () => {
    const r = await body.aufgabeErfassen({ titel: 'Fertig', status: 'erledigt' });
    await body.aufgabeAbschliessen({ aufgabeId: (r as unknown as { ids: { aufgabeId: string } }).ids.aufgabeId });
    const b = await body.board();
    const erledigt = b.kategorien.find(k => k.id === 'beendet')!.spalten.find(s => s.id === 'erledigt')!;
    expect(erledigt.karten.map(k => [k.titel, k.abgeschlossen])).toEqual([['Fertig', true]]);
    const l = await body.liste({});
    expect(l.offen).toBe(0);
    expect(l.abgeschlossen.map(a => a.titel)).toEqual(['Fertig']);
  });
});

describe('Zeitraum und Kapazität', () => {
  it('führt eigene Buchungen, externe Termine und Auslastung zusammen', async () => {
    await body.synchronisieren();
    await body.aufgabeErfassen({ titel: 'Angebot', buchung: { datum: '2026-11-16', dauer: 120 } });
    await body.buchungEintragen({ titel: 'Call', datum: '2026-11-16', start: '14:00', dauer: 60 });
    // „Arbeit“ belegt Kapazität, „Privat“ nicht
    await body.kalenderEinstellen({ kalenderId: 'arbeit', belegt: true });
    const tag = (await body.zeitraum({ von: '2026-11-16', bis: '2026-11-16' })).tage[0]!;
    expect(tag.reservierungen.map(r => r.titel)).toEqual(['Angebot']);
    expect(tag.termine.map(t => [t.titel, t.s, t.e])).toEqual([['Call', 840, 900]]);
    expect(tag.extern.map(e => e.titel)).toEqual(['Jour fixe']);
    expect(tag.auslastung).toEqual({ belegt: 210, eigene: 180, extern: 30, nichtBelegend: 0, kapazitaet: 360 });
  });

  it('unsichtbare Kalender verschwinden, nicht belegende zählen nur als Info', async () => {
    await body.synchronisieren();
    const di = async () => (await body.zeitraum({ von: '2026-11-17', bis: '2026-11-17' })).tage[0]!;
    expect((await di()).auslastung).toMatchObject({ belegt: 0, nichtBelegend: 75 });
    await body.kalenderEinstellen({ kalenderId: 'privat', sichtbar: false });
    expect((await di()).extern).toEqual([]);
  });

  it('nicht belegende Buchung zählt nicht zur Auslastung; Dauer ist änderbar', async () => {
    const r = await body.buchungEintragen({ titel: 'Zahnarzt', datum: '2026-11-18', start: '08:30' });
    const id = (r as unknown as { ids: { buchungId: string } }).ids.buchungId;
    await body.buchungAendern({ buchungId: id, belegt: false, dauer: 45 });
    const b = await body.buchung({ buchungId: id });
    expect(b).toMatchObject({ dauer: 45, belegt: false, tag: { eigene: 0 } });
  });

  it('Fristen und Wiedervorlagen erscheinen an ihrem Tag', async () => {
    await body.aufgabeErfassen({ titel: 'Fällig', frist: '2026-11-18' });
    await body.aufgabeErfassen({ titel: 'Kommt wieder', wiedervorlage: '2026-11-18' });
    const t = (await body.zeitraum({ von: '2026-11-18', bis: '2026-11-18' })).tage[0]!;
    expect(t.fristen).toEqual([{ aufgabeId: 'x1', titel: 'Fällig', dringlichkeit: 'woche' }]);
    expect(t.wiedervorlagen.map(w => w.titel)).toEqual(['Kommt wieder']);
  });

  it('aus Buchung wird Aufgabe', async () => {
    const r = await body.buchungEintragen({ titel: 'Belege', datum: '2026-11-18' });
    const id = (r as unknown as { ids: { buchungId: string } }).ids.buchungId;
    const a = await body.aufgabeAusBuchung({ buchungId: id, status: 'backlog' });
    expect(a.ok).toBe(true);
    expect((await body.board()).kategorien[0]!.spalten.find(s => s.id === 'backlog')!.karten.map(k => k.titel)).toEqual(['Belege']);
  });
});

describe('Nachladen externer Termine', () => {
  it('lädt außerhalb des Fensters nach, aber höchstens ±2 Jahre um heute', async () => {
    const quelle = beispielKalender();
    const abfragen: [string, string][] = [];
    const orig = quelle.termine;
    quelle.termine = (von, bis) => { abfragen.push([von, bis]); return orig(von, bis); };
    const es = new SpeicherEventStore('t', zaehlerIds('e').neu, () => uhr.jetzt());
    const b = new RundblickBody({ domain: new Domain(es), uhr, ids: zaehlerIds('x'), einstellungen: speicherEinstellungen(), kalender: quelle, cache: kalenderCache(), anhaenge: speicherAnhaenge(), info: { datenordner: '', geraet: '' } });
    await b.synchronisieren();
    await b.zeitraum({ von: '2000-01-01', bis: '2000-01-02' });
    await b.zeitraum({ von: '2027-08-01', bis: '2027-08-31' });
    await new Promise(r => setTimeout(r, 10));
    expect(abfragen.every(([von]) => von >= '2024-11-16')).toBe(true);
    expect(abfragen).toHaveLength(2);
    expect(abfragen.at(-1)![1]).toBe('2027-08-31');
  });
});

describe('Einstellungen', () => {
  it('liefert Spalten, Kapazität, Standarddauer und Kalender', async () => {
    await body.synchronisieren();
    await body.standarddauerFestlegen({ minuten: 45 });
    const e = await body.einstellungen();
    expect(e.spalten).toHaveLength(7);
    expect(e.standarddauer).toBe(45);
    expect(e.kalender.map(k => [k.name, k.sichtbar, k.belegt])).toEqual([['Arbeit', true, false], ['Privat', true, false], ['Familie', true, false]]);
    expect(e.zugriff).toBe('erlaubt');
  });

  it('meldet fehlenden Kalenderzugriff', async () => {
    const es = new SpeicherEventStore('t', zaehlerIds('e').neu, () => uhr.jetzt());
    const b = new RundblickBody({
      domain: new Domain(es), uhr, ids: zaehlerIds('x'), einstellungen: speicherEinstellungen(),
      kalender: beispielKalender('verweigert'), cache: kalenderCache(), anhaenge: speicherAnhaenge(), info: { datenordner: '', geraet: '' },
    });
    expect(await b.synchronisieren()).toMatchObject({ ok: false });
    expect((await b.einstellungen()).zugriff).toBe('verweigert');
  });
});

describe('Parser der Schnellerfassung', () => {
  const H = '2026-11-16';
  it.each([
    ['heute', '2026-11-16'], ['morgen', '2026-11-17'], ['üm', '2026-11-18'], ['fr', '2026-11-20'], ['mo', '2026-11-16'],
    ['freitag', '2026-11-20'], ['+3', '2026-11-19'], ['+2w', '2026-11-30'], ['24.12.', '2026-12-24'], ['5.1.', '2027-01-05'],
    ['31.2.', null], ['xyz', null], ['2026-12-01', '2026-12-01'],
  ])('Datum %s → %s', (t, erwartet) => expect(datumAusText(t, H)).toBe(erwartet));

  it.each([['2h', 120], ['90m', 90], ['1,5h', 90], ['45min', 45], ['0m', null], ['abc', null]])('Dauer %s → %s', (t, m) => expect(dauerAusText(t)).toBe(m));

  it('erkennt alle Bestandteile', () => {
    const p = parseErfassung('Call Jan >morgen 14:00 45m =inarbeit @Jan /Hamburg_Mitte #kunde ^+2w !24.12.', H, [{ id: 'inarbeit', name: 'In Arbeit' }], 60);
    expect(p).toEqual({
      titel: 'Call Jan', tags: ['kunde'], verantwortlich: 'Jan', ort: 'Hamburg Mitte', frist: '2026-12-24', wiedervorlage: '2026-11-30',
      status: 'inarbeit', buchung: { datum: '2026-11-17', start: '14:00', dauer: 45 }, nurBuchung: false, fehler: [],
    });
  });

  it('Standarddauer, wenn keine Dauer angegeben ist', () => {
    expect(parseErfassung('X >do', H, [], 30).buchung).toEqual({ datum: '2026-11-19', start: null, dauer: 30 });
  });
});
