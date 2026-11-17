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
    expect(await body.tageskapazitaetFestlegen({ wochentag: 6, minuten: 120 })).toEqual({ ok: true });
    expect((await body.einstellungen()).kapazitaet[5]).toBe(120);
  });

  it('Schnellerfassung ohne Titel und nur Buchung ohne Datum', async () => {
    const { body } = aufbau();
    expect(await body.schnellErfassen({ text: '#tag' })).toMatchObject({ ok: false, fehler: ['Titel fehlt.'] });
    expect(await body.schnellErfassen({ text: '>xyz Friseur' })).toMatchObject({ ok: false });
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
    const a = { id: 'a', titel: 'Angebot', beschreibung: '', ort: '', verantwortlich: '', tags: ['kunde'], frist: null, wiedervorlage: null, status: null, abgeschlossen: false, verworfen: false, archiviert: false, anhaenge: [], rang: 0 };
    expect(passtZuFilter(a, '  ')).toBe(true);
    expect(passtZuFilter(a, 'angebot #kunde')).toBe(true);
    expect(passtZuFilter(a, 'angebot #büro')).toBe(false);
  });

  it('Liste: neueste Aufgaben oben in jedem Abschnitt; Board: nach Frist, dann Titel', async () => {
    const { body } = aufbau();
    for (const [titel, frist] of [['Ohne B', null], ['Mit', '2026-11-30'], ['Ohne A', null], ['Früh', '2026-11-25']] as const) {
      await body.aufgabeErfassen({ titel, frist, status: 'idee' });
    }
    const l = await body.liste({});
    expect(l.gruppen.find(g => g.art === 'ohne')!.aufgaben.map(a => a.titel)).toEqual(['Ohne A', 'Ohne B']);
    expect(l.gruppen.find(g => g.art === 'spaeter')!.aufgaben.map(a => a.titel)).toEqual(['Früh', 'Mit']);
    // (Ohne A wurde nach Ohne B erfasst, Früh nach Mit → jeweils oben)
    const idee = (await body.board()).kategorien[0]!.spalten.find(s => s.id === 'idee')!;
    expect(idee.karten.map(k => k.titel)).toEqual(['Früh', 'Mit', 'Ohne A', 'Ohne B']);
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

  it('Board zählt Kategorien und stellt Abgeschlossene ans Ende der Spalte', async () => {
    const { body } = aufbau();
    const a = id(await body.aufgabeErfassen({ titel: 'A', status: 'bereit' }), 'aufgabeId');
    await body.aufgabeErfassen({ titel: 'B', status: 'bereit', frist: '2026-11-20' });
    await body.aufgabeErfassen({ titel: 'C', status: 'bereit', wiedervorlage: '2026-12-01' });
    await body.aufgabeAbschliessen({ aufgabeId: a });
    const b = await body.board();
    expect(b.kategorien[0]!.anzahl).toBe(2);
    expect(b.kategorien[0]!.spalten.find(s => s.id === 'bereit')!.karten.map(k => k.titel)).toEqual(['B', 'A']);
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
