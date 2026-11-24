// Kalender am Phone ohne direkten Zugang: Mac legt Kalender-Stand ab, Phone liest ihn und erteilt Aufträge, Mac führt aus.
// Beide Geräte teilen hier einen Event Store (wie über die Dropbox abgeglichen).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Domain } from '../domain/domain';
import { speicherAnhaenge } from '../providers/anhaenge/datei';
import { speicherEinstellungen } from '../providers/einstellungen/json';
import { SpeicherEventStore } from '../providers/eventstore/speicher';
import { zaehlerIds } from '../providers/ids/ulid';
import { ablageKalender } from '../providers/kalender/ablage';
import { dateiKalenderAblage } from '../providers/kalender/ablage-datei';
import { fernKalenderAblage } from '../providers/kalender/ablage-fern';
import { kalenderCache } from '../providers/kalender/cache';
import { beispielKalender, type BeispielKalender } from '../providers/kalender/fake';
import type { KalenderAblage } from '../providers/kalender/interface';
import type { Uhr } from '../providers/uhr/interface';
import type { KalenderStand } from '../schema/extern';
import { RundblickBody } from './body';
import type { CommandStatus } from './interface';

let zeit = Date.parse('2026-11-16T09:00:00Z');
const uhr: Uhr = { jetzt: () => new Date(zeit), heute: () => '2026-11-16', minuteDesTages: () => 600 };
const id = (r: CommandStatus, k: string) => (r.ok ? r.ids![k]! : '');

function speicherAblage(): KalenderAblage & { m: Map<string, KalenderStand> } {
  const m = new Map<string, KalenderStand>();
  return { m, veroeffentlichen: async s => { m.set(s.geraet, structuredClone(s)); }, staende: async () => [...m.values()] };
}

let es: SpeicherEventStore, ablage: ReturnType<typeof speicherAblage>, quelle: BeispielKalender, mac: RundblickBody, phone: RundblickBody;
beforeEach(() => {
  zeit = Date.parse('2026-11-16T09:00:00Z');
  es = new SpeicherEventStore('t', zaehlerIds('e').neu, () => uhr.jetzt());
  ablage = speicherAblage();
  quelle = beispielKalender('erlaubt', () => new Date(zeit).toISOString());
  const geteilt = { uhr, einstellungen: speicherEinstellungen(), anhaenge: speicherAnhaenge(), ablage };
  mac = new RundblickBody({ ...geteilt, domain: new Domain(es), ids: zaehlerIds('m'), kalender: quelle, cache: kalenderCache(), info: { datenordner: '/d', geraet: 'mac-a' } });
  mac.einrichten();
  phone = new RundblickBody({ ...geteilt, einstellungen: speicherEinstellungen(), domain: new Domain(es), ids: zaehlerIds('p'), kalender: ablageKalender(ablage, 0), cache: kalenderCache(), info: { datenordner: '/d', geraet: 'iphone' } });
});
const tag = async (b: RundblickBody, d: string) => (await b.zeitraum({ von: d, bis: d })).tage[0]!;
/** Hintergrund-Nachladen abwarten (nach ausgeführten Aufträgen liest der Mac noch einmal) */
const ruhe = () => new Promise(r => setTimeout(r, 0));
const beide = async () => { await mac.synchronisieren(); await ruhe(); await phone.synchronisieren(); };

