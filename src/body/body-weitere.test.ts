// Ergänzende Body-Tests: alle Commands/Queries, Zugriffsfälle, Fehler der Kalenderquelle, Benachrichtigungen.
import { describe, expect, it } from 'vitest';
import { Domain } from '../domain/domain';
import { speicherAnhaenge } from '../providers/anhaenge/datei';
import { speicherEinstellungen } from '../providers/einstellungen/json';
import { SpeicherEventStore } from '../providers/eventstore/speicher';
import { zaehlerIds } from '../providers/ids/ulid';
import { kalenderCache } from '../providers/kalender/cache';
import { beispielKalender } from '../providers/kalender/fake';
import type { Kalenderquelle } from '../providers/kalender/interface';
import { festeUhr } from '../providers/uhr/system';
import type { KalenderZugriff } from '../schema/extern';
import { dringlichkeit, passtZuFilter } from './abfragen/aufgaben';
import { RundblickBody } from './body';
import type { Bereich, CommandStatus } from './interface';

const uhr = festeUhr('2026-11-16T10:40:00');
function aufbau(kalender: Kalenderquelle = beispielKalender()) {
  const es = new SpeicherEventStore('t', zaehlerIds('e').neu, () => uhr.jetzt());
  const einstellungen = speicherEinstellungen();
  const body = new RundblickBody({ domain: new Domain(es), uhr, ids: zaehlerIds('x'), einstellungen, kalender, cache: kalenderCache(), anhaenge: speicherAnhaenge(), info: { datenordner: '/d', geraet: 'g' } });
  body.einrichten();
  const gemeldet: Bereich[][] = [];
  body.beiAenderung(b => gemeldet.push(b));
  return { body, einstellungen, gemeldet };
}
const id = (r: CommandStatus, k: string) => (r.ok ? r.ids![k]! : '');

describe('Commands über den Body', () => {
  it('ändern, Status, abschließen, wieder öffnen, verwerfen', async () => {
    const { body } = aufbau();
    const a = id(await body.aufgabeErfassen({ titel: 'T' }), 'aufgabeId');
    expect(await body.aufgabeAendern({ aufgabeId: a, aenderungen: { titel: 'Neu', tags: ['x'] } })).toEqual({ ok: true });
    expect(await body.statusSetzen({ aufgabeId: a, status: 'inarbeit' })).toEqual({ ok: true });
    await body.aufgabeAbschliessen({ aufgabeId: a });
    await body.aufgabeWiedereroeffnen({ aufgabeId: a });
    expect((await body.aufgabe({ aufgabeId: a }))).toMatchObject({ titel: 'Neu', tags: ['x'], abgeschlossen: false, status: { id: 'inarbeit' } });
    await body.aufgabeVerwerfen({ aufgabeId: a });
    expect(await body.aufgabe({ aufgabeId: a })).toBeNull();
    expect(await body.aufgabeAendern({ aufgabeId: a, aenderungen: { titel: 'X' } })).toMatchObject({ ok: false });
  });

  it('Buchungen: anlegen, stornieren; Details mit Buchungsliste', async () => {
    const { body } = aufbau();
    const a = id(await body.aufgabeErfassen({ titel: 'T' }), 'aufgabeId');
    const b = id(await body.buchungAnlegen({ aufgabeId: a, datum: '2026-11-17', start: '09:00', dauer: 30 }), 'buchungId');
    expect((await body.aufgabe({ aufgabeId: a }))!.buchungsliste).toMatchObject([{ id: b, aufgabentitel: 'T', start: '09:00' }]);
    expect(await body.buchungStornieren({ buchungId: b })).toEqual({ ok: true });
    expect(await body.buchung({ buchungId: b })).toBeNull();
  });

  it('Board-Spalten und Planung', async () => {
    const { body } = aufbau();
    const s = id(await body.spalteAnlegen({ name: 'Review', kategorie: 'begonnen' }), 'statusId');
    expect(await body.spalteUmbenennen({ statusId: s, name: 'Prüfen' })).toEqual({ ok: true });
    expect(await body.spaltenSortieren({ kategorie: 'begonnen', reihenfolge: [s, 'inarbeit', 'blockiert'] })).toEqual({ ok: true });
    expect((await body.einstellungen()).spalten.filter(x => x.kategorie === 'begonnen').map(x => x.name)).toEqual(['Prüfen', 'In Arbeit', 'Blockiert']);
    expect(await body.spalteEntfernen({ statusId: s })).toEqual({ ok: true });
    expect(await body.kategorieUmbenennen({ kategorie: 'beendet', name: 'Fertig' })).toEqual({ ok: true });
    expect((await body.board()).kategorien.map(k => k.name)).toEqual(['Nicht begonnen', 'Begonnen', 'Fertig']);
    expect((await body.einstellungen()).kategorien.at(-1)).toEqual({ id: 'beendet', name: 'Fertig' });
    expect(await body.tageskapazitaetFestlegen({ wochentag: 6, minuten: 120 })).toEqual({ ok: true });
    expect((await body.einstellungen()).kapazitaet[5]).toBe(120);
  });

  it('Schnellerfassung ohne Titel und nur Buchung ohne Datum', async () => {
    const { body } = aufbau();
    expect(await body.schnellErfassen({ text: '#tag' })).toMatchObject({ ok: false, fehler: ['Titel fehlt.'] });
    expect(await body.schnellErfassen({ text: '>xyz Friseur' })).toMatchObject({ ok: false });
  });

  it('Tageszeit: Standard 7–21, gültige Werte werden gespeichert, ungültige abgelehnt', async () => {
    const { body, gemeldet } = aufbau();
    expect((await body.einstellungen()).tageszeit).toEqual({ von: 7, bis: 21 });
    expect(await body.tageszeitFestlegen({ von: 6, bis: 22 })).toEqual({ ok: true });
    expect(gemeldet.at(-1)).toEqual(['kalender', 'einstellungen']);
    expect((await body.einstellungen()).tageszeit).toEqual({ von: 6, bis: 22 });
    for (const x of [{ von: 10, bis: 11 }, { von: -1, bis: 8 }, { von: 8, bis: 25 }, { von: 7.5, bis: 20 }, { von: 20, bis: 8 }]) {
      expect(await body.tageszeitFestlegen(x)).toMatchObject({ ok: false });
    }
  });

  it('Layout speichern und laden', async () => {
    const { body } = aufbau();
    expect(await body.layout()).toBeNull();
    await body.layoutSpeichern({ layout: { arbeitsbereiche: [{ name: 'A' }], aktiv: 0 } });
    expect(await body.layout()).toEqual({ arbeitsbereiche: [{ name: 'A' }], aktiv: 0 });
  });
});

