// Projektion für Queries: der gesamte aktuelle Zustand im Speicher, inkrementell nachgeführt.
import type { Id } from '../schema/werte';
import {
  aufgabeEntwickeln, buchungEntwickeln, notizEntwickeln, type NotizZ, type ZeitEvent, PLANUNG_STANDARD, planungEntwickeln, spaltenEntwickeln,
  type AufgabeZ, type BuchungZ, type PlanungZ, type SpalteZ, kategorienEntwickeln, kategorienStandard, type KategorienamenZ,
  auftraegeEntwickeln, type KalenderauftragZ,
} from './zustand';

export type Bestand = {
  aufgaben: Map<Id, AufgabeZ>;
  buchungen: Map<Id, BuchungZ>;
  spalten: Map<Id, SpalteZ>;
  planung: PlanungZ;
  kategorien: KategorienamenZ;
  notizen: Map<Id, NotizZ>;
  auftraege: Map<Id, KalenderauftragZ>;
};

export function leererBestand(): Bestand {
  return { aufgaben: new Map(), buchungen: new Map(), spalten: new Map(), planung: PLANUNG_STANDARD, kategorien: kategorienStandard(), notizen: new Map(), auftraege: new Map() };
}

/** Events, die den gespiegelten Inhalt einer Buchung ändern (Titel, Notiz, Zeit, Dauer) */
const INHALT = new Set(['BuchungAngelegt', 'BuchungUmbenannt', 'BuchungsbeschreibungGeaendert', 'BuchungVerschoben', 'BuchungsdauerGeaendert']);

export function anwenden(b: Bestand, e: ZeitEvent): void {
  const d = e.daten as Record<string, unknown>;
  if (typeof d.aufgabeId === 'string') {
    const id = d.aufgabeId;
    if (!e.typ.startsWith('Buchung')) {
      const neu = aufgabeEntwickeln(b.aufgaben.get(id) ?? null, e);
      // eine neu erfasste Aufgabe kommt in der manuellen Reihenfolge ganz nach oben
      if (neu && (e.typ === 'AufgabeErfasst' || e.typ === 'AufgabeAusBuchungErstellt' || e.typ === 'AufgabeAusNotizErstellt') && !b.aufgaben.has(id)) {
        neu.rang = Math.min(0, ...[...b.aufgaben.values()].map(a => a.rang)) - 1;
      }
      if (neu) b.aufgaben.set(id, neu);
    }
  }
  if (typeof d.notizId === 'string') {
    const neu = notizEntwickeln(b.notizen.get(d.notizId) ?? null, e);
    if (neu) b.notizen.set(d.notizId, neu);
  }
  if (typeof d.buchungId === 'string') {
    const neu = buchungEntwickeln(b.buchungen.get(d.buchungId) ?? null, e);
    if (neu && INHALT.has(e.typ)) neu.zuletzt = e.zeit ?? neu.zuletzt;
    if (neu) b.buchungen.set(d.buchungId, neu);
  }
  spaltenEntwickeln(b.spalten, e);
  b.planung = planungEntwickeln(b.planung, e);
  b.kategorien = kategorienEntwickeln(b.kategorien, e);
  auftraegeEntwickeln(b.auftraege, e);
}

export function aufbauen(events: readonly ZeitEvent[]): Bestand {
  const b = leererBestand();
  events.forEach(e => anwenden(b, e));
  return b;
}
