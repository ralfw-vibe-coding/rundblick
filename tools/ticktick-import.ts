// Einmaliger Import offener Aufgaben aus einem TickTick-Backup (CSV).
//   npm run ticktick-import -- <backup.csv> [--ohne-liste Mittagsvideo] [--probe]
// Datenordner wie die App (geraet.json) oder RB_DATEN. Schreibt in eine EIGENE Gerätedatei
// events/ticktick-import.jsonl – nichts Bestehendes wird verändert; Rückgängig = diese Datei löschen.
// Abbildung: nur offene Aufgaben (Status 0); Fälligkeit → Frist (Datum in der Zeitzone der Aufgabe,
// TickTick exportiert in UTC); Inhalt → Notiz, Checklisten (▫/▪) → „- [ ]“/„- [x]“; Tags; Wiederholung
// (RRULE FREQ/INTERVAL) → Wiederholung ab Frist. Importierte Aufgaben stehen nicht unter „Neu“
// und tragen den Tag #ticktick (Nutzer 19.11.2026), damit man sie findet.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { RundblickBody } from '../src/body/body';
import type { AufgabeEingabe } from '../src/body/interface';
import { Domain } from '../src/domain/domain';
import { dateiAnhaenge } from '../src/providers/anhaenge/datei';
import { speicherEinstellungen } from '../src/providers/einstellungen/json';
import { JsonlEventStore } from '../src/providers/eventstore/jsonl';
import { ulidGenerator } from '../src/providers/ids/ulid';
import { kalenderCache } from '../src/providers/kalender/cache';
import { beispielKalender } from '../src/providers/kalender/fake';
import { systemUhr } from '../src/providers/uhr/system';
import type { Wiederholung } from '../src/schema/werte';

/** CSV nach RFC 4180 (Felder in Anführungszeichen, "" = ", Zeilenumbrüche in Feldern) */
function csv(text: string): string[][] {
  const zeilen: string[][] = []; let z: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; continue; }
    if (c === '"') q = true; else if (c === ',') { z.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; z.push(f); zeilen.push(z); z = []; f = ''; } else f += c;
  }
  if (f || z.length) { z.push(f); zeilen.push(z); }
  return zeilen;
}

/** UTC-Zeitpunkt → Kalenderdatum in der Zeitzone der Aufgabe */
function datum(iso: string, zone: string): string | null {
  if (!iso) return null;
  const d = new Date(iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone || 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function wiederholung(rrule: string): Wiederholung | null {
  const t = Object.fromEntries(rrule.split(';').map(x => x.split('=')));
  const einheit = ({ DAILY: 'tag', WEEKLY: 'woche', MONTHLY: 'monat', YEARLY: 'jahr' } as const)[t.FREQ as 'DAILY'];
  return einheit ? { einheit, alle: Number(t.INTERVAL ?? 1) || 1 } : null;
}

const notiz = (inhalt: string, checkliste: boolean) => !checkliste ? inhalt.trim()
  : inhalt.split('\n').map(z => z.replace(/^▫\s*/, '- [ ] ').replace(/^▪\s*/, '- [x] ')).join('\n').trim();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const datei = args.find(a => !a.startsWith('--'));
  const ohne = args.flatMap((a, i) => (a === '--ohne-liste' ? [args[i + 1]!] : []));
  const probe = args.includes('--probe');
  if (!datei) throw new Error('Aufruf: npm run ticktick-import -- <backup.csv> [--ohne-liste <Liste>] [--probe]');

  const alle = csv(readFileSync(datei, 'utf8').replace(/^﻿/, ''));
  const k = alle.findIndex(z => z.includes('Title') && z.includes('Repeat'));
  const kopf = alle[k]!;
  const zeilen = alle.slice(k + 1).filter(z => z.length === kopf.length).map(z => Object.fromEntries(kopf.map((h, i) => [h, z[i]!])));
  const offen = zeilen.filter(z => z.Status === '0' && !ohne.includes(z['List Name']!));
  // TickTick-Reihenfolge (Order) beibehalten: neue Aufgaben kommen in Rundblick oben hinein → rückwärts anlegen
  offen.sort((a, b) => Number(b.Order) - Number(a.Order));

  const aufgaben: AufgabeEingabe[] = offen.map(z => {
    const frist = datum(z['Due Date']!, z.Timezone!);
    const w = z.Repeat ? wiederholung(z.Repeat) : null;
    const hinweise = [Number(z.Priority) >= 3 ? 'TickTick: hohe Priorität' : '', w || !z.Repeat ? '' : `TickTick-Wiederholung: ${z.Repeat}`].filter(Boolean);
    return {
      titel: z.Title!.trim(), beschreibung: [notiz(z.Content ?? '', z.Kind === 'CHECKLIST'), ...hinweise].filter(Boolean).join('\n\n'),
      tags: ['ticktick', ...(z.Tags ?? '').split(',').map(t => t.trim()).filter(Boolean)], frist,
      ...(w && frist ? { wiederholung: w } : {}), neu: false,
    };
  });

  const geraetDatei = join(homedir(), 'Library', 'Application Support', 'Rundblick', 'geraet.json');
  const g = existsSync(geraetDatei) ? JSON.parse(readFileSync(geraetDatei, 'utf8')) as { datenordner?: string } : {};
  const datenordner = process.env.RB_DATEN ?? g.datenordner ?? join(homedir(), 'Dropbox', 'Apps', 'Rundblick');
  const heute = systemUhr.heute();
  const anzahl = (f: (a: AufgabeEingabe) => boolean) => aufgaben.filter(f).length;
  console.log(`${offen.length} offene Aufgaben aus ${[...new Set(offen.map(z => z['List Name']))].join(', ')} → ${datenordner}`);
  console.log(`  Fällig (bis heute): ${anzahl(a => !!a.frist && a.frist <= heute)} · Ohne Frist: ${anzahl(a => !a.frist)} · Wird fällig: ${anzahl(a => !!a.frist && a.frist > heute)} · davon wiederkehrend: ${anzahl(a => !!a.wiederholung)}`);
  if (probe) { for (const a of aufgaben) console.log(`  ${a.frist ?? '          '} ${a.wiederholung ? `↻${a.wiederholung.alle}${a.wiederholung.einheit[0]}` : '   '} ${a.titel.slice(0, 70)}`); return; }

  if (existsSync(join(datenordner, 'events', 'ticktick-import.jsonl'))) throw new Error('Schon importiert (events/ticktick-import.jsonl existiert) – zum Wiederholen erst diese Datei löschen.');
  const store = new JsonlEventStore(datenordner, 'ticktick-import', ulidGenerator.neu, () => systemUhr.jetzt());
  const body = new RundblickBody({
    domain: new Domain(store), uhr: systemUhr, ids: ulidGenerator, einstellungen: speicherEinstellungen(),
    kalender: beispielKalender(), cache: kalenderCache(), anhaenge: dateiAnhaenge(datenordner), info: { datenordner, geraet: 'ticktick-import' },
  });
  let ok = 0;
  for (const a of aufgaben) {
    const r = await body.aufgabeErfassen(a);
    if (r.ok) ok++; else console.error(`  übersprungen: ${a.titel} – ${r.fehler.join(' ')}`);
  }
  console.log(`${ok} Aufgaben importiert.`);
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
