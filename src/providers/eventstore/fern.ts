// Event Store der Phone App: offline-first. Alle bekannten Events liegen lokal (IndexedDB, über
// `LokalerEventSpeicher`), der Abgleich läuft über eine `Fernablage` (Dropbox-API, App-Ordner).
//  - Jedes Gerät schreibt nur seine eigene Datei `events/<gerät>.jsonl` – hier: komplett neu hochladen,
//    mit Revisionsprüfung (nur dieses Gerät schreibt sie; ein Konflikt heißt: frühere Installation
//    mit demselben Namen → zusammenführen und erneut hochladen).
//  - Fremde Dateien wachsen nur am Ende (Desktop hängt an): es wird nur der neue Teil geladen (Range).
//  - Reihenfolge über die Hybrid Logical Clock wie am Desktop (SpeicherEventStore).
import { dateiname, istEventDatei, zeilenLesen, zeilenSchreiben } from './format';
import { stromVergleich } from './hlc';
import { SpeicherEventStore, type Rohevent } from './speicher';

export type FernDatei = { name: string; rev: string; groesse: number };

/** Ordner `events/` in der Ablage (Pfade relativ zu diesem Ordner, nur Dateinamen) */
export interface Fernablage {
  /** Dateien des Ordners; mit Cursor nur die Änderungen seither. `mehr` = weitere Seite abholen */
  auflisten(cursor: string | null): Promise<{ dateien: FernDatei[]; cursor: string; mehr: boolean }>;
  /** Inhalt ab Byte `ab`; null, wenn es die Datei nicht gibt */
  lesen(name: string, ab?: number): Promise<{ daten: Uint8Array; rev: string } | null>;
  /** Schreibt die ganze Datei. rev null = neu anlegen. Konflikt, wenn die Datei inzwischen eine andere Revision hat */
  schreiben(name: string, daten: Uint8Array, rev: string | null): Promise<{ ok: true; rev: string } | { ok: false; konflikt: true }>;
  /** Wartet (Longpoll) auf Änderungen nach `cursor`; true = es gibt welche */
  warten(cursor: string): Promise<boolean>;
}

export type FernZustand = {
  cursor: string | null;
  /** Revision der eigenen Datei nach dem letzten Hochladen */
  eigeneRev: string | null;
  /** so viele eigene Events stehen bereits in der Ablage */
  bestaetigt: number;
  /** je fremder Datei: bis zu welchem Byte gelesen */
  gelesen: Record<string, number>;
  zuletzt: string | null;
};

export interface LokalerEventSpeicher {
  laden(): Promise<{ events: Rohevent[]; zustand: FernZustand | null }>;
  /** neue (eigene oder fremde) Events dauerhaft ablegen */
  hinzufuegen(events: Rohevent[]): Promise<void>;
  zustandSpeichern(z: FernZustand): Promise<void>;
}

export type FernStand = { laeuft: boolean; online: boolean; wartend: number; zuletzt: string | null; fehler: string | null };

const LEER: FernZustand = { cursor: null, eigeneRev: null, bestaetigt: 0, gelesen: {}, zuletzt: null };
const kodieren = (t: string) => new TextEncoder().encode(t);
const dekodieren = (b: Uint8Array) => new TextDecoder().decode(b);

/** Fehlerart der Ablage: offline (Netz) – sonst gilt der Fehler als echter Fehler */
export class OfflineFehler extends Error {}

export class FernEventStore extends SpeicherEventStore {
  private eigene: Rohevent[] = [];
  private zustand: FernZustand = { ...LEER, gelesen: {} };
  private fern: Fernablage | null = null;
  private lauf: Promise<void> | null = null;
  private nochmal = false;
  private stand: FernStand = { laeuft: false, online: true, wartend: 0, zuletzt: null, fehler: null };
  private standAbos = new Set<() => void>();
  /** Kette der lokalen Schreibvorgänge – `fertig()` wartet darauf (Tests, Abmelden) */
  private schreiben: Promise<void> = Promise.resolve();

