// Spiegelung Buchung ↔ Google/iCloud: Abgleich-Regeln und Abläufe im Body (gegen den Beispielkalender).
import { describe, expect, it } from 'vitest';
import { Domain } from '../domain/domain';
import type { BuchungZ } from '../domain/interface';
import { speicherAnhaenge } from '../providers/anhaenge/datei';
import { speicherEinstellungen } from '../providers/einstellungen/json';
import { SpeicherEventStore } from '../providers/eventstore/speicher';
import { zaehlerIds } from '../providers/ids/ulid';
import { kalenderCache } from '../providers/kalender/cache';
import { beispielKalender } from '../providers/kalender/fake';
import type { Uhr } from '../providers/uhr/interface';
import type { ExternerTermin } from '../schema/extern';
import { RundblickBody } from './body';
import type { CommandStatus } from './interface';
import { abgleich, ausBuchung, fingerabdruck } from './spiegel/abgleich';

// ---------------- pure Regeln ----------------
const buchung = (x: Partial<BuchungZ> = {}): BuchungZ => ({
  id: 'b', aufgabeId: null, titel: 'Call', beschreibung: '', datum: '2026-11-19', dauer: 60, start: '10:00', belegt: true, storniert: false,
  verknuepfung: null, hinweis: null, zuletzt: '2026-11-18T10:00:00Z', ...x,
});
const STAND = fingerabdruck(ausBuchung(buchung()));
const verknuepft = (x: Partial<BuchungZ> = {}) => buchung({ verknuepfung: { kalenderId: 'k', kalender: 'K', konto: 'G', farbe: '#000', externeUid: 'u', stand: STAND, ursprung: 'rundblick' }, ...x });
const extern = (x: Partial<ExternerTermin> = {}): ExternerTermin => ({ id: 'e', kalenderId: 'k', titel: 'Call', datum: '2026-11-19', start: '10:00', dauer: 60, ort: '', uid: 'u', notiz: '', geaendert: '2026-11-18T09:00:00Z', ...x });

describe('Abgleich (pure)', () => {
  it.each([
    ['nicht verknüpft', buchung(), extern(), 'nichts'],
    ['extern gelöscht', verknuepft(), null, 'geloest'],
    ['extern ganztägig gemacht', verknuepft(), extern({ start: null }), 'nichts'],
    ['beide unverändert', verknuepft(), extern(), 'nichts'],
    ['nur Rundblick geändert', verknuepft({ titel: 'Neu' }), extern(), 'nachExtern'],
    ['nur extern geändert', verknuepft(), extern({ dauer: 30 }), 'vonExtern'],
    ['beide gleich geändert → nur Stand', verknuepft({ dauer: 30 }), extern({ dauer: 30 }), 'stand'],
    ['beide geändert, extern jünger', verknuepft({ titel: 'A' }), extern({ titel: 'B', geaendert: '2026-11-18T11:00:00Z' }), 'vonExtern'],
    ['beide geändert, Rundblick jünger', verknuepft({ titel: 'A', zuletzt: '2026-11-18T12:00:00Z' }), extern({ titel: 'B', geaendert: '2026-11-18T11:00:00Z' }), 'nachExtern'],
    ['beide geändert, extern ohne Zeit', verknuepft({ titel: 'A' }), extern({ titel: 'B', geaendert: null }), 'nachExtern'],
  ] as const)('%s → %s', (_n, b, e, art) => expect(abgleich(b, e).art).toBe(art));

  it('vonExtern liefert den externen Inhalt und dessen Stand', () => {
    const a = abgleich(verknuepft(), extern({ notiz: 'N' }));
    expect(a).toEqual({ art: 'vonExtern', inhalt: { titel: 'Call', notiz: 'N', datum: '2026-11-19', start: '10:00', dauer: 60 }, stand: fingerabdruck({ titel: 'Call', notiz: 'N', datum: '2026-11-19', start: '10:00', dauer: 60 }) });
  });
});

// ---------------- Abläufe im Body ----------------
let zeit = Date.parse('2026-11-18T10:00:00Z');
const uhr: Uhr = { jetzt: () => new Date(zeit), heute: () => '2026-11-18', minuteDesTages: () => 600 };
function aufbau() {
  const quelle = beispielKalender('erlaubt', () => new Date(zeit).toISOString());
  const es = new SpeicherEventStore('t', zaehlerIds('e').neu, () => uhr.jetzt());
  const domain = new Domain(es);
  const body = new RundblickBody({ domain, uhr, ids: zaehlerIds('x'), einstellungen: speicherEinstellungen(), kalender: quelle, cache: kalenderCache(), anhaenge: speicherAnhaenge(), info: { datenordner: '/d', geraet: 'g' } });
  body.einrichten();
  return { body, domain, quelle };
}
const id = (r: CommandStatus, k: string) => (r.ok ? r.ids![k]! : '');
const tag = async (body: RundblickBody, d = '2026-11-19') => (await body.zeitraum({ von: d, bis: d })).tage[0]!;

