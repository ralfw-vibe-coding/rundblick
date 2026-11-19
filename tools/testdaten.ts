// Testdaten in Stufen für schrittweises Testen der App.
//   node tools/testdaten.mjs <stufe>     (wird per `npm run testdaten -- <stufe>` gebaut und gestartet)
// Löscht ALLE Events im Datenordner und schreibt die Daten der Stufe neu – über das Body interface,
// also mit echten Events. Datenordner und Gerätename kommen aus der Geräte-Einstellung der App.
// Die Titel beschreiben, was man in der Oberfläche erwarten soll.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { plusTage, wochentag } from '../src/basis/datum';
import { RundblickBody } from '../src/body/body';
import type { AufgabeEingabe, Body } from '../src/body/interface';
import { Domain } from '../src/domain/domain';
import { dateiAnhaenge } from '../src/providers/anhaenge/datei';
import { speicherEinstellungen } from '../src/providers/einstellungen/json';
import { JsonlEventStore } from '../src/providers/eventstore/jsonl';
import { ulidGenerator } from '../src/providers/ids/ulid';
import { kalenderCache } from '../src/providers/kalender/cache';
import { beispielKalender } from '../src/providers/kalender/fake';
import { datumLokal, systemUhr } from '../src/providers/uhr/system';
import type { Uhr } from '../src/providers/uhr/interface';

type Kontext = { body: Body; heute: string; d: (n: number) => string; neu: (x: AufgabeEingabe) => Promise<string>; zeitreise: (tage: number, uhrzeit: string) => void; zurueck: () => void };

// ---------------- Stufe 1: nur Aufgaben in der Liste (ohne Status, ohne Buchungen) ----------------
async function stufe1({ neu, heute, d, body }: Kontext): Promise<void> {
  const sonntag = plusTage(heute, 6 - wochentag(heute));

  // Gruppe „Überfällig“
  await neu({ titel: 'Überfällig: Frist gestern', frist: d(-1) });
  await neu({ titel: 'Überfällig: Frist vor 10 Tagen', frist: d(-10), tags: ['büro'] });

  // Gruppe „Heute fällig“
  await neu({ titel: 'Heute fällig A (gleiche Frist → nach Titel sortiert)', frist: heute });
  await neu({ titel: 'Heute fällig B', frist: heute, verantwortlich: 'Ralf' });

  // Gruppe „Diese Woche“ (bis Sonntag) – Fristfarbe: morgen/übermorgen = „bald“ (gelb), danach grau
  if (d(1) <= sonntag) await neu({ titel: 'Diese Woche: Frist morgen (bald, gelb)', frist: d(1) });
  if (d(2) <= sonntag) await neu({ titel: 'Diese Woche: Frist übermorgen (bald, gelb)', frist: d(2) });
  if (sonntag > d(2)) await neu({ titel: 'Diese Woche: Frist Sonntag (grau)', frist: sonntag });

  // Gruppe „Später“
  await neu({ titel: 'Später: Frist nächste Woche', frist: plusTage(sonntag, 3) });
  await neu({ titel: 'Später: Frist in einem Monat', frist: d(30), tags: ['kunde'] });
  await neu({ titel: 'Später: Frist im nächsten Jahr', frist: d(200) });

  // Gruppe „Ohne Frist“ – Felder-Varianten
  await neu({ titel: 'Nur Titel – keine weiteren Angaben' });
  await neu({
    titel: 'Alle Felder: Beschreibung, Ort, Verantwortlich, mehrere Tags',
    beschreibung: 'Notiz mit **Markdown**: *kursiv*, ~~durchgestrichen~~, `Code` und ein [Link](https://example.com).\n\n## Checkliste\n- [x] Angebot entworfen\n- [ ] Preise prüfen\n- [ ] an Markus schicken\n\nListe:\n- erster Punkt\n- zweiter Punkt\n\n1. Schritt eins\n2. Schritt zwei\n\nNackte URL: https://rundblick.example/doku',
    ort: 'Hamburg, Eppendorf', verantwortlich: 'Markus', tags: ['kunde', 'angebot', 'wichtig'],
  });
  await neu({ titel: 'Nur Tag #privat', tags: ['privat'] });
  await neu({ titel: 'Nur Verantwortliche @Lena', verantwortlich: 'Lena' });
  await neu({ titel: 'Nur Ort /Zoom', ort: 'Zoom' });
  await neu({ titel: 'Sehr langer Titel, der in schmalen Zellen abgeschnitten werden muss, weil er einfach nicht aufhört und immer weiter geht bis zum Ende der Zeile und darüber hinaus' });
  await neu({ titel: 'Sonderzeichen: Ümläute, „Anführungszeichen“, <Klammern> & Emoji 🚀' });
  await neu({ titel: 'Filter-Test: gleicher Tag wie andere (#kunde)', tags: ['kunde'], verantwortlich: 'Ralf' });

  // Wiedervorlage
  await neu({ titel: 'Zurückgestellt bis morgen (eingeklappt)', wiedervorlage: d(1) });
  await neu({ titel: 'Zurückgestellt bis nächsten Monat, mit Frist', wiedervorlage: d(30), frist: d(45) });
  await neu({ titel: 'Zurückgestellt bis in 2 Wochen (Tags bleiben sichtbar)', wiedervorlage: d(14), tags: ['später'] });
  await neu({ titel: 'Wiedervorlage heute → wieder sichtbar', wiedervorlage: heute });
  await neu({ titel: 'Wiedervorlage war letzte Woche → sichtbar', wiedervorlage: d(-7), frist: d(3) });

  // Abgeschlossen (eingeklappt unten) und verworfen (nirgends)
  for (const [titel, frist] of [['Abgeschlossen: war überfällig', d(-3)], ['Abgeschlossen: ohne Frist', null]] as const) {
    await body.aufgabeAbschliessen({ aufgabeId: await neu({ titel, frist }) });
  }
  await body.aufgabeVerwerfen({ aufgabeId: await neu({ titel: 'Verworfen – darf NIRGENDS erscheinen' }) });
}

