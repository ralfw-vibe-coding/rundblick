// Projektion für Queries: der gesamte aktuelle Zustand im Speicher, inkrementell nachgeführt.
import type { DomainEvent } from '../schema/events';
import type { Id } from '../schema/werte';
import {
  aufgabeEntwickeln, buchungEntwickeln, PLANUNG_STANDARD, planungEntwickeln, spaltenEntwickeln,
  type AufgabeZ, type BuchungZ, type PlanungZ, type SpalteZ,
} from './zustand';

export type Bestand = {
  aufgaben: Map<Id, AufgabeZ>;
  buchungen: Map<Id, BuchungZ>;
  spalten: Map<Id, SpalteZ>;
  planung: PlanungZ;
};

export function leererBestand(): Bestand {
  return { aufgaben: new Map(), buchungen: new Map(), spalten: new Map(), planung: PLANUNG_STANDARD };
}

export function anwenden(b: Bestand, e: DomainEvent): void {
  const d = e.daten as Record<string, unknown>;
  if (typeof d.aufgabeId === 'string') {
    const id = d.aufgabeId;
    if (!e.typ.startsWith('Buchung')) {
      const neu = aufgabeEntwickeln(b.aufgaben.get(id) ?? null, e);
      // eine neu erfasste Aufgabe kommt in der manuellen Reihenfolge ganz nach oben
      if (neu && (e.typ === 'AufgabeErfasst' || e.typ === 'AufgabeAusBuchungErstellt') && !b.aufgaben.has(id)) {
        neu.rang = Math.min(0, ...[...b.aufgaben.values()].map(a => a.rang)) - 1;
      }
      if (neu) b.aufgaben.set(id, neu);
    }
  }
  if (typeof d.buchungId === 'string') {
    const neu = buchungEntwickeln(b.buchungen.get(d.buchungId) ?? null, e);
    if (neu) b.buchungen.set(d.buchungId, neu);
  }
  spaltenEntwickeln(b.spalten, e);
  b.planung = planungEntwickeln(b.planung, e);
}

export function aufbauen(events: readonly DomainEvent[]): Bestand {
  const b = leererBestand();
  events.forEach(e => anwenden(b, e));
  return b;
}