  private constructor(geraet: string, neueId: () => string, jetzt: () => Date, private readonly lokal: LokalerEventSpeicher) {
    super(geraet, neueId, jetzt);
  }

  /** Lädt alle lokal bekannten Events und den Abgleich-Zustand */
  static async oeffnen(o: { geraet: string; neueId: () => string; jetzt: () => Date; lokal: LokalerEventSpeicher }): Promise<FernEventStore> {
    const s = new FernEventStore(o.geraet, o.neueId, o.jetzt, o.lokal);
    const { events, zustand } = await o.lokal.laden();
    if (zustand) s.zustand = { ...LEER, ...zustand, gelesen: { ...zustand.gelesen } };
    s.uebernehmen(events, false);
    s.eigene = events.filter(e => e.meta.geraet === o.geraet).sort(stromVergleich);
    s.stand = { ...s.stand, zuletzt: s.zustand.zuletzt, wartend: s.wartend() };
    return s;
  }

  get dateiname(): string { return `${dateiname(this.geraet)}.jsonl`; }

  /** Verbindung zur Ablage setzen (null = getrennt, nur lokal) */
  verbinden(fern: Fernablage | null): void {
    this.fern = fern;
    if (!fern) this.standSetzen({ fehler: null, online: true });
  }

  /** Beim Trennen: Abgleich-Zustand vergessen, damit ein neues Konto von vorn liest */
  async zuruecksetzen(): Promise<void> {
    this.zustand = { ...LEER, gelesen: {} };
    this.schreiben = this.schreiben.then(() => this.lokal.zustandSpeichern(this.zustand));
    await this.schreiben;
    this.standSetzen({ wartend: this.wartend(), zuletzt: null });
  }

  wartend(): number { return Math.max(0, this.eigene.length - this.zustand.bestaetigt); }
  abgleichStand(): FernStand { return this.stand; }
  beiStand(cb: () => void): () => void { this.standAbos.add(cb); return () => { this.standAbos.delete(cb); }; }
  async fertig(): Promise<void> { await this.schreiben; }

  protected override persistieren(events: Rohevent[]): void {
    this.eigene.push(...events);
    this.schreiben = this.schreiben.then(() => this.lokal.hinzufuegen(events));
    this.standSetzen({ wartend: this.wartend() });
  }

  /**
   * Holt fremde Änderungen und lädt die eigene Datei hoch. Läuft höchstens einmal gleichzeitig;
   * wird währenddessen erneut angestoßen, folgt direkt ein weiterer Durchgang.
   */
  abgleichen(): Promise<void> {
    if (this.lauf) { this.nochmal = true; return this.lauf; }
    this.lauf = (async () => {
      try {
        do { this.nochmal = false; await this.durchgang(); } while (this.nochmal);
      } finally { this.lauf = null; }
    })();
    return this.lauf;
  }

  /** Wartet auf Änderungen in der Ablage (Longpoll). false ohne Verbindung oder Cursor */
  async aufAenderungWarten(): Promise<boolean> {
    if (!this.fern || !this.zustand.cursor) return false;
    return this.fern.warten(this.zustand.cursor);
  }

  private async durchgang(): Promise<void> {
    const fern = this.fern;
    if (!fern) return;
    this.standSetzen({ laeuft: true });
    try {
      await this.holen(fern);
      await this.hochladen(fern);
      this.zustand.zuletzt = this.jetztIso();
      this.schreiben = this.schreiben.then(() => this.lokal.zustandSpeichern(this.zustand));
      await this.schreiben;
      this.standSetzen({ laeuft: false, online: true, fehler: null, zuletzt: this.zustand.zuletzt, wartend: this.wartend() });
    } catch (e) {
      const offline = e instanceof OfflineFehler;
      this.standSetzen({ laeuft: false, online: !offline, fehler: offline ? null : (e as Error).message, wartend: this.wartend() });
      throw e;
    }
  }