// ---------------- Stufe 2: Status und Board ----------------
// Enthält auch Aufgaben ohne Status (nur in der Liste). Keine Buchungen.
async function stufe2({ neu, d, heute, body }: Kontext): Promise<void> {
  const mit = (titel: string, status: string, x: Partial<AufgabeEingabe> = {}) => neu({ titel, status, ...x });

  // Nicht begonnen
  await mit('Idee: nur Titel', 'idee');
  await mit('Idee: mit Tags und Verantwortlicher', 'idee', { tags: ['blog', 'später'], verantwortlich: 'Lena' });
  await mit('Backlog: Frist in einem Monat (grau)', 'backlog', { frist: d(30) });
  await mit('Backlog: ohne Frist', 'backlog');
  await mit('Bereit: Frist überfällig (hellrot)', 'bereit', { frist: d(-2) });
  await mit('Bereit: Frist heute (tiefrot)', 'bereit', { frist: heute });
  await mit('Bereit: Frist morgen (orange, diese Woche)', 'bereit', { frist: d(1) });
  await mit('Bereit: sehr langer Titel, der auf der Karte umbrechen muss, statt abgeschnitten zu werden – mehrere Zeilen sind hier in Ordnung', 'bereit');
  for (let i = 1; i <= 9; i++) await mit(`Bereit: viele Karten ${i} von 9 (Spalte muss scrollen)`, 'bereit');

  // Begonnen
  await mit('In Arbeit: alle Felder', 'inarbeit', {
    beschreibung: 'Notiz mit **Markdown**\n- [ ] Punkt offen\n- [x] Punkt erledigt', ort: 'Zoom', verantwortlich: 'Ralf', tags: ['kunde', 'wichtig'], frist: d(3),
  });
  await mit('In Arbeit: Frist heute', 'inarbeit', { frist: heute });
  const abgInArbeit = await mit('In Arbeit: abgeschlossen, obwohl Spalte „begonnen“ (bleibt stehen)', 'inarbeit');
  await body.aufgabeAbschliessen({ aufgabeId: abgInArbeit });
  await mit('Blockiert: wartet auf Rückmeldung', 'blockiert', { verantwortlich: 'Markus' });

  // Beendet
  const erl = await mit('Erledigt und abgeschlossen (durchgestrichen, bleibt stehen)', 'erledigt');
  await body.aufgabeAbschliessen({ aufgabeId: erl });
  await mit('Erledigt, aber noch NICHT abgeschlossen', 'erledigt', { frist: d(-1) });
  // „Abgebrochen“ bleibt bewusst leer

  // Eigene Spalte in „Begonnen“
  const r = await body.spalteAnlegen({ name: 'Review', kategorie: 'begonnen' });
  if (r.ok) await mit('Review: eigene Spalte (zusätzlich zu den Standardspalten)', r.ids!.statusId!);

  // Darf NICHT auf dem Board erscheinen
  await mit('Zurückgestellt mit Status – im Bereich „Zurückgestellt“ der Spalte', 'bereit', { wiedervorlage: d(7) });
  await mit('Zurückgestellt in Arbeit – Bereich „Zurückgestellt“, mit Datum', 'inarbeit', { wiedervorlage: d(3), frist: d(10) });
  await body.aufgabeArchivieren({ aufgabeId: await mit('Archiviert mit Status – NICHT auf dem Board', 'inarbeit') });
  await body.aufgabeVerwerfen({ aufgabeId: await mit('Verworfen mit Status – NIRGENDS', 'idee') });

  // Ohne Status: nur in der Liste
  await neu({ titel: 'Ohne Status – nur in der Liste, nicht auf dem Board', frist: d(2) });
  await neu({ titel: 'Ohne Status – zum Testen: auf eine Board-Spalte ziehen' });
}

