// Commands für Board-Spalten und Planung (Kapazität, Standarddauer).
import type { EventStore } from '../../providers/eventstore/interface';
import { tag, type NeuesEvent } from '../../schema/events';
import type { Id, KategorieId, Minuten, Wochentag } from '../../schema/werte';
import { anwenden, leererBestand, type Bestand } from '../bestand';
import { aktiveSpalten } from '../zustand';
import { entscheide, nichtLeer, type Entscheidung, type Ergebnis } from './basis';

const entw = (b: Bestand, e: Parameters<typeof anwenden>[1]) => { anwenden(b, e); return b; };
const nein = (...f: string[]) => ({ ok: false as const, fehler: f });
const KATS: KategorieId[] = ['nichtBegonnen', 'begonnen', 'beendet'];

const spaltenCtx = (es: EventStore, regel: (b: Bestand) => Entscheidung): Ergebnis =>
  entscheide(es, { tags: [tag.spalten] }, leererBestand, entw, regel);

export const STANDARDSPALTEN: { id: Id; name: string; kategorie: KategorieId }[] = [
  { id: 'idee', name: 'Idee', kategorie: 'nichtBegonnen' },
  { id: 'backlog', name: 'Backlog', kategorie: 'nichtBegonnen' },
  { id: 'bereit', name: 'Bereit', kategorie: 'nichtBegonnen' },
  { id: 'inarbeit', name: 'In Arbeit', kategorie: 'begonnen' },
  { id: 'blockiert', name: 'Blockiert', kategorie: 'begonnen' },
  { id: 'erledigt', name: 'Erledigt', kategorie: 'beendet' },
  { id: 'abgebrochen', name: 'Abgebrochen', kategorie: 'beendet' },
];

/** Legt die Standardspalten an – nur, wenn noch nie eine Spalte angelegt wurde */
export function standardspaltenEinrichten(es: EventStore): Ergebnis {
  return spaltenCtx(es, b => b.spalten.size > 0 ? [] : STANDARDSPALTEN.map(s => ({
    typ: 'StatusspalteAngelegt', tags: [tag.spalten], daten: { statusId: s.id, name: s.name, kategorie: s.kategorie },
  }) as NeuesEvent));
}

export function spalteAnlegen(es: EventStore, c: { statusId: Id; name: string; kategorie: KategorieId }): Ergebnis {
  return spaltenCtx(es, b => {
    if (!nichtLeer(c.name)) return nein('Name fehlt.');
    if (!KATS.includes(c.kategorie)) return nein('Unbekannte Kategorie.');
    if (b.spalten.has(c.statusId)) return nein('Spalte existiert bereits.');
    return [{ typ: 'StatusspalteAngelegt', tags: [tag.spalten], daten: { statusId: c.statusId, name: c.name.trim(), kategorie: c.kategorie } }];
  });
}

export function spalteUmbenennen(es: EventStore, c: { statusId: Id; name: string }): Ergebnis {
  return spaltenCtx(es, b => {
    const s = b.spalten.get(c.statusId);
    if (!s || s.entfernt) return nein('Spalte unbekannt.');
    if (!nichtLeer(c.name)) return nein('Name fehlt.');
    if (s.name === c.name.trim()) return [];
    return [{ typ: 'StatusspalteUmbenannt', tags: [tag.spalten], daten: { statusId: s.id, name: c.name.trim() } }];
  });
}

/** Benennt eine der drei festen Kategorien (Spaltengruppen) um */
export function kategorieUmbenennen(es: EventStore, c: { kategorie: KategorieId; name: string }): Ergebnis {
  return spaltenCtx(es, b => {
    if (!KATS.includes(c.kategorie)) return nein('Unbekannte Kategorie.');
    if (!nichtLeer(c.name)) return nein('Name fehlt.');
    if (b.kategorien[c.kategorie] === c.name.trim()) return [];
    return [{ typ: 'KategorieUmbenannt', tags: [tag.spalten], daten: { kategorie: c.kategorie, name: c.name.trim() } }];
  });
}

/** Sortiert die Spalten einer Kategorie; die Reihenfolge muss genau deren aktive Spalten enthalten */
export function spaltenSortieren(es: EventStore, c: { kategorie: KategorieId; reihenfolge: Id[] }): Ergebnis {
  return spaltenCtx(es, b => {
    const ist = aktiveSpalten(b.spalten).filter(s => s.kategorie === c.kategorie).map(s => s.id);
    const gleich = ist.length === c.reihenfolge.length && ist.every(id => c.reihenfolge.includes(id));
    if (!gleich) return nein('Die Reihenfolge passt nicht zu den Spalten dieser Kategorie.');
    if (ist.every((id, i) => c.reihenfolge[i] === id)) return [];
    return [{ typ: 'StatusspaltenSortiert', tags: [tag.spalten], daten: { kategorie: c.kategorie, reihenfolge: c.reihenfolge } }];
  });
}

/** Entfernen nur, wenn keine (nicht verworfene) Aufgabe in der Spalte steht */
export function spalteEntfernen(es: EventStore, c: { statusId: Id }): Ergebnis {
  return entscheide(es, { typen: ['StatusspalteAngelegt', 'StatusspalteEntfernt', 'StatusspalteUmbenannt', 'StatusspaltenSortiert', 'AufgabeErfasst', 'AufgabeAusBuchungErstellt', 'StatusGesetzt', 'StatusEntfernt', 'AufgabeVerworfen'] },
    leererBestand, entw, b => {
      const s = b.spalten.get(c.statusId);
      if (!s || s.entfernt) return nein('Spalte unbekannt.');
      const belegt = [...b.aufgaben.values()].filter(a => a.status === s.id && !a.verworfen).length;
      if (belegt) return nein(`In der Spalte stehen noch ${belegt} Aufgabe(n).`);
      return [{ typ: 'StatusspalteEntfernt', tags: [tag.spalten], daten: { statusId: s.id } }];
    });
}

export function tageskapazitaetFestlegen(es: EventStore, c: { wochentag: Wochentag; minuten: Minuten }): Ergebnis {
  return entscheide(es, { tags: [tag.planung] }, leererBestand, entw, b => {
    if (!(Number.isInteger(c.wochentag) && c.wochentag >= 1 && c.wochentag <= 7)) return nein('Wochentag ungültig.');
    if (!(Number.isInteger(c.minuten) && c.minuten >= 0 && c.minuten <= 24 * 60)) return nein('Kapazität muss zwischen 0 und 24 Stunden liegen.');
    if (b.planung.kapazitaet[c.wochentag - 1] === c.minuten) return [];
    return [{ typ: 'TageskapazitaetFestgelegt', tags: [tag.planung], daten: { wochentag: c.wochentag, minuten: c.minuten } }];
  });
}

export function standarddauerFestlegen(es: EventStore, c: { minuten: Minuten }): Ergebnis {
  return entscheide(es, { tags: [tag.planung] }, leererBestand, entw, b => {
    if (!(Number.isInteger(c.minuten) && c.minuten >= 5 && c.minuten <= 12 * 60)) return nein('Standarddauer muss zwischen 5 Minuten und 12 Stunden liegen.');
    if (b.planung.standarddauer === c.minuten) return [];
    return [{ typ: 'StandarddauerFestgelegt', tags: [tag.planung], daten: { minuten: c.minuten } }];
  });
}