describe('Queries über den Body', () => {
  it('heute, Vorschau mit Status, Vorschläge nach Häufigkeit', async () => {
    const { body } = aufbau();
    expect(await body.heute()).toEqual({ datum: '2026-11-16', minute: 640 });
    expect((await body.erfassungVorschau({ text: 'X =inarbeit' })).status).toEqual({ id: 'inarbeit', name: 'In Arbeit', kategorie: 'begonnen' });
    expect((await body.erfassungVorschau({ text: 'X' })).status).toBeNull();
    await body.aufgabeErfassen({ titel: 'A', tags: ['kunde', 'büro'], verantwortlich: 'Ralf', ort: 'Hamburg' });
    await body.aufgabeErfassen({ titel: 'B', tags: ['kunde'], verantwortlich: 'Markus' });
    expect(await body.vorschlaege({ art: 'tag', praefix: '' })).toEqual(['kunde', 'büro']);
    expect(await body.vorschlaege({ art: 'person', praefix: 'r' })).toEqual(['Ralf']);
    expect(await body.vorschlaege({ art: 'ort', praefix: '' })).toEqual(['Hamburg']);
  });

  it('Liste zeigt Zurückgestellte und Abgeschlossene sortiert; Filter durchsucht auch die Beschreibung', async () => {
    const { body } = aufbau();
    await body.aufgabeErfassen({ titel: 'Z1', wiedervorlage: '2026-12-01' });
    await body.aufgabeErfassen({ titel: 'Z2', wiedervorlage: '2026-11-20' });
    const l = await body.liste({});
    expect(l.zurueckgestellt.map(a => a.titel)).toEqual(['Z2', 'Z1']);
    await body.aufgabeErfassen({ titel: 'Mit Text', beschreibung: 'Geheimwort' });
    expect((await body.liste({ filter: 'geheimwort' })).offen).toBe(1);
  });

  it('Dringlichkeit und Filter als pure Funktionen', () => {
    expect(dringlichkeit(null, '2026-11-16')).toBeNull();
    expect(['2026-11-15', '2026-11-16', '2026-11-18', '2026-11-30'].map(f => dringlichkeit(f, '2026-11-16'))).toEqual(['ueberfaellig', 'heute', 'woche', 'spaeter']);
    const a = { id: 'a', titel: 'Angebot', beschreibung: '', ort: '', verantwortlich: '', tags: ['kunde'], frist: null, wiedervorlage: null, status: null, abgeschlossen: false, verworfen: false, neu: false, wiederholung: null, erledigt: [], archiviert: false, anhaenge: [], rang: 0, abgeschlossenAm: null, abgehakt: [] };
    expect(passtZuFilter(a, '  ')).toBe(true);
    expect(passtZuFilter(a, 'angebot #kunde')).toBe(true);
    expect(passtZuFilter(a, 'angebot #büro')).toBe(false);
  });

  it('Liste und Board: neueste Aufgaben oben, danach manuelle Reihenfolge', async () => {
    const { body } = aufbau();
    for (const [titel, frist] of [['Ohne B', null], ['Mit', '2026-11-30'], ['Ohne A', null], ['Früh', '2026-11-25']] as const) {
      await body.aufgabeErfassen({ titel, frist, status: 'idee' });
    }
    const l = await body.liste({});
    expect(l.gruppen.find(g => g.art === 'ohne')!.aufgaben.map(a => a.titel)).toEqual(['Ohne A', 'Ohne B']);
    expect(l.gruppen.find(g => g.art === 'spaeter')!.aufgaben.map(a => a.titel)).toEqual(['Früh', 'Mit']);
    // (Ohne A wurde nach Ohne B erfasst, Früh nach Mit → jeweils oben)
    const idee = (await body.board()).kategorien[0]!.spalten.find(s => s.id === 'idee')!;
    expect(idee.karten.map(k => k.titel)).toEqual(['Früh', 'Ohne A', 'Mit', 'Ohne B']);
    // Verschieben wirkt auf Liste und Board gleichermaßen
    const k = (t: string) => idee.karten.find(x => x.titel === t)!.id;
    await body.aufgabeVerschieben({ aufgabeId: k('Ohne B'), oben: null, unten: k('Früh') });
    const neu = (await body.board()).kategorien[0]!.spalten.find(s => s.id === 'idee')!;
    expect(neu.karten.map(x => x.titel)).toEqual(['Ohne B', 'Früh', 'Ohne A', 'Mit']);
  });

  it('Archivieren verbirgt die Aufgabe überall (auch unter Abgeschlossen) – sie steht nur im Archiv', async () => {
    const { body } = aufbau();
    const a = id(await body.aufgabeErfassen({ titel: 'Alt', status: 'erledigt', frist: '2026-11-18' }), 'aufgabeId');
    await body.aufgabeAbschliessen({ aufgabeId: a });
    expect(await body.aufgabeArchivieren({ aufgabeId: a })).toEqual({ ok: true });
    const l = await body.liste({});
    expect([l.abgeschlossen.length, l.archiv.map(x => [x.titel, x.archiviert])]).toEqual([0, [['Alt', true]]]);
    expect((await body.board()).kategorien[2]!.anzahl).toBe(0);
    expect((await body.zeitraum({ von: '2026-11-18', bis: '2026-11-18' })).tage[0]!.fristen).toEqual([]);
    expect(await body.aufgabeWiedereroeffnen({ aufgabeId: a })).toMatchObject({ ok: false });
    expect(await body.aufgabeAusArchivHolen({ aufgabeId: a })).toEqual({ ok: true });
    expect((await body.liste({})).abgeschlossen.map(x => x.titel)).toEqual(['Alt']);
  });

  it('Board: offen · zurückgestellt · abgeschlossen je Spalte; archivierte fehlen', async () => {
    const { body } = aufbau();
    const a = id(await body.aufgabeErfassen({ titel: 'A', status: 'bereit' }), 'aufgabeId');
    await body.aufgabeErfassen({ titel: 'B', status: 'bereit', frist: '2026-11-20' });
    await body.aufgabeErfassen({ titel: 'C', status: 'bereit', wiedervorlage: '2026-12-01' });
    await body.aufgabeAbschliessen({ aufgabeId: a });
    const d = id(await body.aufgabeErfassen({ titel: 'D', status: 'bereit' }), 'aufgabeId');
    await body.aufgabeArchivieren({ aufgabeId: d });
    const b = await body.board();
    expect(b.kategorien[0]!.anzahl).toBe(3);
    const bereit = b.kategorien[0]!.spalten.find(s => s.id === 'bereit')!.karten;
    expect(bereit.map(k => [k.titel, k.zurueckgestellt, k.abgeschlossen])).toEqual([['B', false, false], ['C', true, false], ['A', false, true]]);
  });

  it('Zeitraum: ganztägige externe Termine zählen nicht zur Auslastung; unbekannter Kalender bekommt Standardwerte', async () => {
    const quelle = beispielKalender();
    const orig = quelle.termine;
    quelle.termine = async (von, bis) => [...await orig(von, bis), { id: 'u', kalenderId: 'unbekannt', titel: 'Fremd', datum: '2026-12-01', start: '10:00', dauer: 30, ort: '' }];
    const { body } = aufbau(quelle);
    await body.synchronisieren();
    const t = (await body.zeitraum({ von: '2026-12-01', bis: '2026-12-01' })).tage[0]!;
    expect(t.extern.map(e => [e.titel, e.start, e.kalender])).toEqual([['Monatsanfang', null, 'Familie'], ['Fremd', 600, '?'], ['Yoga', 1110, 'Privat']]);
    expect(t.auslastung).toMatchObject({ belegt: 0, nichtBelegend: 30 + 75 });
  });
});

