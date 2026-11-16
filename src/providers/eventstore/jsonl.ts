// Event Store als JSONL-Dateien in einem (Dropbox-)Ordner: eine Datei pro Gerät.
// Jedes Gerät schreibt nur in seine eigene Datei (keine Dropbox-Konfliktkopien) und liest alle.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, watch, writeSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_VERSION } from '../../schema/events';
import { SpeicherEventStore, type Rohevent } from './speicher';

export class JsonlEventStore extends SpeicherEventStore {
  private readonly ordner: string;
  private readonly eigeneDatei: string;

  constructor(datenordner: string, geraet: string, neueId: () => string, jetzt: () => Date) {
    super(geraet, neueId, jetzt);
    this.ordner = join(datenordner, 'events');
    mkdirSync(this.ordner, { recursive: true });
    this.eigeneDatei = join(this.ordner, `${dateiname(geraet)}.jsonl`);
    const alle = readdirSync(this.ordner).filter(istEventDatei).flatMap(d => leseDatei(join(this.ordner, d)));
    this.uebernehmen(alle, false);
  }

  protected override persistieren(events: Rohevent[]): void {
    const zeilen = events.map(e => JSON.stringify(e)).join('\n') + '\n';
    const fd = openSync(this.eigeneDatei, 'a');
    try { writeSync(fd, zeilen); fsyncSync(fd); } finally { closeSync(fd); }
  }

  /** Beobachtet den Ordner und übernimmt Events anderer Geräte (z. B. per Dropbox synchronisiert) */
  beobachten(): () => void {
    const offen = new Map<string, ReturnType<typeof setTimeout>>();
    const w = watch(this.ordner, (_art, datei) => {
      if (!datei || !istEventDatei(datei) || join(this.ordner, datei) === this.eigeneDatei) return;
      clearTimeout(offen.get(datei));
      offen.set(datei, setTimeout(() => this.einlesen(join(this.ordner, datei)), 300));
    });
    return () => { w.close(); offen.forEach(t => clearTimeout(t)); };
  }

  /** Liest eine (fremde) Datei erneut und übernimmt unbekannte Events */
  einlesen(pfad: string): number {
    if (!existsSync(pfad)) return 0;
    return this.uebernehmen(leseDatei(pfad), true).length;
  }

  get pfad(): string { return this.eigeneDatei; }
}

const istEventDatei = (d: string) => d.endsWith('.jsonl') && !d.includes('conflicted') && !d.includes('Konflikt');

function dateiname(geraet: string): string {
  return geraet.toLowerCase().replace(/[^a-z0-9äöüß-]+/g, '-').replace(/^-|-$/g, '') || 'geraet';
}

function leseDatei(pfad: string): Rohevent[] {
  const ergebnis: Rohevent[] = [];
  for (const zeile of readFileSync(pfad, 'utf8').split('\n')) {
    if (!zeile.trim()) continue;
    try { ergebnis.push(hochrechnen(JSON.parse(zeile) as Rohevent)); }
    catch { /* unvollständige Zeile (Datei wird gerade geschrieben/synchronisiert): beim nächsten Einlesen */ }
  }
  return ergebnis;
}

/** Upcaster: ältere Schema-Versionen beim Lesen anheben (bisher gibt es nur Version 1) */
function hochrechnen(e: Rohevent): Rohevent {
  if (e.meta.schema > SCHEMA_VERSION) throw new Error(`Event-Schema ${e.meta.schema} ist neuer als diese App (${SCHEMA_VERSION})`);
  return e;
}