// ---------------- Stufe „logbuch“: Notizen und Abgehaktes über mehrere Tage ----------------
async function stufeLogbuch(k: Kontext): Promise<void> {
  const { body, neu, d, zeitreise, zurueck } = k;
  await stufe2(k);
  const ab = async (titel: string, tage: number, uhrzeit: string, x: Partial<AufgabeEingabe> = {}) => {
    zurueck(); const id = await neu({ titel, ...x });
    zeitreise(tage, uhrzeit); await body.aufgabeAbschliessen({ aufgabeId: id }); zurueck(); return id;
  };
  const notiz = async (text: string, tage: number, uhrzeit: string, datum?: string) => {
    zeitreise(tage, uhrzeit); const r = await body.notizErfassen({ text, ...(datum ? { datum } : {}) }); zurueck(); return r.ok ? r.ids!.notizId! : '';
  };

  // Heute
  await notiz('Morgenseiten: Fokus heute ist das Logbuch testen #journal', 0, '07:45');
  await ab('Logbuch: Aufgabe heute abgeschlossen', 0, '09:10', { tags: ['test'] });
  // Checklisten-Punkte einzeln abhaken (jeder Punkt erscheint mit eigener Uhrzeit)
  const cl = await neu({ titel: 'Logbuch: Aufgabe mit Checkliste (bleibt offen)', beschreibung: '- [ ] Punkt A\n- [ ] Punkt B\n- [ ] Punkt C' });
  zeitreise(0, '10:20'); await body.aufgabeAendern({ aufgabeId: cl, aenderungen: { beschreibung: '- [x] Punkt A\n- [ ] Punkt B\n- [ ] Punkt C' } });
  zeitreise(0, '11:05'); await body.aufgabeAendern({ aufgabeId: cl, aenderungen: { beschreibung: '- [x] Punkt A\n- [x] Punkt B\n- [ ] Punkt C' } });
  zurueck();

  // Gestern
  await notiz('Gespräch mit Markus\nIdee: Bewerbungsfilm als Serie anbieten.\n- Preise klären\n- Beispiel drehen #vorgestellt #idee', -1, '14:30');
  await ab('Logbuch: gestern abgeschlossen', -1, '16:00');
  await notiz('Nachgetragen: Abends noch die Folien skizziert (ohne Uhrzeit, steht unten im Tag)', 0, '08:00', d(-1));

  // Vor 3 und 10 Tagen, vor 40 Tagen (zum Scrollen)
  await ab('Logbuch: vor 3 Tagen abgeschlossen', -3, '11:00', { tags: ['kunde'] });
  await notiz('Workshop-Feedback gesammelt #workshop', -3, '17:30');
  for (let i = 4; i <= 40; i += 4) await notiz(`Ältere Notiz vor ${i} Tagen #archivtest`, -i, '12:00');

  // Darf NICHT im Logbuch stehen
  const w = await ab('Logbuch: abgeschlossen und wieder geöffnet – NICHT im Logbuch', -2, '10:00');
  await body.aufgabeWiedereroeffnen({ aufgabeId: w });
  await body.aufgabeVerwerfen({ aufgabeId: await ab('Logbuch: abgeschlossen, dann verworfen – NICHT im Logbuch', -2, '11:00') });
  const n = await notiz('Notiz, die gelöscht wurde – NICHT im Logbuch', -2, '12:00');
  await body.notizVerwerfen({ notizId: n });

  // Archiviert bleibt im Logbuch (mit Archiv-Symbol)
  await body.aufgabeArchivieren({ aufgabeId: await ab('Logbuch: abgeschlossen und archiviert (bleibt, mit Archiv-Symbol)', -1, '09:00') });

  // Zum Ausprobieren: diese Notiz in eine Aufgabe umwandeln (Schublade → Symbol „Aufgabe daraus machen“)
  await notiz('Zum Testen: mich in eine Aufgabe umwandeln\nDer Rest wird zur Notiz der Aufgabe. #test', 0, '12:15');
}

