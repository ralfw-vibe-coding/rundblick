// Anhänge der Phone App: lokal (IndexedDB) und in der Ablage (Dropbox, `anhaenge/<id>`).
// Das Interface ist synchron (wie am Desktop): fehlt ein Bild noch im Speicher, liefert `lesen` null und
// lädt es im Hintergrund – erst lokal, sonst aus der Ablage; `beiAnkunft` meldet, wenn es da ist.
// Hochladen und Löschen laufen über eine Warteschlange, die offline erhalten bleibt.
import type { Anhangspeicher } from './interface';

export type AnhangAuftrag = { art: 'hoch' | 'weg'; id: string };

export interface AnhangLokal {
  lesen(id: string): Promise<Uint8Array | null>;
  schreiben(id: string, daten: Uint8Array): Promise<void>;
  entfernen(id: string): Promise<void>;
  warteschlangeLesen(): Promise<AnhangAuftrag[]>;
  warteschlangeSchreiben(a: AnhangAuftrag[]): Promise<void>;
}

/** Ordner `anhaenge/` in der Ablage */
export interface AnhangFern {
  lesen(id: string): Promise<Uint8Array | null>;
  schreiben(id: string, daten: Uint8Array): Promise<void>;
  loeschen(id: string): Promise<void>;
}

export class FernAnhaenge implements Anhangspeicher {
  private speicher = new Map<string, Uint8Array>();
  private unterwegs = new Set<string>();
  private fehlt = new Set<string>();
  private schlange: AnhangAuftrag[] = [];
  private fern: AnhangFern | null = null;
  private ankunft = new Set<(id: string) => void>();
  private kette: Promise<void> = Promise.resolve();
  private lauf: Promise<void> | null = null;

  private constructor(private readonly lokal: AnhangLokal) {}

  static async oeffnen(lokal: AnhangLokal): Promise<FernAnhaenge> {
    const a = new FernAnhaenge(lokal);
    a.schlange = await lokal.warteschlangeLesen();
    return a;
  }

  verbinden(fern: AnhangFern | null): void { this.fern = fern; this.fehlt.clear(); }
  wartend(): number { return this.schlange.length; }
  beiAnkunft(cb: (id: string) => void): () => void { this.ankunft.add(cb); return () => { this.ankunft.delete(cb); }; }
  async fertig(): Promise<void> { await this.kette; await this.lauf; }

  speichern(id: string, daten: Uint8Array): void {
    this.speicher.set(id, daten);
    this.fehlt.delete(id);
    this.einreihen({ art: 'hoch', id }, () => this.lokal.schreiben(id, daten));
  }

  lesen(id: string): Uint8Array | null {
    const d = this.speicher.get(id);
    if (d) return d;
    if (!this.unterwegs.has(id) && !this.fehlt.has(id)) void this.nachladen(id);
    return null;
  }

  entfernen(id: string): void {
    this.speicher.delete(id);
    this.einreihen({ art: 'weg', id }, () => this.lokal.entfernen(id));
  }

  /** Warteschlange abarbeiten (nur mit Verbindung); Fehler brechen ab, der Rest bleibt für später */
  abgleichen(): Promise<void> {
    this.lauf ??= (async () => {
      try {
        await this.kette;
        while (this.fern && this.schlange.length) {
          const a = this.schlange[0]!;
          if (a.art === 'weg') await this.fern.loeschen(a.id);
          else {
            const d = this.speicher.get(a.id) ?? await this.lokal.lesen(a.id);
            if (d) await this.fern.schreiben(a.id, d);
          }
          this.schlange.shift();
          await this.lokal.warteschlangeSchreiben([...this.schlange]);
        }
      } finally { this.lauf = null; }
    })();
    return this.lauf;
  }

  private einreihen(auftrag: AnhangAuftrag, lokal: () => Promise<void>): void {
    // ein späterer Auftrag zur selben ID ersetzt frühere (hoch → weg: nichts hochladen)
    this.schlange = [...this.schlange.filter(a => a.id !== auftrag.id), auftrag];
    const schlange = [...this.schlange];
    this.kette = this.kette.then(lokal).then(() => this.lokal.warteschlangeSchreiben(schlange));
  }

  private async nachladen(id: string): Promise<void> {
    this.unterwegs.add(id);
    try {
      let d = await this.lokal.lesen(id);
      if (!d && this.fern) {
        d = await this.fern.lesen(id);
        if (d) await this.lokal.schreiben(id, d);
      }
      if (d) { this.speicher.set(id, d); this.ankunft.forEach(cb => cb(id)); }
      else if (this.fern) this.fehlt.add(id); // gibt es (noch) nicht – erst nach neuer Verbindung wieder fragen
    } catch { /* offline: beim nächsten Lesen erneut versuchen */ }
    finally { this.unterwegs.delete(id); }
  }
}