async function gespiegelterTermin() {
  const x = aufbau();
  await x.body.synchronisieren();
  const bid = id(await x.body.buchungEintragen({ titel: 'Call', datum: '2026-11-19', start: '10:00', dauer: 60 }), 'buchungId');
  expect(await x.body.buchungSpiegeln({ buchungId: bid, kalenderId: 'arbeit' })).toEqual({ ok: true });
  const uid = x.domain.buchung(bid)!.verknuepfung!.externeUid;
  return { ...x, bid, uid };
}

describe('Spiegelung im Body', () => {
  it('legt den externen Termin an, zeigt die Buchung mit Spiegel-Angabe und blendet den Doppelgänger aus', async () => {
    const { body, quelle, bid } = await gespiegelterTermin();
    expect(quelle.extern.alle()).toMatchObject([{ titel: 'Call', start: '10:00', dauer: 60, kalenderId: 'arbeit' }]);
    await body.synchronisieren();
    const t = await tag(body);
    expect(t.termine.find(b => b.id === bid)!.spiegel).toEqual({ kalender: 'Arbeit', konto: 'Google', farbe: '#2f7cf6', ursprung: 'rundblick' });
    expect(t.extern.some(e => e.titel === 'Call')).toBe(false);
  });

  it('lehnt Reservierungen, nicht beschreibbare Kalender, Doppeltes und Unbekanntes ab', async () => {
    const { body, bid } = await gespiegelterTermin();
    const r = id(await body.buchungEintragen({ titel: 'R', datum: '2026-11-19', dauer: 60 }), 'buchungId');
    expect(await body.buchungSpiegeln({ buchungId: r, kalenderId: 'arbeit' })).toMatchObject({ ok: false });
    expect(await body.buchungSpiegeln({ buchungId: bid, kalenderId: 'arbeit' })).toMatchObject({ ok: false });
    const t = id(await body.buchungEintragen({ titel: 'T', datum: '2026-11-19', start: '12:00' }), 'buchungId');
    expect(await body.buchungSpiegeln({ buchungId: t, kalenderId: 'familie' })).toMatchObject({ ok: false });
    expect(await body.buchungSpiegeln({ buchungId: 'gibtsnicht', kalenderId: 'arbeit' })).toMatchObject({ ok: false });
  });

  it('meldet einen Fehler der Kalenderquelle beim Anlegen', async () => {
    const { body, quelle } = aufbau();
    await body.synchronisieren();
    quelle.terminAnlegen = async () => { throw new Error('offline'); };
    const t = id(await body.buchungEintragen({ titel: 'T', datum: '2026-11-19', start: '12:00' }), 'buchungId');
    expect(await body.buchungSpiegeln({ buchungId: t, kalenderId: 'arbeit' })).toMatchObject({ ok: false, fehler: [expect.stringContaining('offline')] });
  });

  it('Rundblick → extern: Änderungen werden sofort geschrieben', async () => {
    const { body, quelle, bid, uid, domain } = await gespiegelterTermin();
    await body.buchungAendern({ buchungId: bid, start: '11:00', dauer: 30, beschreibung: 'Agenda' });
    expect(await quelle.terminLesen(uid)).toMatchObject({ start: '11:00', dauer: 30, notiz: 'Agenda' });
    expect(domain.buchung(bid)!.verknuepfung!.stand).toBe(fingerabdruck(ausBuchung(domain.buchung(bid)!)));
  });

  it('extern → Rundblick: Änderung von außen wird beim Abgleich übernommen', async () => {
    const { body, quelle, bid, uid, domain } = await gespiegelterTermin();
    zeit += 60_000;
    quelle.extern.aendern(uid, { titel: 'Von außen', start: '15:00' }, new Date(zeit).toISOString());
    await body.synchronisieren();
    expect(domain.buchung(bid)).toMatchObject({ titel: 'Von außen', start: '15:00' });
  });

  it('beide geändert: die jüngere Änderung gewinnt', async () => {
    const { body, quelle, bid, uid, domain } = await gespiegelterTermin();
    // Rundblick ändert ohne Rückschreiben (z. B. offline) …
    quelle.terminAendern = async () => { throw new Error('offline'); };
    zeit += 60_000; await body.buchungAendern({ buchungId: bid, titel: 'Rundblick' });
    // … danach ändert jemand extern (jünger)
    zeit += 60_000; quelle.extern.aendern(uid, { titel: 'Extern' }, new Date(zeit).toISOString());
    await body.synchronisieren();
    expect(domain.buchung(bid)!.titel).toBe('Extern');
  });

  it('extern gelöscht → Verknüpfung gelöst, Buchung bleibt mit Hinweis', async () => {
    const { body, quelle, bid, uid, domain } = await gespiegelterTermin();
    quelle.extern.loeschen(uid);
    await body.synchronisieren();
    expect(domain.buchung(bid)).toMatchObject({ verknuepfung: null, storniert: false });
    expect((await tag(body)).termine.find(b => b.id === bid)!.hinweis).toContain('gelöscht');
  });

  it('extern gelöscht und Rundblick ändert → Verknüpfung gelöst', async () => {
    const { body, quelle, bid, uid, domain } = await gespiegelterTermin();
    quelle.extern.loeschen(uid);
    await body.buchungAendern({ buchungId: bid, titel: 'Neu' });
    expect(domain.buchung(bid)!.verknuepfung).toBeNull();
  });

  it('außerhalb des geladenen Zeitraums wird per UID nachgelesen', async () => {
    const { body, quelle, domain } = aufbau();
    await body.synchronisieren();
    const bid = id(await body.buchungEintragen({ titel: 'Fern', datum: '2028-01-10', start: '09:00' }), 'buchungId');
    await body.buchungSpiegeln({ buchungId: bid, kalenderId: 'arbeit' });
    const uid = domain.buchung(bid)!.verknuepfung!.externeUid;
    zeit += 60_000; quelle.extern.aendern(uid, { dauer: 15 }, new Date(zeit).toISOString());
    await body.synchronisieren();
    expect(domain.buchung(bid)!.dauer).toBe(15);
  });

  it('Stornieren löscht den externen Eintrag mit; Lösen behält beide', async () => {
    const a = await gespiegelterTermin();
    await a.body.buchungStornieren({ buchungId: a.bid });
    expect(a.quelle.extern.alle()).toEqual([]);
    const b = await gespiegelterTermin();
    expect(await b.body.verknuepfungLoesen({ buchungId: b.bid })).toEqual({ ok: true });
    expect(b.domain.buchung(b.bid)).toMatchObject({ verknuepfung: null, hinweis: null });
    expect(b.quelle.extern.alle()).toHaveLength(1);
  });

  it('Löschen einer Buchung, deren Termin zuerst extern da war: externer Termin bleibt und erscheint wieder', async () => {
    const { body, domain, quelle } = aufbau();
    await body.synchronisieren();
    const e = await quelle.terminAnlegen('arbeit', { titel: 'Kundentermin', notiz: '', datum: '2026-11-20', start: '14:00', dauer: 60 });
    await body.synchronisieren();
    const x = (await tag(body, '2026-11-20')).extern.find(t => t.titel === 'Kundentermin')!;
    const a = id(await body.aufgabeAusExtern({ externId: x.id }), 'aufgabeId');
    const b = domain.buchungenDerAufgabe(a)[0]!;
    expect(b.verknuepfung!.ursprung).toBe('extern');
    expect((await tag(body, '2026-11-20')).termine.find(t => t.id === b.id)!.spiegel!.ursprung).toBe('extern');
    await body.buchungStornieren({ buchungId: b.id });
    expect(await quelle.terminLesen(e.uid!)).not.toBeNull();
    expect((await tag(body, '2026-11-20')).extern.some(t => t.titel === 'Kundentermin')).toBe(true);
  });

  it('externen Termin von Hand zur Aufgabe machen – verknüpft, Doppelgänger verschwindet', async () => {
    const { body, domain } = aufbau();
    await body.synchronisieren();
    const t0 = await tag(body, '2026-11-23');
    const jour = t0.extern.find(e => e.titel === 'Jour fixe')!;
    const r = await body.aufgabeAusExtern({ externId: jour.id });
    expect(r.ok).toBe(true);
    const a = domain.aufgabe(id(r, 'aufgabeId'))!;
    expect(a.titel).toBe('Jour fixe');
    const b = domain.buchungenDerAufgabe(a.id)[0]!;
    expect(b).toMatchObject({ start: '09:30', dauer: 30, verknuepfung: { kalender: 'Arbeit', externeUid: jour.id } });
    const t1 = await tag(body, '2026-11-23');
    expect(t1.extern.some(e => e.titel === 'Jour fixe')).toBe(false);
    expect(t1.termine.find(x => x.id === b.id)!.herkunft).toBe('liste');
    expect(await body.aufgabeAusExtern({ externId: jour.id })).toMatchObject({ ok: false });
    // ein Abgleich überschreibt nichts
    await body.synchronisieren();
    expect(domain.buchung(b.id)).toMatchObject({ titel: 'Jour fixe', start: '09:30' });
  });

  it('aufgabeAusExtern: unbekannt oder ganztägig wird abgelehnt', async () => {
    const { body } = aufbau();
    expect(await body.aufgabeAusExtern({ externId: 'x' })).toMatchObject({ ok: false });
    await body.synchronisieren();
    const ganz = (await tag(body, '2026-12-01')).extern.find(e => e.start === null)!;
    expect(await body.aufgabeAusExtern({ externId: ganz.id })).toMatchObject({ ok: false });
  });

  it('Einstellungen zeigen, welche Kalender beschreibbar sind', async () => {
    const { body } = aufbau();
    await body.synchronisieren();
    expect((await body.einstellungen()).kalender.map(k => [k.name, k.schreibbar])).toEqual([['Arbeit', true], ['Privat', true], ['Familie', false]]);
  });
});
