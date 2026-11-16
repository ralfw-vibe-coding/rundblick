// Ablauf jedes Commands: Kontext lesen → Kontextmodell entwickeln → entscheiden → bedingt anhängen.
// Kam zwischen Lesen und Anhängen ein relevantes Event dazu, wird der Command wiederholt.
import type { EventAbfrage, EventStore } from '../../providers/eventstore/interface';
import type { DomainEvent, NeuesEvent } from '../../schema/events';

export type Ergebnis = { ok: true } | { ok: false; fehler: string[] };
export const OK: Ergebnis = { ok: true };
export const fehler = (...f: string[]): Ergebnis => ({ ok: false, fehler: f });

export type Entscheidung = NeuesEvent[] | { ok: false; fehler: string[] };

export function entscheide<M>(
  es: EventStore,
  abfrage: EventAbfrage,
  start: () => M,
  entwickle: (m: M, e: DomainEvent) => M,
  regel: (m: M) => Entscheidung,
): Ergebnis {
  for (let versuch = 0; versuch < 3; versuch++) {
    const { events, position } = es.lesen(abfrage);
    const modell = events.reduce(entwickle, start());
    const r = regel(modell);
    if (!Array.isArray(r)) return r;
    const a = es.anhaengen(r, { abfrage, nachPosition: position });
    if (a.ok) return OK;
  }
  return fehler('Gleichzeitige Änderung – bitte noch einmal versuchen.');
}

export const nichtLeer = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;