describe('Manuelle Priorisierung', () => {
  it('Aufgabe zwischen Nachbarn, an den Anfang und ans Ende verschieben', async () => {
    const { body } = aufbau();
    const ids: Record<string, string> = {};
    for (const t of ['A', 'B', 'C', 'D']) ids[t] = id(await body.aufgabeErfassen({ titel: t }), 'aufgabeId');
    const reihe = async () => (await body.liste({})).gruppen.find(g => g.art === 'ohne')!.aufgaben.map(a => a.titel).join('');
    expect(await reihe()).toBe('DCBA');
    await body.aufgabeVerschieben({ aufgabeId: ids.A!, oben: ids.D!, unten: ids.C! });
    expect(await reihe()).toBe('DACB');
    await body.aufgabeVerschieben({ aufgabeId: ids.B!, oben: null, unten: ids.D! });
    expect(await reihe()).toBe('BDAC');
    await body.aufgabeVerschieben({ aufgabeId: ids.B!, oben: ids.C!, unten: null });
    expect(await reihe()).toBe('DACB');
    expect(await body.aufgabeVerschieben({ aufgabeId: ids.B!, oben: null, unten: null })).toEqual({ ok: true });
    expect(await body.aufgabeVerschieben({ aufgabeId: ids.B!, oben: 'gibtsnicht', unten: null })).toEqual({ ok: true });
  });
});