// ---------------- Stufe 3: Buchungen und Kalender ----------------
// Tageskapazität Standard: Mo–Do 6 h, Fr 5 h, Sa/So 0. Die Tage werden ab morgen gesucht, damit jede
// Auslastungsstufe genau einen Tag hat. Titel: „Board ·“ = Aufgabe mit Status (Symbol Board),
// „Liste ·“ = ohne Status (Symbol Liste), „Frei ·“ = Buchung ohne Aufgabe (kein Symbol).
async function stufe3({ neu, d, heute, body }: Kontext): Promise<void> {
  const tage = (wt: number[], n: number) => { const r: string[] = []; for (let i = 1; r.length < n && i < 40; i++) if (wt.includes(wochentag(d(i)))) r.push(d(i)); return r; };
  const [gruen, gelb, rot, ueber, raender, voll] = tage([0, 1, 2, 3], 6) as [string, string, string, string, string, string];
  const [freitag] = tage([4], 1) as [string];
  const [samstag] = tage([5], 1) as [string];

  const buche = async (aufgabeId: string, datum: string, dauer: number, start: string | null = null, extra: { titel?: string; beschreibung?: string; belegt?: boolean } = {}) => {
    const r = await body.buchungAnlegen({ aufgabeId, datum, start, dauer });
    if (!r.ok) throw new Error(r.fehler.join(' '));
    if (extra.titel || extra.beschreibung || extra.belegt === false) await body.buchungAendern({ buchungId: r.ids!.buchungId!, ...extra });
  };
  const frei = async (titel: string, datum: string, dauer: number, start: string | null = null, extra: { beschreibung?: string; belegt?: boolean } = {}) => {
    const r = await body.buchungEintragen({ titel, datum, start, dauer, beschreibung: extra.beschreibung });
    if (!r.ok) throw new Error(r.fehler.join(' '));
    if (extra.belegt === false) await body.buchungAendern({ buchungId: r.ids!.buchungId!, belegt: false });
  };

  // ---- Aufgaben (Board = mit Status, Liste = ohne)
  const angebot = await neu({ titel: 'Board · Angebot Hüttner (mehrere Buchungen)', status: 'inarbeit', frist: gelb, tags: ['kunde'], verantwortlich: 'Ralf' });
  const folien = await neu({ titel: 'Board · Folien überarbeiten', status: 'bereit', frist: gelb });
  const spike = await neu({ titel: 'Board · Spike Event Store', status: 'bereit' });
  const blockiert = await neu({ titel: 'Board · wartet auf Rückmeldung', status: 'blockiert', frist: gelb });
  const workshop = await neu({ titel: 'Board · Workshop vorbereiten (langer Termin)', status: 'inarbeit' });
  const steuer = await neu({ titel: 'Liste · Steuerunterlagen sortieren', frist: d(-1) });
  const lesen = await neu({ titel: 'Liste · Fachartikel lesen' });
  const frueh = await neu({ titel: 'Liste · Frühsport (vor der Tageszeit)' });
  const spaet = await neu({ titel: 'Liste · Abendcall USA (nach der Tageszeit)' });
  const garage = await neu({ titel: 'Liste · Garage aufräumen (Wochenende)' });
  const projekt = await neu({ titel: 'Liste · Langfristprojekt (Buchungen über Wochen)', frist: d(30) });
  const erledigt = await neu({ titel: 'Board · Erledigt und abgeschlossen (Buchung blass)', status: 'erledigt' });
  await neu({ titel: 'Liste · Frist überfällig (ohne Buchung)', frist: d(-3) });
  await neu({ titel: 'Liste · Frist am gelben Tag (drei Fristen an einem Tag)', frist: gelb });
  await neu({ titel: 'Liste · Wiedervorlage in 3 Tagen (taucht dann auf)', wiedervorlage: d(3) });

  // ---- heute: Termin am Morgen, Termin am Nachmittag, Reservierung, abgeschlossene Aufgabe
  await buche(lesen, heute, 60, '08:00');
  await buche(spike, heute, 60, '16:00');
  await buche(steuer, heute, 90);
  await buche(erledigt, heute, 30);
  await body.aufgabeAbschliessen({ aufgabeId: erledigt });

  // ---- je ein Tag pro Auslastungsstufe (Kapazität 6 h)
  // grün: 3 h = 50 %
  await buche(angebot, gruen, 120);
  await buche(lesen, gruen, 60, '10:00');
  // gelb: 5 h = 83 % (+ ein Arzttermin, der keine Kapazität belegt)
  await buche(folien, gelb, 180);
  await buche(blockiert, gelb, 120, '14:00');
  await frei('Frei · Zahnarzt (belegt keine Kapazität)', gelb, 45, '08:00', { belegt: false, beschreibung: 'Kontrolle' });
  // rot: 5¾ h = 96 % (Buchung mit eigenem Titel und eigener Notiz)
  await buche(angebot, rot, 60, '09:00', { titel: 'Angebot: Kalkulation mit Markus', beschreibung: 'Eigener Titel und eigene Notiz der Buchung – die Aufgabe heißt anders.' });
  await buche(spike, rot, 240);
  await frei('Frei · Belege sortieren', rot, 45);
  // überbucht: 7½ h = 125 % (rot mit Warndreieck)
  await buche(angebot, ueber, 120);
  await buche(folien, ueber, 180, '13:00');
  await buche(spike, ueber, 150);

  // ---- Raster: vor und nach der Tageszeit, überlappende Termine
  await buche(frueh, raender, 45, '06:00');
  await buche(spaet, raender, 60, '21:30');
  await buche(angebot, raender, 90, '10:00', { titel: 'Überlappung 1 (10:00–11:30)' });
  await buche(lesen, raender, 30, '10:30', { titel: 'Überlappung 2 (10:30–11:00)' });
  await frei('Frei · Überlappung 3 (11:00–12:00)', raender, 60, '11:00');

  // ---- voller Tag: viele kurze Termine → im Monat „+n weitere“
  const viele = [angebot, folien, lesen, spike, frueh, blockiert, projekt, workshop];
  for (let i = 0; i < viele.length; i++) await buche(viele[i]!, voll, 30, `${String(8 + i).padStart(2, '0')}:00`, { titel: `Kurztermin ${i + 1} von ${viele.length}` });
  await frei('Frei · Kurzreservierung', voll, 30);

  // ---- Freitag: langer Termin 13–17 Uhr (Kapazität 5 h → 80 %)
  await buche(workshop, freitag, 240, '13:00');
  // ---- Samstag: Kapazität 0 → jede Buchung überbucht
  await buche(garage, samstag, 60);

  // ---- über Wochen und den Monatswechsel
  // (nur Werktage, nicht auf den Stufen-Tagen oben)
  const belegt = new Set([gruen, gelb, rot, ueber, raender, voll, freitag]);
  const spaeter = tage([0, 1, 2, 3, 4], 30).filter(x => !belegt.has(x) && x > voll);
  for (const x of [spaeter[0], spaeter[3], spaeter[7], spaeter[12], spaeter[17]]) if (x) await buche(projekt, x, 90);
  await frei('Frei · zum Testen: aus mir eine Aufgabe machen', spaeter[1]!, 60, null, { beschreibung: 'Schublade öffnen → „Aufgabe daraus machen“, oder auf Liste/Board ziehen.' });
}

