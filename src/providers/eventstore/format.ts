// Dateiformat der Event-Dateien (JSONL, eine Datei pro Gerät) – gemeinsam für Desktop (Dateisystem)
// und Phone App (Dropbox-API), damit beide exakt gleich lesen und schreiben.
import { SCHEMA_VERSION } from '../../schema/events';
import type { Rohevent } from './speicher';

/** Nur echte Event-Dateien – keine Dropbox-Konfliktkopien */
export const istEventDatei = (d: string) => d.endsWith('.jsonl') && !d.includes('conflicted') && !d.includes('Konflikt');

/** Dateiname (ohne Endung) zu einem Gerätenamen */
export function dateiname(geraet: string): string {
  return geraet.toLowerCase().replace(/[^a-z0-9äöüß-]+/g, '-').replace(/^-|-$/g, '') || 'geraet';
}

/** Zeilen → Events; unvollständige Zeilen (Datei wird gerade geschrieben/synchronisiert) und zu neue werden übersprungen */
export function zeilenLesen(text: string): Rohevent[] {
  const ergebnis: Rohevent[] = [];
  for (const zeile of text.split('\n')) {
    if (!zeile.trim()) continue;
    // Events aus einer neueren Schema-Version werden übersprungen (diese App kann sie nicht deuten)
    try { ergebnis.push(hochrechnen(JSON.parse(zeile) as Rohevent)); } catch { /* unvollständig oder zu neu */ }
  }
  return ergebnis;
}

export const zeilenSchreiben = (events: readonly Rohevent[]) => events.map(e => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');

/** Upcaster: ältere Schema-Versionen beim Lesen anheben (bisher gibt es nur Version 1) */
function hochrechnen(e: Rohevent): Rohevent {
  if (e.meta.schema > SCHEMA_VERSION) throw new Error(`Event-Schema ${e.meta.schema} ist neuer als diese App (${SCHEMA_VERSION})`);
  return e;
}
