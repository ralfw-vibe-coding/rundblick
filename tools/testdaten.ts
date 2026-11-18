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
  await notiz('Nachgetragen: Abends noch die Folien skizziert (ohne Uhrzeit, steht am Ende des Tages)', 0, '08:00', d(-1));

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

const STUFEN: Record<string, { name: string; f: (k: Kontext) => Promise<void> }> = {
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
    const r = await body.aufgabeErfassen(x);
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
