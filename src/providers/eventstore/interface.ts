// Domain state provider: append-only Event Store mit Abfrage nach Typen/Tags und bedingtem Anhängen.
import type { EventTyp, GespeichertesEvent, NeuesEvent } from '../../schema/events';

/** Ein Event passt, wenn sein Typ in `typen` liegt (falls angegeben) UND es mindestens einen der `tags` trägt (falls angegeben). */
export type EventAbfrage = { typen?: readonly EventTyp[]; tags?: readonly string[] };

export type Bedingung = { abfrage: EventAbfrage; nachPosition: number };

export type AnhaengenErgebnis =
  | { ok: true; events: GespeichertesEvent[] }
  | { ok: false; konflikt: true };

export type Aenderung = {
  events: GespeichertesEvent[];
  /** true, wenn Events eines anderen Geräts eingetroffen sind (Reihenfolge kann sich verschoben haben) */
  fremd: boolean;
};

export interface EventStore {
  /** Alle passenden Events in Stromreihenfolge, dazu die höchste Position des gesamten Stroms */
  lesen(abfrage?: EventAbfrage): { events: GespeichertesEvent[]; position: number };
  /** Hängt atomar an. Mit Bedingung: schlägt fehl, wenn nach `nachPosition` ein passendes Event hinzukam. */
  anhaengen(events: NeuesEvent[], bedingung?: Bedingung): AnhaengenErgebnis;
  abonnieren(cb: (a: Aenderung) => void): () => void;
}

export function passt(e: { typ: string; tags: readonly string[] }, a: EventAbfrage): boolean {
  if (a.typen && !a.typen.includes(e.typ as EventTyp)) return false;
  if (a.tags && !a.tags.some(t => e.tags.includes(t))) return false;
  return true;
}