describe('Anhänge über den Body', () => {
  const PNG = btoa(String.fromCharCode(137, 80, 78, 71, 1, 2, 3));
  it('speichert das Bild, nummeriert es, liefert es als data:-URL und löscht die Datei beim Entfernen', async () => {
    const anhaenge = speicherAnhaenge();
    const es = new SpeicherEventStore('t', zaehlerIds('e').neu, () => uhr.jetzt());
    const body = new RundblickBody({ domain: new Domain(es), uhr, ids: zaehlerIds('x'), einstellungen: speicherEinstellungen(), kalender: beispielKalender(), cache: kalenderCache(), anhaenge, info: { datenordner: '', geraet: '' } });
    const a = id(await body.aufgabeErfassen({ titel: 'Mit Bild' }), 'aufgabeId');
    const r1 = await body.anhangHinzufuegen({ aufgabeId: a, name: 'foto.png', typ: 'image/png', daten: 'data:image/png;base64,' + PNG });
    const r2 = await body.anhangHinzufuegen({ aufgabeId: a, name: 'zwei.png', typ: 'image/png', daten: PNG });
    const det = (await body.aufgabe({ aufgabeId: a }))!;
    expect(det.anhangliste.map(x => [x.nr, x.name, x.groesse])).toEqual([[1, 'foto.png', 7], [2, 'zwei.png', 7]]);
    expect((await body.liste({})).gruppen.find(g => g.art === 'ohne')!.aufgaben[0]!.anhaenge).toBe(2);
    expect(await body.anhang({ anhangId: id(r1, 'anhangId') })).toEqual({ name: 'foto.png', typ: 'image/png', url: 'data:image/png;base64,' + PNG });
    await body.anhangEntfernen({ aufgabeId: a, anhangId: id(r2, 'anhangId') });
    expect(anhaenge.lesen(id(r2, 'anhangId'))).toBeNull();
    expect(await body.anhang({ anhangId: id(r2, 'anhangId') })).toBeNull();
    expect(await body.anhang({ anhangId: 'gibtsnicht' })).toBeNull();
  });

  it('abgelehnte oder kaputte Anhänge hinterlassen keine Datei', async () => {
    const anhaenge = speicherAnhaenge();
    const es = new SpeicherEventStore('t', zaehlerIds('e').neu, () => uhr.jetzt());
    const body = new RundblickBody({ domain: new Domain(es), uhr, ids: zaehlerIds('x'), einstellungen: speicherEinstellungen(), kalender: beispielKalender(), cache: kalenderCache(), anhaenge, info: { datenordner: '', geraet: '' } });
    const a = id(await body.aufgabeErfassen({ titel: 'T' }), 'aufgabeId');
    const r = await body.anhangHinzufuegen({ aufgabeId: a, name: 'x.pdf', typ: 'application/pdf', daten: PNG });
    expect(r.ok).toBe(false);
    expect(anhaenge.lesen('x2')).toBeNull();
    expect(await body.anhangHinzufuegen({ aufgabeId: a, name: 'x.png', typ: 'image/png', daten: '%%%kein base64' })).toMatchObject({ ok: false, fehler: ['Die Bilddaten sind beschädigt.'] });
  });
});

