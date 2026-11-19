// Event Store als JSONL-Dateien in einem (Dropbox-)Ordner: eine Datei pro Gerät.
// Jedes Gerät schreibt nur in seine eigene Datei (keine Dropbox-Konfliktkopien) und liest alle.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, watch, writeSync } from 'node:fs';
import { join } from 'node:path';
import { dateiname, istEventDatei, zeilenLesen, zeilenSchreiben } from './format';
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
    const zeilen = zeilenSchreiben(events);
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

function leseDatei(pfad: string): Rohevent[] {
  return zeilenLesen(readFileSync(pfad, 'utf8'));
}
