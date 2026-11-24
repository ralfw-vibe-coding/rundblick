// Kalender-Aufträge: Ein Gerät ohne direkten Kalenderzugang (Phone) bittet ein Gerät mit Zugang (Mac),
// einen externen Termin anzulegen (Spiegeln), zu verschieben oder zu löschen. Erledigt wird jeder Auftrag genau einmal.
import type { EventStore } from '../../providers/eventstore/interface';
import { tag, type DomainEvent } from '../../schema/events';
import type { Id } from '../../schema/werte';
import { anwenden, leererBestand, type Bestand } from '../bestand';
import { entscheide, nichtLeer, type Entscheidung, type Ergebnis } from './basis';

const entw = (b: Bestand, e: Parameters<typeof anwenden>[1]) => { anwenden(b, e); return b; };
const ctx = (es: EventStore, tags: string[], regel: (b: Bestand) => Entscheidung): Ergebnis => entscheide(es, { tags }, leererBestand, entw, regel);
const nein = (...f: string[]) => ({ ok: false as const, fehler: f });

export type AuftragEingabe = Extract<DomainEvent, { typ: 'KalenderauftragErteilt' }>['daten'];

export function kalenderauftragErteilen(es: EventStore, c: AuftragEingabe): Ergebnis {
  const tags = [tag.kalenderauftraege, ...(c.buchungId ? [tag.buchung(c.buchungId)] : [])];
  return ctx(es, tags, b => {
    if (b.auftraege.has(c.auftragId)) return nein('Auftrag existiert bereits.');
    if (c.art === 'spiegeln') {
      const z = c.buchungId ? b.buchungen.get(c.buchungId) : undefined;
      if (!z || z.storniert) return nein('Buchung unbekannt.');
      if (!z.start) return nein('Nur Termine (mit Uhrzeit) lassen sich spiegeln.');
      if (z.verknuepfung) return nein('Die Buchung ist schon gespiegelt.');
      if ([...b.auftraege.values()].some(a => a.art === 'spiegeln' && a.buchungId === c.buchungId && !a.erledigt)) return nein('Das Spiegeln ist schon beauftragt.');
      if (!nichtLeer(c.kalender.id)) return nein('Kalender fehlt.');
    } else {
      if (!c.termin) return nein('Termin fehlt.');
      if (c.art === 'verschieben' && !c.ziel) return nein('Ziel fehlt.');
    }
    return [{ typ: 'KalenderauftragErteilt', tags, daten: c }];
  });
}

export function kalenderauftragErledigen(es: EventStore, c: { auftragId: Id; ok: boolean; meldung: string; geraet: string }): Ergebnis {
  return ctx(es, [tag.kalenderauftraege], b => {
    const a = b.auftraege.get(c.auftragId);
    if (!a) return nein('Auftrag unbekannt.');
    if (a.erledigt) return [];
    return [{ typ: 'KalenderauftragErledigt', tags: [tag.kalenderauftraege], daten: c }];
  });
}
