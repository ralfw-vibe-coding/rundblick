// Spiegelung Buchung ↔ Google/iCloud: pure Entscheidung, was beim Abgleich einer verknüpften Buchung zu tun ist.
// „stand“ = Fingerabdruck des Inhalts beim letzten Abgleich. Geändert hat sich, wessen Fingerabdruck davon abweicht.
import type { BuchungZ } from '../../domain/interface';
import type { ExternerTermin, TerminDaten } from '../../schema/extern';

export const fingerabdruck = (t: TerminDaten): string => JSON.stringify([t.titel, t.notiz, t.datum, t.start, t.dauer]);
export const ausBuchung = (b: BuchungZ): TerminDaten => ({ titel: b.titel, notiz: b.beschreibung, datum: b.datum, start: b.start!, dauer: b.dauer });
export const ausExtern = (e: ExternerTermin): TerminDaten => ({ titel: e.titel, notiz: e.notiz ?? '', datum: e.datum, start: e.start!, dauer: e.dauer });

export type Abgleich =
  | { art: 'nichts' }
  /** nur der Stand ist veraltet (beide Seiten gleich) */
  | { art: 'stand'; stand: string }
  | { art: 'nachExtern' }
  | { art: 'vonExtern'; inhalt: TerminDaten; stand: string }
  | { art: 'geloest' };

export function abgleich(b: BuchungZ, extern: ExternerTermin | null): Abgleich {
  const v = b.verknuepfung;
  if (!v) return { art: 'nichts' };
  if (!extern) return { art: 'geloest' };
  // extern zu einem ganztägigen Eintrag gemacht: nicht spiegelbar – nichts überschreiben
  if (!extern.start) return { art: 'nichts' };
  const lokal = fingerabdruck(ausBuchung(b)), ext = fingerabdruck(ausExtern(extern));
  if (lokal === ext) return lokal === v.stand ? { art: 'nichts' } : { art: 'stand', stand: lokal };
  const lokalGeaendert = lokal !== v.stand, externGeaendert = ext !== v.stand;
  const vonExtern: Abgleich = { art: 'vonExtern', inhalt: ausExtern(extern), stand: ext };
  if (externGeaendert && !lokalGeaendert) return vonExtern;
  if (lokalGeaendert && !externGeaendert) return { art: 'nachExtern' };
  // beide geändert: die jüngere Änderung gewinnt
  const tLokal = Date.parse(b.zuletzt) || 0, tExtern = Date.parse(extern.geaendert ?? '') || 0;
  return tExtern > tLokal ? vonExtern : { art: 'nachExtern' };
}
