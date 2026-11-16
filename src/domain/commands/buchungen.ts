// Commands rund um Buchungen (Reservierung = ohne Startzeit, Termin = mit Startzeit; frei = ohne Aufgabe).
import type { EventStore } from '../../providers/eventstore/interface';
import { tag, type NeuesEvent } from '../../schema/events';
import type { Datum, Id, Minuten, Uhrzeit } from '../../schema/werte';
import { anwenden, leererBestand, type Bestand } from '../bestand';
import { pruefeBuchung } from './aufgaben';
import { entscheide, nichtLeer, type Entscheidung, type Ergebnis } from './basis';

const entw = (b: Bestand, e: Parameters<typeof anwenden>[1]) => { anwenden(b, e); return b; };
const ctx = (es: EventStore, tags: string[], regel: (b: Bestand) => Entscheidung): Ergebnis =>
  entscheide(es, { tags }, leererBestand, entw, regel);
const nein = (...f: string[]) => ({ ok: false as const, fehler: f });

export function buchungAnlegen(es: EventStore, c: { buchungId: Id; aufgabeId: Id; datum: Datum; start?: Uhrzeit | null; dauer?: Minuten; titel?: string }): Ergebnis {
  return ctx(es, [tag.aufgabe(c.aufgabeId), tag.buchung(c.buchungId), tag.planung], b => {
    const a = b.aufgaben.get(c.aufgabeId);
    if (!a) return nein('Aufgabe unbekannt.');
    if (a.verworfen) return nein('Aufgabe wurde verworfen.');
    if (a.abgeschlossen) return nein('Aufgabe ist abgeschlossen – erst wieder öffnen.');
    if (b.buchungen.has(c.buchungId)) return nein('Buchung existiert bereits.');
    const p = pruefeBuchung(c);
    if (p.length) return nein(...p);
    return [{
      typ: 'BuchungAngelegt', tags: [tag.buchung(c.buchungId), tag.aufgabe(c.aufgabeId)],
      daten: {
        buchungId: c.buchungId, aufgabeId: c.aufgabeId, titel: nichtLeer(c.titel) ? c.titel.trim() : a.titel, beschreibung: '',
        datum: c.datum, dauer: c.dauer ?? b.planung.standarddauer, start: c.start ?? null, belegt: true,
      },
    }];
  });
}

/** Freie Buchung: direkt im Kalender, ohne Aufgabe */
export function buchungEintragen(es: EventStore, c: { buchungId: Id; titel: string; beschreibung?: string; datum: Datum; start?: Uhrzeit | null; dauer?: Minuten; belegt?: boolean }): Ergebnis {
  return ctx(es, [tag.buchung(c.buchungId), tag.planung], b => {
    if (!nichtLeer(c.titel)) return nein('Titel fehlt.');
    if (b.buchungen.has(c.buchungId)) return nein('Buchung existiert bereits.');
    const p = pruefeBuchung(c);
    if (p.length) return nein(...p);
    return [{
      typ: 'BuchungAngelegt', tags: [tag.buchung(c.buchungId)],
      daten: {
        buchungId: c.buchungId, aufgabeId: null, titel: c.titel.trim(), beschreibung: c.beschreibung ?? '',
        datum: c.datum, dauer: c.dauer ?? b.planung.standarddauer, start: c.start ?? null, belegt: c.belegt ?? true,
      },
    }];
  });
}

export type BuchungAenderungen = { titel?: string; beschreibung?: string; belegt?: boolean; datum?: Datum; start?: Uhrzeit | null; dauer?: Minuten };

export function buchungAendern(es: EventStore, c: { buchungId: Id; aenderungen: BuchungAenderungen }): Ergebnis {
  return ctx(es, [tag.buchung(c.buchungId)], b => {
    const z = b.buchungen.get(c.buchungId);
    if (!z || z.storniert) return nein('Buchung unbekannt.');
    const x = c.aenderungen;
    if (x.titel !== undefined && !nichtLeer(x.titel)) return nein('Titel fehlt.');
    const p = pruefeBuchung({ datum: x.datum ?? z.datum, start: x.start === undefined ? z.start : x.start, dauer: x.dauer ?? z.dauer });
    if (p.length) return nein(...p);
    const t = z.aufgabeId ? [tag.buchung(z.id), tag.aufgabe(z.aufgabeId)] : [tag.buchung(z.id)];
    const id = z.id, ev: NeuesEvent[] = [];
    if (x.titel !== undefined && x.titel.trim() !== z.titel) ev.push({ typ: 'BuchungUmbenannt', tags: t, daten: { buchungId: id, titel: x.titel.trim() } });
    if (x.beschreibung !== undefined && x.beschreibung !== z.beschreibung) ev.push({ typ: 'BuchungsbeschreibungGeaendert', tags: t, daten: { buchungId: id, beschreibung: x.beschreibung } });
    if (x.belegt !== undefined && x.belegt !== z.belegt) ev.push({ typ: 'BuchungsbelegungGeaendert', tags: t, daten: { buchungId: id, belegt: x.belegt } });
    const datum = x.datum ?? z.datum, start = x.start === undefined ? z.start : x.start;
    if (datum !== z.datum || start !== z.start) ev.push({ typ: 'BuchungVerschoben', tags: t, daten: { buchungId: id, datum, start } });
    if (x.dauer !== undefined && x.dauer !== z.dauer) ev.push({ typ: 'BuchungsdauerGeaendert', tags: t, daten: { buchungId: id, dauer: x.dauer } });
    return ev;
  });
}

export function buchungStornieren(es: EventStore, c: { buchungId: Id }): Ergebnis {
  return ctx(es, [tag.buchung(c.buchungId)], b => {
    const z = b.buchungen.get(c.buchungId);
    if (!z) return nein('Buchung unbekannt.');
    if (z.storniert) return [];
    const t = z.aufgabeId ? [tag.buchung(z.id), tag.aufgabe(z.aufgabeId)] : [tag.buchung(z.id)];
    return [{ typ: 'BuchungStorniert', tags: t, daten: { buchungId: z.id } }];
  });
}

/** Aus einer freien Buchung wird eine Aufgabe; die Buchung bleibt und gehört dann zur Aufgabe */
export function aufgabeAusBuchung(es: EventStore, c: { buchungId: Id; aufgabeId: Id; status?: Id | null }): Ergebnis {
  return ctx(es, [tag.buchung(c.buchungId), tag.aufgabe(c.aufgabeId), tag.spalten], b => {
    const z = b.buchungen.get(c.buchungId);
    if (!z || z.storniert) return nein('Buchung unbekannt.');
    if (z.aufgabeId) return nein('Die Buchung gehört schon zu einer Aufgabe.');
    if (b.aufgaben.has(c.aufgabeId)) return nein('Aufgabe existiert bereits.');
    if (c.status != null) { const s = b.spalten.get(c.status); if (!s || s.entfernt) return nein('Diese Board-Spalte gibt es nicht.'); }
    return [{
      typ: 'AufgabeAusBuchungErstellt', tags: [tag.aufgabe(c.aufgabeId), tag.buchung(z.id)],
      daten: { aufgabeId: c.aufgabeId, buchungId: z.id, titel: z.titel, beschreibung: z.beschreibung, status: c.status ?? null },
    }];
  });
}
