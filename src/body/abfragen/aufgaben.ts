// Pure Funktionen: aus dem Domain-Zustand werden Liste und Board (relativ zu „heute“).
import { montag, plusTage } from '../../basis/datum';
import type { AufgabeZ, BuchungZ, SpalteZ } from '../../domain/interface';
import { KATEGORIEN, type Datum, type Id, type KategorieId } from '../../schema/werte';
import type { AufgabeZeile, Aufgabenliste, Board, Dringlichkeit, ListenGruppe, StatusInfo } from '../interface';

/** Dringlichkeit = Abschnitt der Liste: überfällig · heute · diese Woche (bis Sonntag) · später */
export function dringlichkeit(frist: Datum | null, heute: Datum): Dringlichkeit | null {
  if (!frist) return null;
  if (frist < heute) return 'ueberfaellig';
  if (frist === heute) return 'heute';
  return frist <= plusTage(montag(heute), 6) ? 'woche' : 'spaeter';
}

export const istZurueckgestellt = (a: AufgabeZ, heute: Datum) => !!a.wiedervorlage && a.wiedervorlage > heute;

export function zeile(a: AufgabeZ, buchungen: BuchungZ[], spalten: Map<Id, SpalteZ>, heute: Datum): AufgabeZeile {
  const eigene = buchungen.filter(b => b.aufgabeId === a.id);
  const s = a.status ? spalten.get(a.status) : undefined;
  const status: StatusInfo | null = s ? { id: s.id, name: s.name, kategorie: s.kategorie } : null;
  return {
    id: a.id, titel: a.titel, tags: a.tags, verantwortlich: a.verantwortlich, ort: a.ort,
    frist: a.frist, dringlichkeit: a.abgeschlossen ? null : dringlichkeit(a.frist, heute),
    wiedervorlage: a.wiedervorlage, zurueckgestellt: istZurueckgestellt(a, heute),
    status, abgeschlossen: a.abgeschlossen, archiviert: a.archiviert,
    buchungen: {
      reservierungen: eigene.filter(b => !b.start).length,
      termine: eigene.filter(b => b.start).length,
      gebucht: eigene.filter(b => b.belegt).reduce((x, b) => x + b.dauer, 0),
    },
    anhaenge: a.anhaenge.length,
  };
}

export function passtZuFilter(a: AufgabeZ, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  const text = [a.titel, a.ort, a.verantwortlich, '@' + a.verantwortlich, a.beschreibung, ...a.tags.map(t => '#' + t)].join(' ').toLowerCase();
  return f.split(/\s+/).every(w => text.includes(w));
}


/** Liste: in jedem Abschnitt nach manuellem Rang – neue Aufgaben bekommen den obersten Rang */
export function liste(aufgaben: AufgabeZ[], buchungen: BuchungZ[], spalten: Map<Id, SpalteZ>, heute: Datum, filter = ''): Aufgabenliste {
  const neuesteZuerst = [...aufgaben].sort((x, y) => x.rang - y.rang).filter(a => passtZuFilter(a, filter));
  const z = (a: AufgabeZ) => zeile(a, buchungen, spalten, heute);
  const sichtbar = neuesteZuerst.filter(a => !a.archiviert);
  const offen = sichtbar.filter(a => !a.abgeschlossen && !istZurueckgestellt(a, heute)).map(z);
  const g: Record<ListenGruppe['art'], AufgabeZeile[]> = { ueberfaellig: [], heute: [], woche: [], spaeter: [], ohne: [] };
  const abschnitt: Record<Dringlichkeit, ListenGruppe['art']> = { ueberfaellig: 'ueberfaellig', heute: 'heute', woche: 'woche', spaeter: 'spaeter' };
  offen.forEach(a => g[a.dringlichkeit ? abschnitt[a.dringlichkeit] : 'ohne'].push(a));
  const namen: Record<ListenGruppe['art'], string> = { ueberfaellig: 'Überfällig', heute: 'Heute fällig', woche: 'Diese Woche', spaeter: 'Später', ohne: 'Ohne Frist' };
  return {
    heute, offen: offen.length,
    gruppen: (Object.keys(g) as ListenGruppe['art'][]).map(art => ({ art, name: namen[art], aufgaben: g[art] })),
    zurueckgestellt: sichtbar.filter(a => !a.abgeschlossen && istZurueckgestellt(a, heute)).map(z),
    abgeschlossen: sichtbar.filter(a => a.abgeschlossen).map(z),
    archiv: neuesteZuerst.filter(a => a.archiviert).map(z),
  };
}

/** Board: alle Aufgaben mit Status – auch zurückgestellte und abgeschlossene (die Oberfläche zeigt sie in eigenen Bereichen der Spalte), aber keine archivierten.
 *  Reihenfolge je Spalte: offen · zurückgestellt · abgeschlossen, innerhalb davon der manuelle Rang (wie in der Liste). */
export function board(aufgaben: AufgabeZ[], buchungen: BuchungZ[], spalten: SpalteZ[], heute: Datum, kategorien: readonly { id: KategorieId; name: string }[] = KATEGORIEN): Board {
  const map = new Map(spalten.map(s => [s.id, s]));
  const karten = aufgaben.filter(a => a.status && map.has(a.status) && !a.archiviert).map(a => zeile(a, buchungen, map, heute));
  const stufe = (c: AufgabeZeile) => (c.abgeschlossen ? 2 : c.zurueckgestellt ? 1 : 0);
  const rang = new Map(aufgaben.map(a => [a.id, a.rang]));
  return {
    heute,
    kategorien: kategorien.map(k => {
      const sp = spalten.filter(s => s.kategorie === k.id).map(s => ({
        id: s.id, name: s.name,
        karten: karten.filter(c => c.status!.id === s.id).sort((x, y) => stufe(x) - stufe(y) || rang.get(x.id)! - rang.get(y.id)!),
      }));
      return { id: k.id, name: k.name, anzahl: sp.reduce((n, s) => n + s.karten.length, 0), spalten: sp };
    }),
  };
}