describe('Kalender aus der Ablage', () => {
  it('Mac legt den Stand ab, das Phone zeigt die externen Termine und weiß, woher', async () => {
    expect(await phone.synchronisieren()).toMatchObject({ ok: false }); // noch kein Stand
    await beide();
    expect(ablage.m.get('mac-a')).toMatchObject({ geraet: 'mac-a', kalender: expect.any(Array) });
    expect((await tag(phone, '2026-11-16')).extern.map(e => e.titel)).toContain('Jour fixe');
    expect((await phone.einstellungen()).kalenderquelle).toMatchObject({ art: 'ablage', herkunft: { geraet: 'mac-a' }, offeneAuftraege: 0, fehler: [] });
    expect((await mac.einstellungen()).kalenderquelle.art).toBe('direkt');
  });

  it('Spiegeln vom Phone: wartet, bis der Mac es ausführt; Änderungen am Phone holt der Mac-Abgleich nach; Löschen räumt extern auf', async () => {
    await beide();
    const b = id(await phone.buchungEintragen({ titel: 'Arzt', datum: '2026-11-18', start: '10:00' }), 'buchungId');
    expect(await phone.buchungSpiegeln({ buchungId: b, kalenderId: 'arbeit' })).toEqual({ ok: true });
    expect(await phone.buchungSpiegeln({ buchungId: b, kalenderId: 'arbeit' })).toMatchObject({ ok: false, fehler: ['Das Spiegeln ist schon beauftragt.'] });
    expect((await phone.buchung({ buchungId: b }))!.spiegel).toMatchObject({ kalender: 'Arbeit', wartet: true });
    expect((await phone.einstellungen()).kalenderquelle.offeneAuftraege).toBe(1);
    await beide();
    expect((await phone.buchung({ buchungId: b }))!.spiegel).toEqual({ kalender: 'Arbeit', konto: 'Google', farbe: expect.any(String), ursprung: 'rundblick' });
    expect(quelle.extern.alle().map(e => e.titel)).toEqual(['Arzt']);
    // Änderung am Phone → der Mac schreibt sie beim Abgleich hinaus
    zeit += 60_000; await phone.buchungAendern({ buchungId: b, titel: 'Zahnarzt' });
    await beide();
    expect(quelle.extern.alle().map(e => e.titel)).toEqual(['Zahnarzt']);
    // Löschen am Phone → Auftrag → der Mac löscht den externen Termin
    await phone.buchungStornieren({ buchungId: b });
    await beide();
    expect(quelle.extern.alle()).toEqual([]);
  });

  it('Verschieben und Löschen externer Termine vom Phone; ein neuer Auftrag ersetzt den offenen', async () => {
    await beide();
    const jf = (await tag(phone, '2026-11-16')).extern.find(e => e.titel === 'Jour fixe')!;
    expect(await phone.externVerschieben({ externId: jf.id, datum: '2026-11-17', start: '14:00' })).toEqual({ ok: true, ids: { externId: jf.id } });
    expect(await phone.externVerschieben({ externId: jf.id, datum: '2026-11-17', start: '15:00' })).toMatchObject({ ok: true });
    expect((await tag(phone, '2026-11-16')).extern.some(e => e.titel === 'Jour fixe')).toBe(false);
    expect((await tag(phone, '2026-11-17')).extern.find(e => e.titel === 'Jour fixe')).toMatchObject({ start: 15 * 60, wartet: true });
    const yoga = (await tag(phone, '2026-11-17')).extern.find(e => e.titel === 'Yoga')!;
    expect(await phone.externLoeschen({ externId: yoga.id })).toMatchObject({ ok: true });
    expect((await tag(phone, '2026-11-17')).extern.some(e => e.titel === 'Yoga')).toBe(false);
    await beide();
    expect((await tag(phone, '2026-11-17')).extern.find(e => e.titel === 'Jour fixe')).toMatchObject({ start: 15 * 60 });
    expect((await tag(phone, '2026-11-17')).extern.find(e => e.titel === 'Jour fixe')!.wartet).toBeUndefined();
    expect((await tag(phone, '2026-11-17')).extern.some(e => e.titel === 'Yoga')).toBe(false);
    expect((await phone.einstellungen()).kalenderquelle.offeneAuftraege).toBe(0);
  });

  it('Fehlschläge: Kalender auf dem Mac unbekannt, Termin weg, Buchung nicht spiegelbar – sichtbar am Phone', async () => {
    await beide();
    const b = id(await phone.buchungEintragen({ titel: 'X', datum: '2026-11-18', start: '10:00' }), 'buchungId');
    await phone.buchungSpiegeln({ buchungId: b, kalenderId: 'arbeit' });
    const jf = (await tag(phone, '2026-11-16')).extern.find(e => e.titel === 'Jour fixe')!;
    await phone.externLoeschen({ externId: jf.id });
    quelle.vorkommenLoeschen = async () => false;
    const echt = quelle.kalender;
    quelle.kalender = async () => (await echt()).filter(k => k.id !== 'arbeit');
    await mac.synchronisieren(); await ruhe();
    expect((await phone.buchung({ buchungId: b }))!.hinweis).toContain('Spiegeln fehlgeschlagen');
    const q = (await phone.einstellungen()).kalenderquelle;
    expect(q.fehler.map(f => f.art).sort()).toEqual(['loeschen', 'spiegeln']);
    // Buchung inzwischen ohne Uhrzeit → nicht mehr spiegelbar
    quelle.kalender = echt;
    await phone.buchungSpiegeln({ buchungId: b, kalenderId: 'arbeit' });
    await phone.buchungAendern({ buchungId: b, start: null });
    await mac.synchronisieren(); await ruhe();
    expect((await phone.buchung({ buchungId: b }))!.hinweis).toContain('nicht (mehr) spiegeln');
  });

  it('nur ein Mac führt aus: der alphabetisch erste mit frischem Stand', async () => {
    await beide();
    const jf = (await tag(phone, '2026-11-16')).extern.find(e => e.titel === 'Jour fixe')!;
    await phone.externLoeschen({ externId: jf.id });
    ablage.m.set('mac-0', { geraet: 'mac-0', zeit: new Date(zeit).toISOString(), von: '2026-11-01', bis: '2026-11-30', kalender: [], termine: [] });
    await mac.synchronisieren(); await ruhe();
    expect((await phone.einstellungen()).kalenderquelle.offeneAuftraege).toBe(1); // mac-0 ist dran
    zeit += 20 * 60_000; // mac-0 schweigt seit 20 min
    await mac.synchronisieren(); await ruhe();
    expect((await phone.einstellungen()).kalenderquelle.offeneAuftraege).toBe(0);
  });

  it('Ablage-Kalender: ohne Stand nicht verfügbar, schreibt nie selbst; Fehler beim Lesen halten den letzten Stand', async () => {
    const leer = ablageKalender({ veroeffentlichen: async () => {}, staende: async () => [] });
    expect(leer.art).toBe('ablage');
    expect(await leer.zugriff()).toBe('nichtVerfuegbar');
    expect(await leer.kalender()).toEqual([]);
    expect(leer.herkunft!()).toBeNull();
    await expect(leer.terminAnlegen('k', { titel: '', notiz: '', datum: '2026-11-16', start: '10:00', dauer: 30 })).rejects.toThrow();
    expect(leer.beiAenderung(() => {})).toBeTypeOf('function');
    let kaputt = false;
    const st: KalenderStand = { geraet: 'mac-a', zeit: '2026-11-16T09:00:00Z', von: '2026-11-01', bis: '2026-11-30', kalender: [], termine: [] };
    const q = ablageKalender({ veroeffentlichen: async () => {}, staende: async () => { if (kaputt) throw new Error('offline'); return [st]; } }, 0);
    expect(await q.zugriff()).toBe('erlaubt');
    kaputt = true;
    expect(await q.zugriff()).toBe('erlaubt');
  });

  it('Datei- und Fern-Ablage speichern und lesen Stände', async () => {
    const st: KalenderStand = { geraet: 'mac-a', zeit: '2026-11-16T09:00:00Z', von: '2026-11-01', bis: '2026-11-30', kalender: [], termine: [] };
    const ordner = mkdtempSync(join(tmpdir(), 'rb-ablage-'));
    const d = dateiKalenderAblage(ordner);
    expect(await d.staende()).toEqual([]);
    await d.veroeffentlichen(st);
    expect(await d.staende()).toEqual([st]);
    const dateien = new Map<string, Uint8Array>([['kaputt.json', new TextEncoder().encode('{')], ['.tmp.json', new Uint8Array()]]);
    const f = fernKalenderAblage({ auflisten: async () => [...dateien.keys(), 'fehlt.json'], lesen: async n => dateien.get(n) ?? null, schreiben: async (n, x) => { dateien.set(n, x); } });
    await f.veroeffentlichen(st);
    expect(await f.staende()).toEqual([st]);
  });

  it('Domain lehnt unvollständige Aufträge ab; Erledigen ist einmalig', async () => {
    const dom = new Domain(es);
    const k = { id: 'arbeit', name: 'Arbeit', konto: 'Google' };
    expect(dom.kalenderauftragErteilen({ auftragId: 'a', art: 'spiegeln', buchungId: 'gibts-nicht', kalender: k })).toMatchObject({ ok: false });
    expect(dom.kalenderauftragErteilen({ auftragId: 'a', art: 'loeschen', kalender: k })).toMatchObject({ ok: false, fehler: ['Termin fehlt.'] });
    const t = { terminId: 't', titel: 'T', datum: '2026-11-16', start: '10:00', dauer: 30 };
    expect(dom.kalenderauftragErteilen({ auftragId: 'a', art: 'verschieben', kalender: k, termin: t })).toMatchObject({ ok: false, fehler: ['Ziel fehlt.'] });
    expect(dom.kalenderauftragErteilen({ auftragId: 'a', art: 'loeschen', kalender: k, termin: t })).toMatchObject({ ok: true });
    expect(dom.kalenderauftragErteilen({ auftragId: 'a', art: 'loeschen', kalender: k, termin: t })).toMatchObject({ ok: false, fehler: ['Auftrag existiert bereits.'] });
    expect(dom.kalenderauftragErledigen({ auftragId: 'x', ok: true, meldung: '', geraet: 'g' })).toMatchObject({ ok: false });
    expect(dom.kalenderauftragErledigen({ auftragId: 'a', ok: true, meldung: '', geraet: 'g' })).toMatchObject({ ok: true });
    expect(dom.kalenderauftragErledigen({ auftragId: 'a', ok: false, meldung: 'x', geraet: 'g' })).toEqual({ ok: true });
    expect(dom.kalenderauftraege()[0]!.erledigt).toMatchObject({ ok: true });
    const b = id(await mac.buchungEintragen({ titel: 'R', datum: '2026-11-18' }), 'buchungId');
    expect(dom.kalenderauftragErteilen({ auftragId: 'b', art: 'spiegeln', buchungId: b, kalender: k })).toMatchObject({ ok: false, fehler: [expect.stringContaining('Uhrzeit')] });
    const c = id(await mac.buchungEintragen({ titel: 'R', datum: '2026-11-18', start: '09:00' }), 'buchungId');
    expect(dom.kalenderauftragErteilen({ auftragId: 'c', art: 'spiegeln', buchungId: c, kalender: { ...k, id: '' } })).toMatchObject({ ok: false, fehler: ['Kalender fehlt.'] });
  });
});