describe('Kalenderzugriff und Synchronisation', () => {
  const quelle = (zugriff: KalenderZugriff, fehler = false): Kalenderquelle & { aendern(): void } => {
    const q = beispielKalender(zugriff);
    if (fehler) q.termine = async () => { throw new Error('kaputt'); };
    return q;
  };

  it.each([
    ['erlaubt', true, ''],
    ['verweigert', false, 'verweigert'],
    ['unbestimmt', false, 'noch nicht erteilt'],
    ['nichtVerfuegbar', false, 'Helfer nicht verfügbar'],
  ] as const)('Zugriff anfragen: %s', async (zugriff, ok, text) => {
    const { body, gemeldet } = aufbau(quelle(zugriff));
    const r = await body.kalenderZugriffAnfragen();
    expect(r.ok).toBe(ok);
    if (!r.ok) expect(r.fehler[0]).toContain(text);
    expect(gemeldet).toContainEqual(['einstellungen']);
    expect((await body.einstellungen()).zugriff).toBe(zugriff);
  });

  it('Fehler der Kalenderquelle werden gemeldet, nicht geworfen', async () => {
    const { body } = aufbau(quelle('erlaubt', true));
    expect(await body.synchronisieren()).toMatchObject({ ok: false, fehler: [expect.stringContaining('kaputt')] });
  });

  it('gleichzeitiges Laden wird zusammengefasst', async () => {
    const { body } = aufbau();
    const [a, b] = await Promise.all([body.synchronisieren(), body.synchronisieren()]);
    expect([a.ok, b.ok]).toEqual([true, true]);
  });

  it('Systemänderung an Kalendern löst Synchronisation aus; Tageswechsel meldet alle Bereiche', async () => {
    const q = quelle('erlaubt');
    const { body, gemeldet } = aufbau(q);
    q.aendern();
    await new Promise(r => setTimeout(r, 10));
    expect(gemeldet).toContainEqual(['kalender', 'einstellungen']);
    expect((await body.einstellungen()).letzteSynchronisation).not.toBeNull();
    body.tageswechsel();
    expect(gemeldet.at(-1)).toEqual(['aufgaben', 'board', 'kalender']);
  });

  it('Kalender-Einstellungen werden gerätebezogen gespeichert; Abmelden beendet Benachrichtigungen', async () => {
    const { body, einstellungen } = aufbau();
    await body.kalenderEinstellen({ kalenderId: 'arbeit', belegt: true });
    await body.kalenderEinstellen({ kalenderId: 'arbeit', sichtbar: false });
    expect(einstellungen.lesen('kalender', {})).toEqual({ arbeit: { sichtbar: false, belegt: true } });
    let n = 0;
    const ab = body.beiAenderung(() => n++);
    ab();
    body.tageswechsel();
    expect(n).toBe(0);
  });
});