const STUFEN: Record<string, { name: string; f: (k: Kontext) => Promise<void> }> = {
  '3': { name: 'Buchungen und Kalender', f: stufe3 },
  logbuch: { name: 'Logbuch (Stufe 2 + Notizen und Abgehaktes)', f: stufeLogbuch },
  '1': { name: 'Aufgaben in der Liste', f: stufe1 },
  '2': { name: 'Status und Board', f: stufe2 },
};

// ---------------- Ablauf ----------------
async function main(): Promise<void> {
  const stufe = process.argv[2] ?? '1';
  if (!STUFEN[stufe]) throw new Error(`Unbekannte Stufe ${stufe}. Vorhanden: ${Object.keys(STUFEN).join(', ')}`);
  const geraetDatei = join(homedir(), 'Library', 'Application Support', 'Rundblick', 'geraet.json');
  const g = existsSync(geraetDatei) ? JSON.parse(readFileSync(geraetDatei, 'utf8')) as { geraet?: string; datenordner?: string } : {};
  const datenordner = process.env.RB_DATEN ?? g.datenordner ?? join(homedir(), 'Dropbox', 'Apps', 'Rundblick');
  const geraet = g.geraet ?? 'testdaten';

  const ev = join(datenordner, 'events');
  if (existsSync(ev)) for (const f of readdirSync(ev).filter(x => x.endsWith('.jsonl'))) rmSync(join(ev, f));

  // Verstellbare Uhr für Events in der Vergangenheit (Logbuch); sonst Systemzeit
  let gestellt: Date | null = null;
  const uhr: Uhr = {
    jetzt: () => gestellt ? new Date(gestellt) : systemUhr.jetzt(),
    heute: () => (gestellt ? datumLokal(gestellt) : systemUhr.heute()),
    minuteDesTages: () => (gestellt ? gestellt.getHours() * 60 + gestellt.getMinutes() : systemUhr.minuteDesTages()),
  };
  const store = new JsonlEventStore(datenordner, geraet, ulidGenerator.neu, () => uhr.jetzt());
  const body = new RundblickBody({
    domain: new Domain(store), uhr, ids: ulidGenerator, einstellungen: speicherEinstellungen(),
    kalender: beispielKalender(), cache: kalenderCache(), anhaenge: dateiAnhaenge(datenordner), info: { datenordner, geraet },
  });
  body.einrichten();
  const heute = systemUhr.heute();
  const neu = async (x: AufgabeEingabe) => {
    const r = await body.aufgabeErfassen({ neu: false, ...x }); // Testdaten fluten „Neu“ nicht
    if (!r.ok) throw new Error(`${x.titel}: ${r.fehler.join(' ')}`);
    return r.ids!.aufgabeId!;
  };
  const zeitreise = (tage: number, uhrzeit: string) => { const [h, m] = uhrzeit.split(':').map(Number); const t = new Date(); t.setDate(t.getDate() + tage); t.setHours(h!, m!, 0, 0); gestellt = t; };
  await STUFEN[stufe]!.f({ body, heute, d: n => plusTage(heute, n), neu, zeitreise, zurueck: () => { gestellt = null; } });
  const l = await body.liste({});
  console.log(`Stufe ${stufe} (${STUFEN[stufe]!.name}) → ${datenordner}/events/${geraet}.jsonl`);
  console.log(`  ${store.lesen().events.length} Events · ${l.offen} offen · ${l.zurueckgestellt.length} zurückgestellt · ${l.abgeschlossen.length} abgeschlossen`);
  for (const gr of l.gruppen) console.log(`  ${gr.name.padEnd(13)} ${gr.aufgaben.length}`);
  const b = await body.board();
  for (const k of b.kategorien) console.log(`  Board ${k.name.padEnd(15)} ${k.spalten.map(x => `${x.name} ${x.karten.length}`).join(' · ')}`);
  const lb = await body.logbuch({ tage: 60 });
  console.log(`  Logbuch: ${lb.tage.filter(t => t.eintraege.length).length} Tage, ${lb.tage.reduce((n, t) => n + t.eintraege.length, 0)} Einträge`);
}

main().catch(e => { console.error(e); process.exit(1); });