  private async holen(fern: Fernablage): Promise<void> {
    let mehr = true;
    while (mehr) {
      const r = await fern.auflisten(this.zustand.cursor);
      for (const d of r.dateien) {
        if (!istEventDatei(d.name)) continue;
        if (d.name === this.dateiname) await this.eigeneDateiPruefen(fern, d);
        else await this.fremdeLesen(fern, d);
      }
      this.zustand.cursor = r.cursor;
      mehr = r.mehr;
    }
  }

  /** Fremde Datei: nur den neuen Teil laden (bis zur letzten vollständigen Zeile) */
  private async fremdeLesen(fern: Fernablage, d: FernDatei): Promise<void> {
    let ab = this.zustand.gelesen[d.name] ?? 0;
    if (d.groesse < ab) ab = 0; // Datei wurde ersetzt/gekürzt → von vorn
    if (d.groesse === ab) return;
    const r = await fern.lesen(d.name, ab);
    if (!r) return;
    const ende = r.daten.lastIndexOf(0x0a) + 1;
    if (ende === 0) return; // noch keine vollständige Zeile
    const neu = this.uebernehmen(zeilenLesen(dekodieren(r.daten.subarray(0, ende))), true);
    this.zustand.gelesen[d.name] = ab + ende;
    if (neu.length) this.lokalAblegen(neu);
  }

  /** Eigene Datei mit fremder Revision: frühere Installation mit gleichem Gerätenamen → zusammenführen */
  private async eigeneDateiPruefen(fern: Fernablage, d: FernDatei): Promise<void> {
    if (d.rev === this.zustand.eigeneRev) return;
    const r = await fern.lesen(d.name);
    if (r) this.zusammenfuehren(r.daten, r.rev);
  }

  private zusammenfuehren(daten: Uint8Array, rev: string): void {
    const dort = zeilenLesen(dekodieren(daten));
    const bekannt = new Set(this.eigene.map(e => e.id));
    const neu = dort.filter(e => !bekannt.has(e.id));
    const uebernommen = this.uebernehmen(neu, true);
    if (uebernommen.length) this.lokalAblegen(uebernommen);
    this.eigene = [...this.eigene, ...neu].sort(stromVergleich);
    const dortIds = new Set(dort.map(e => e.id));
    // bestätigt = vorderer Teil, der vollständig in der Ablage liegt
    let n = 0;
    while (n < this.eigene.length && dortIds.has(this.eigene[n]!.id)) n++;
    this.zustand.bestaetigt = n;
    this.zustand.eigeneRev = rev;
  }

  private async hochladen(fern: Fernablage): Promise<void> {
    for (let versuch = 0; versuch < 3; versuch++) {
      if (this.wartend() === 0) return;
      const anzahl = this.eigene.length;
      const r = await fern.schreiben(this.dateiname, kodieren(zeilenSchreiben(this.eigene)), this.zustand.eigeneRev);
      if (r.ok) { this.zustand.eigeneRev = r.rev; this.zustand.bestaetigt = anzahl; return; }
      const dort = await fern.lesen(this.dateiname);
      if (dort) this.zusammenfuehren(dort.daten, dort.rev);
      else this.zustand.eigeneRev = null; // inzwischen gelöscht → neu anlegen
    }
    throw new Error('Eigene Event-Datei konnte nicht hochgeladen werden (wiederholter Konflikt)');
  }

  private lokalAblegen(events: { position: number }[]): void {
    const roh = events.map(({ position: _p, ...r }) => r as Rohevent);
    this.schreiben = this.schreiben.then(() => this.lokal.hinzufuegen(roh));
  }

  private jetztIso(): string { return this.jetzt().toISOString(); }

  private standSetzen(t: Partial<FernStand>): void {
    this.stand = { ...this.stand, ...t };
    this.standAbos.forEach(cb => cb());
  }
}
