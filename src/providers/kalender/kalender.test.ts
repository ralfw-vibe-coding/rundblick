import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { kalenderCache } from './cache';
import { eventKitKalender } from './eventkit';
import { beispielKalender } from './fake';

const HELFER = resolve(import.meta.dirname, 'testdaten/ersatz-helfer.mjs');
const ordner = mkdtempSync(join(tmpdir(), 'rb-kal-'));
afterAll(() => rmSync(ordner, { recursive: true, force: true }));

describe('EventKit-Kalenderquelle (gegen Ersatz-Helfer)', () => {
  it('spricht das Protokoll: Zugriff, Kalender, Termine, Änderungsereignis', async () => {
    const q = eventKitKalender(HELFER);
    let geaendert = 0;
    const ab = q.beiAenderung(() => geaendert++);
    expect(await q.zugriff()).toBe('erlaubt');
    expect(await q.kalender()).toEqual([{ id: 'k1', name: 'Arbeit', konto: 'iCloud', farbe: '#ff0000' }]);
    expect(await q.termine('2026-11-16', '2026-11-20')).toMatchObject([{ id: 't1', datum: '2026-11-16' }]);
    expect(geaendert).toBe(1);
    ab();
    q.beenden();
  });

  it('Spiegelung: anlegen, ändern, löschen, lesen per UID', async () => {
    const q = eventKitKalender(HELFER);
    const t = { titel: 'Call', notiz: 'N', datum: '2026-11-19', start: '10:00', dauer: 45 };
    expect(await q.terminAnlegen('k1', t)).toMatchObject({ uid: 'u1', titel: 'Call', start: '10:00', dauer: 45, notiz: 'N' });
    expect(await q.terminAendern('u1', { ...t, titel: 'Neu' })).toMatchObject({ uid: 'u1', titel: 'Neu' });
    expect(await q.terminAendern('fehlt', t)).toBeNull();
    expect(await q.terminLoeschen('u1')).toBe(true);
    expect(await q.terminLoeschen('fehlt')).toBe(false);
    expect(await q.terminLesen('u1')).toMatchObject({ uid: 'u1' });
    expect(await q.terminLesen('fehlt')).toBeNull();
    q.beenden();
  });

  it('meldet Fehlerantworten, Zeitüberschreitung und Prozessende als Fehler', async () => {
    const q = eventKitKalender(HELFER, { anfrage: 200, termine: 200, zugriff: 200 });
    await expect(q.termine('fehler', 'x')).rejects.toThrow('Helfer-Fehler');
    await expect(q.termine('still', 'x')).rejects.toThrow('antwortet nicht');
    await expect(q.termine('ende', 'x')).rejects.toThrow('beendet');
    // nach dem Ende startet der Helfer bei der nächsten Anfrage neu
    expect(await q.kalender()).toHaveLength(1);
    q.beenden();
  });

  it('ohne Helfer: nicht verfügbar', async () => {
    const q = eventKitKalender('/gibt/es/nicht');
    expect(await q.zugriff()).toBe('nichtVerfuegbar');
    await expect(q.kalender()).rejects.toThrow('nicht gefunden');
    q.beenden();
  });

  it('Zugriff: Helfer stirbt → nicht verfügbar', async () => {
    const kaputt = join(ordner, 'kaputt.sh');
    writeFileSync(kaputt, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    expect(await eventKitKalender(kaputt).zugriff()).toBe('nichtVerfuegbar');
  });
});

describe('Kalender-Cache', () => {
  const k = [{ id: 'k', name: 'K', konto: 'iCloud', farbe: '#000' }];
  const t = (id: string, datum: string) => ({ id, kalenderId: 'k', titel: id, datum, start: null, dauer: 0, ort: '' });

  it('ersetzt einen Bereich, behält den Rest und erweitert das Fenster', () => {
    const c = kalenderCache();
    expect(c.stand()).toEqual({ zuletzt: null, von: null, bis: null });
    c.ersetzen('2026-11-01', '2026-11-30', k, [t('a', '2026-11-05'), t('b', '2026-11-20')]);
    c.ersetzen('2026-11-15', '2026-12-31', k, [t('c', '2026-12-02')]);
    expect(c.termine('2026-11-01', '2026-12-31').map(x => x.id)).toEqual(['a', 'c']);
    expect(c.stand()).toMatchObject({ von: '2026-11-01', bis: '2026-12-31' });
    c.ersetzen('2026-11-10', '2026-11-12', k, []);
    expect(c.stand()).toMatchObject({ von: '2026-11-01', bis: '2026-12-31' });
    expect(c.kalender()).toEqual(k);
  });

  it('überlebt einen Neustart über die Datei; kaputte Datei → leer', () => {
    const datei = join(ordner, 'cache', 'kalender.json');
    kalenderCache(datei).ersetzen('2026-11-01', '2026-11-30', k, [t('a', '2026-11-05')]);
    expect(kalenderCache(datei).termine('2026-11-01', '2026-11-30')).toHaveLength(1);
    writeFileSync(datei, '{kaputt');
    expect(kalenderCache(datei).kalender()).toEqual([]);
  });
});

describe('Beispiel-Kalender', () => {
  it('spiegelt Termine im Speicher und simuliert Änderungen von außen', async () => {
    const q = beispielKalender('erlaubt', () => '2026-11-18T10:00:00Z');
    const t = { titel: 'Call', notiz: '', datum: '2026-11-19', start: '10:00', dauer: 60 };
    await expect(q.terminAnlegen('familie', t)).rejects.toThrow('nicht beschreibbar');
    const e = await q.terminAnlegen('arbeit', t);
    expect((await q.termine('2026-11-19', '2026-11-19')).some(x => x.uid === e.uid)).toBe(true);
    expect(await q.terminAendern(e.uid!, { ...t, dauer: 30 })).toMatchObject({ dauer: 30 });
    expect(await q.terminAendern('fehlt', t)).toBeNull();
    q.extern.aendern(e.uid!, { titel: 'Von außen' }, '2026-11-18T11:00:00Z');
    q.extern.aendern('fehlt', { titel: 'x' }, '');
    expect(await q.terminLesen(e.uid!)).toMatchObject({ titel: 'Von außen', geaendert: '2026-11-18T11:00:00Z' });
    q.extern.loeschen(e.uid!);
    expect(await q.terminLesen(e.uid!)).toBeNull();
    expect(await q.terminLoeschen(e.uid!)).toBe(false);
    expect(q.extern.alle()).toEqual([]);
  });

  it('liefert Kalender und wiederkehrende Termine; Abmelden beendet Benachrichtigung', async () => {
    const q = beispielKalender();
    expect(await q.zugriff()).toBe('erlaubt');
    expect((await q.kalender()).map(x => x.name)).toEqual(['Arbeit', 'Privat', 'Familie']);
    const woche = await q.termine('2026-11-16', '2026-11-22');
    expect(woche.map(x => x.titel)).toEqual(['Jour fixe', 'Yoga', 'Weekly', 'Lauftreff']);
    let n = 0;
    const ab = q.beiAenderung(() => n++);
    q.aendern(); ab(); q.aendern();
    expect(n).toBe(1);
  });
});