describe('Herkunft einer Buchung', () => {
  it('Board, wenn die Aufgabe einen Status hat; sonst Liste; freie Buchung ohne Herkunft', async () => {
    const { body } = aufbau();
    const mitStatus = id(await body.aufgabeErfassen({ titel: 'B', status: 'inarbeit', buchung: { datum: '2026-11-18', start: '09:00' } }), 'aufgabeId');
    await body.aufgabeErfassen({ titel: 'L', buchung: { datum: '2026-11-18' } });
    await body.buchungEintragen({ titel: 'F', datum: '2026-11-18', start: '11:00' });
    const t = (await body.zeitraum({ von: '2026-11-18', bis: '2026-11-18' })).tage[0]!;
    expect([...t.termine, ...t.reservierungen].map(b => [b.titel, b.herkunft])).toEqual([['B', 'board'], ['F', null], ['L', 'liste']]);
    await body.statusSetzen({ aufgabeId: mitStatus, status: null });
    expect((await body.aufgabe({ aufgabeId: mitStatus }))!.buchungsliste[0]!.herkunft).toBe('liste');
  });
});

describe('Selbst-Aktualisierung über den Body', () => {
  it('ohne Abgleich (Desktop): nicht verfügbar, Commands ohne Wirkung', async () => {
    const { body } = aufbau();
    expect(await body.abgleich()).toMatchObject({ verfuegbar: false, verbunden: false });
    for (const f of [body.abgleichen, body.abgleichVerbinden, body.abgleichTrennen]) expect(await f.call(body)).toEqual({ ok: true });
  });

  it('Abgleich (Phone App): Stand, Fehler und Meldungen als Bereich „abgleich“', async () => {
    let melden: (() => void) | null = null;
    let fehler: string | null = null;
    const stand = () => ({ verfuegbar: true, verbunden: true, konto: 'Ralf', geraet: 'iphone-ralf', online: true, laeuft: false, wartend: 2, zuletzt: null, fehler, speicherDauerhaft: true });
    const ab = {
      stand, abgleichen: async () => { fehler = 'Anmeldung abgelaufen'; },
      verbinden: async () => { throw new Error('Popup blockiert'); }, trennen: async () => {},
      beiAenderung: (cb: () => void) => { melden = cb; return () => {}; },
    };
    const es = new SpeicherEventStore('t', zaehlerIds('e').neu, () => uhr.jetzt());
    const body = new RundblickBody({ domain: new Domain(es), uhr, ids: zaehlerIds('x'), einstellungen: speicherEinstellungen(), kalender: beispielKalender(), cache: kalenderCache(), anhaenge: speicherAnhaenge(), info: { datenordner: '', geraet: '' }, abgleich: ab });
    const gemeldet: Bereich[][] = [];
    body.beiAenderung(b => gemeldet.push(b));
    expect(await body.abgleich()).toMatchObject({ konto: 'Ralf', wartend: 2 });
    expect(await body.abgleichen()).toEqual({ ok: false, fehler: ['Anmeldung abgelaufen'] });
    expect(await body.abgleichVerbinden()).toEqual({ ok: false, fehler: ['Popup blockiert'] });
    expect(await body.abgleichTrennen()).toEqual({ ok: true });
    melden!();
    expect(gemeldet).toContainEqual(['abgleich']);
  });

  it('ohne Aktualisierer: nicht verfügbar, Commands ohne Wirkung', async () => {
    const { body } = aufbau();
    expect(await body.aktualisierung()).toEqual({ laufend: null, stand: { stand: 'nichtVerfuegbar' } });
    for (const f of [body.aktualisierungOrdnerWaehlen, body.aktualisierungOrdnerEntfernen, body.aktualisierungPruefen, body.aktualisierungInstallieren]) expect(await f.call(body)).toEqual({ ok: true });
  });

  it('reicht Stand und Fehler durch und meldet Änderungen als Bereich „aktualisierung“', async () => {
    let melden: ((s: import('../providers/aktualisierung/interface').AktualisierungsStand) => void) | null = null;
    let stand: import('../providers/aktualisierung/interface').AktualisierungsStand = { stand: 'aus' };
    const akt = {
      laufend: () => ({ version: '0.1.0', build: 140, commit: 'abc' }), stand: () => stand,
      ordnerWaehlen: async () => (stand = { stand: 'verfuegbar', ordner: '/o', geprueft: 'x', angebot: { version: '0.1.0', build: 150, datei: '/o/a.zip' } }),
      ordnerEntfernen: () => (stand = { stand: 'aus' }), pruefen: async () => stand,
      installieren: async () => (stand = { stand: 'fehler', ordner: '/o', meldung: 'Signatur der neuen App ungültig' }),
      beiAenderung: (cb: (s: import('../providers/aktualisierung/interface').AktualisierungsStand) => void) => { melden = cb; return () => {}; },
    };
    const es = new SpeicherEventStore('t', zaehlerIds('e').neu, () => uhr.jetzt());
    const body = new RundblickBody({ domain: new Domain(es), uhr, ids: zaehlerIds('x'), einstellungen: speicherEinstellungen(), kalender: beispielKalender(), cache: kalenderCache(), anhaenge: speicherAnhaenge(), info: { datenordner: '', geraet: '' }, aktualisierer: akt });
    const gemeldet: Bereich[][] = [];
    body.beiAenderung(b => gemeldet.push(b));
    expect((await body.aktualisierung()).laufend).toEqual({ version: '0.1.0', build: 140, commit: 'abc' });
    expect(await body.aktualisierungOrdnerWaehlen()).toEqual({ ok: true });
    expect((await body.aktualisierung()).stand).toMatchObject({ stand: 'verfuegbar', angebot: { build: 150 } });
    expect(await body.aktualisierungPruefen()).toEqual({ ok: true });
    expect(await body.aktualisierungInstallieren()).toEqual({ ok: false, fehler: ['Signatur der neuen App ungültig'] });
    expect(await body.aktualisierungOrdnerEntfernen()).toEqual({ ok: true });
    melden!(stand);
    expect(gemeldet).toContainEqual(['aktualisierung']);
  });
});

