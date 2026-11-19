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

/** IDs gelesener Events mit neuerem Schema – die App kann sie nicht deuten und warnt („bitte aktualisieren“) */
const zuNeu = new Set<string>();
export const zuNeueAnzahl = () => zuNeu.size;

/** Zeilen → Events; unvollständige Zeilen (Datei wird gerade geschrieben/synchronisiert) und zu neue werden übersprungen – zu neue aber gezählt */
export function zeilenLesen(text: string): Rohevent[] {
  const ergebnis: Rohevent[] = [];
  for (const zeile of text.split('\n')) {
    if (!zeile.trim()) continue;
    let e: Rohevent;
    try { e = JSON.parse(zeile) as Rohevent; } catch { continue; /* unvollständig */ }
    if (e.meta?.schema > SCHEMA_VERSION) { zuNeu.add(e.id); continue; }
    ergebnis.push(e);
  }
  return ergebnis;
}

export const zeilenSchreiben = (events: readonly Rohevent[]) => events.map(e => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');
