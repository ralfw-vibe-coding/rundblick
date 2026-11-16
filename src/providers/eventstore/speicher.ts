// Event Store im Arbeitsspeicher. Grundlage für den JSONL-Store und für Tests.
import { SCHEMA_VERSION, type GespeichertesEvent, type NeuesEvent } from '../../schema/events';
import { Hlc, stromVergleich } from './hlc';
import { passt, type Aenderung, type AnhaengenErgebnis, type Bedingung, type EventAbfrage, type EventStore } from './interface';

export type Rohevent = Omit<GespeichertesEvent, 'position'>;

export class SpeicherEventStore implements EventStore {
  protected strom: GespeichertesEvent[] = [];
  protected bekannt = new Set<string>();
  protected readonly hlc: Hlc;
  private abos = new Set<(a: Aenderung) => void>();

  constructor(
    protected readonly geraet: string,
    private readonly neueId: () => string,
    private readonly jetzt: () => Date,
  ) {
    this.hlc = new Hlc(() => this.jetzt().getTime());
  }

  lesen(abfrage: EventAbfrage = {}): { events: GespeichertesEvent[]; position: number } {
    return { events: this.strom.filter(e => passt(e, abfrage)), position: this.strom.length };
  }

  anhaengen(neu: NeuesEvent[], bedingung?: Bedingung): AnhaengenErgebnis {
    if (bedingung && this.strom.some(e => e.position > bedingung.nachPosition && passt(e, bedingung.abfrage))) {
      return { ok: false, konflikt: true };
    }
    if (neu.length === 0) return { ok: true, events: [] };
    const zeit = this.jetzt().toISOString();
    const roh: Rohevent[] = neu.map(n => ({
      ...n, id: this.neueId(), zeit, meta: { schema: SCHEMA_VERSION, geraet: this.geraet, hlc: this.hlc.neu() },
    }));
    this.persistieren(roh);
    const basis = this.strom.length;
    const gespeichert = roh.map((r, i) => ({ ...r, position: basis + i + 1 }) as GespeichertesEvent);
    this.strom.push(...gespeichert);
    gespeichert.forEach(g => this.bekannt.add(g.id));
    this.melde({ events: gespeichert, fremd: false });
    return { ok: true, events: gespeichert };
  }

  abonnieren(cb: (a: Aenderung) => void): () => void {
    this.abos.add(cb);
    return () => { this.abos.delete(cb); };
  }

  /** Schreibt neue Events dauerhaft weg. Im Speicher-Store: nichts. */
  protected persistieren(_events: Rohevent[]): void { /* nur im Speicher */ }

  /** Übernimmt gelesene/fremde Events: einsortieren, Positionen neu vergeben, ggf. melden */
  protected uebernehmen(events: Rohevent[], melden: boolean): GespeichertesEvent[] {
    const neu = events.filter(e => !this.bekannt.has(e.id));
    if (neu.length === 0) return [];
    neu.forEach(e => { this.bekannt.add(e.id); this.hlc.sehen(e.meta.hlc); });
    const alle = [...this.strom.map(({ position: _p, ...r }) => r as Rohevent), ...neu].sort(stromVergleich);
    this.strom = alle.map((r, i) => ({ ...r, position: i + 1 }) as GespeichertesEvent);
    const ids = new Set(neu.map(e => e.id));
    const ergebnis = this.strom.filter(e => ids.has(e.id));
    if (melden) this.melde({ events: ergebnis, fremd: true });
    return ergebnis;
  }

  private melde(a: Aenderung): void {
    this.abos.forEach(cb => cb(a));
  }
}