describe('Rubrik „Neu“ (geräteübergreifend) und Liste ohne Board-Aufgaben', () => {
  it('frisch Erfasstes steht unter „Neu“, bis es gesehen wird – Import (neu: false) nicht', async () => {
    const { body } = aufbau();
    const a = id(await body.aufgabeErfassen({ titel: 'Frisch' }), 'aufgabeId');
    await body.aufgabeErfassen({ titel: 'Importiert', neu: false });
    await body.schnellErfassen({ text: 'Schnell #x' });
    expect((await body.liste({})).neu.map(x => x.titel)).toEqual(['Schnell', 'Frisch']);
    expect(await body.aufgabeGesehen({ aufgabeId: a })).toEqual({ ok: true });
    expect(await body.aufgabeGesehen({ aufgabeId: a })).toEqual({ ok: true });
    expect((await body.liste({})).neu.map(x => x.titel)).toEqual(['Schnell']);
    expect(await body.aufgabeGesehen({ aufgabeId: 'gibtsnicht' })).toMatchObject({ ok: false });
  });

  it('abgeschlossene Aufgaben stehen nicht unter „Neu“', async () => {
    const { body } = aufbau();
    const a = id(await body.aufgabeErfassen({ titel: 'Erledigt' }), 'aufgabeId');
    await body.aufgabeAbschliessen({ aufgabeId: a });
    expect((await body.liste({})).neu).toEqual([]);
  });

  it('ohneStatus blendet Aufgaben mit Board-Status aus – „ohne Status“ holt sie zurück', async () => {
    const { body } = aufbau();
    const b = id(await body.aufgabeErfassen({ titel: 'Auf dem Board', status: 'inarbeit', frist: '2026-11-16' }), 'aufgabeId');
    await body.aufgabeErfassen({ titel: 'Nur Liste' });
    const titel = (l: Awaited<ReturnType<typeof body.liste>>) => [...l.neu, ...l.gruppen.flatMap(g => g.aufgaben)].map(x => x.titel);
    expect(titel(await body.liste({ ohneStatus: true }))).toEqual(['Nur Liste', 'Nur Liste']);
    expect(titel(await body.liste({}))).toContain('Auf dem Board');
    await body.statusSetzen({ aufgabeId: b, status: null });
    expect(titel(await body.liste({ ohneStatus: true }))).toContain('Auf dem Board');
  });

  it('Datenstand meldet zu neue Events (sonst 0)', async () => {
    expect(await aufbau().body.datenstand()).toEqual({ zuNeu: 0 });
    const es = new SpeicherEventStore('t', zaehlerIds('e').neu, () => uhr.jetzt());
    const body = new RundblickBody({ domain: new Domain(es), uhr, ids: zaehlerIds('x'), einstellungen: speicherEinstellungen(), kalender: beispielKalender(), cache: kalenderCache(), anhaenge: speicherAnhaenge(), info: { datenordner: '', geraet: '' }, zuNeueEvents: () => 3 });
    expect(await body.datenstand()).toEqual({ zuNeu: 3 });
  });
});

