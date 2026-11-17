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
import { speicherEinstellungen } from '../src/providers/einstellungen/json';
import { JsonlEventStore } from '../src/providers/eventstore/jsonl';
import { ulidGenerator } from '../src/providers/ids/ulid';
import { kalenderCache } from '../src/providers/kalender/cache';
import { beispielKalender } from '../src/providers/kalender/fake';
import { systemUhr } from '../src/providers/uhr/system';

type Kontext = { body: Body; heute: string; d: (n: number) => string; neu: (x: AufgabeEingabe) => Promise<string> };

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

const STUFEN: Record<string, { name: string; f: (k: Kontext) => Promise<void> }> = {
  '1': { name: 'Aufgaben in der Liste', f: stufe1 },
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

  const store = new JsonlEventStore(datenordner, geraet, ulidGenerator.neu, () => systemUhr.jetzt());
  const body = new RundblickBody({
    domain: new Domain(store), uhr: systemUhr, ids: ulidGenerator, einstellungen: speicherEinstellungen(),
    kalender: beispielKalender(), cache: kalenderCache(), info: { datenordner, geraet },
  });
  body.einrichten();
  const heute = systemUhr.heute();
  const neu = async (x: AufgabeEingabe) => {
    const r = await body.aufgabeErfassen(x);
    if (!r.ok) throw new Error(`${x.titel}: ${r.fehler.join(' ')}`);
    return r.ids!.aufgabeId!;
  };
  await STUFEN[stufe]!.f({ body, heute, d: n => plusTage(heute, n), neu });
  const l = await body.liste({});
  console.log(`Stufe ${stufe} (${STUFEN[stufe]!.name}) → ${datenordner}/events/${geraet}.jsonl`);
  console.log(`  ${store.lesen().events.length} Events · ${l.offen} offen · ${l.zurueckgestellt.length} zurückgestellt · ${l.abgeschlossen.length} abgeschlossen`);
  for (const gr of l.gruppen) console.log(`  ${gr.name.padEnd(13)} ${gr.aufgaben.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