describe('Wiederholung über den Body', () => {
  it('Schnellerfassung *monatlich / *17t, Zeile zeigt die Regel, Abhaken springt weiter, Logbuch zählt jede Erledigung', async () => {
    const { body } = aufbau();
    const a = id(await body.schnellErfassen({ text: 'Backup !12.11. *monatlich' }), 'aufgabeId');
    const b = id(await body.schnellErfassen({ text: 'Karte *17t' }), 'aufgabeId');
    expect(await body.schnellErfassen({ text: 'X *irgendwann' })).toMatchObject({ ok: false });
    expect(await body.aufgabe({ aufgabeId: b })).toMatchObject({ frist: '2026-11-16', wiederholung: { einheit: 'tag', alle: 17 } });
    expect(await body.aufgabe({ aufgabeId: a })).toMatchObject({ frist: '2026-11-12', wiederholung: { einheit: 'monat', alle: 1 } });
    await body.aufgabeAbschliessen({ aufgabeId: a });
    expect(await body.aufgabe({ aufgabeId: a })).toMatchObject({ frist: '2026-12-12', abgeschlossen: false });
    await body.aufgabeAbschliessen({ aufgabeId: a });
    const log = await body.logbuch({});
    expect(log.tage[0]!.eintraege.filter(e => e.art === 'aufgabe')).toHaveLength(2);
    await body.aufgabeAendern({ aufgabeId: a, aenderungen: { wiederholung: null } });
    expect((await body.aufgabe({ aufgabeId: a }))!.wiederholung).toBeNull();
  });
});

describe('Externe Termine löschen', () => {
  it('löscht ein Vorkommen im Kalender; schreibgeschützt, unbekannt und Fehler werden gemeldet', async () => {
    const quelle = beispielKalender();
    const { body } = aufbau(quelle);
    await body.synchronisieren();
    const tag = async (d: string) => (await body.zeitraum({ von: d, bis: d })).tage[0]!.extern;
    const jf = (await tag('2026-11-16')).find(e => e.titel === 'Jour fixe')!;
    expect(jf).toMatchObject({ loeschbar: true, serie: true });
    expect(await body.externLoeschen({ externId: jf.id })).toEqual({ ok: true });
    expect((await tag('2026-11-16')).some(e => e.titel === 'Jour fixe')).toBe(false);
    expect((await tag('2026-11-23')).some(e => e.titel === 'Jour fixe')).toBe(true); // nur dieses Vorkommen
    expect(await body.externLoeschen({ externId: jf.id })).toMatchObject({ ok: false, fehler: ['Externer Termin nicht gefunden.'] });
    const fam = (await tag('2026-12-01')).find(e => e.kalender === 'Familie')!;
    expect(fam.loeschbar).toBe(false);
    expect(await body.externLoeschen({ externId: fam.id })).toMatchObject({ ok: false, fehler: ['Dieser Kalender ist schreibgeschützt.'] });
    const yoga = (await tag('2026-11-17')).find(e => e.titel === 'Yoga')!;
    quelle.vorkommenLoeschen = async () => false;
    expect(await body.externLoeschen({ externId: yoga.id })).toMatchObject({ ok: false, fehler: ['Der Termin ist im Kalender nicht mehr da.'] });
    quelle.vorkommenLoeschen = async () => { throw new Error('kaputt'); };
    expect(await body.externLoeschen({ externId: yoga.id })).toMatchObject({ ok: false, fehler: [expect.stringContaining('kaputt')] });
  });
  it('ohne geladenen Kalender: nicht gefunden; Beispielkalender löscht auch gespiegelte Termine', async () => {
    const { body } = aufbau();
    expect(await body.externLoeschen({ externId: 'x' })).toMatchObject({ ok: false });
    const q = beispielKalender();
    const e = await q.terminAnlegen('arbeit', { titel: 'T', notiz: '', datum: '2026-11-20', start: '10:00', dauer: 30 });
    expect(await q.vorkommenLoeschen(e.id)).toBe(true);
    expect(await q.vorkommenLoeschen('anderes-x')).toBe(false);
  });
});
