// Pure Funktionen: aus dem Domain-Zustand werden Liste und Board (relativ zu „heute“).
import { differenz, montag, plusTage } from '../../basis/datum';
import type { AufgabeZ, BuchungZ, SpalteZ } from '../../domain/interface';
import { KATEGORIEN, type Datum, type Id } from '../../schema/werte';
import type { AufgabeZeile, Aufgabenliste, Board, Dringlichkeit, ListenGruppe, StatusInfo } from '../interface';

export function dringlichkeit(frist: Datum | null, heute: Datum): Dringlichkeit | null {
  if (!frist) return null;
  const n = differenz(heute, frist);
  return n < 0 ? 'ueberfaellig' : n === 0 ? 'heute' : n <= 2 ? 'bald' : 'spaeter';
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
    status, abgeschlossen: a.abgeschlossen,
    buchungen: {
      reservierungen: eigene.filter(b => !b.start).length,
      termine: eigene.filter(b => b.start).length,
      gebucht: eigene.filter(b => b.belegt).reduce((x, b) => x + b.dauer, 0),
    },
  };
}

export function passtZuFilter(a: AufgabeZ, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  const text = [a.titel, a.ort, a.verantwortlich, '@' + a.verantwortlich, a.beschreibung, ...a.tags.map(t => '#' + t)].join(' ').toLowerCase();
  return f.split(/\s+/).every(w => text.includes(w));
}

const nachFrist = (x: AufgabeZeile, y: AufgabeZeile) => (x.frist ?? '9999').localeCompare(y.frist ?? '9999') || x.titel.localeCompare(y.titel, 'de');

export function liste(aufgaben: AufgabeZ[], buchungen: BuchungZ[], spalten: Map<Id, SpalteZ>, heute: Datum, filter = ''): Aufgabenliste {
  const sonntag = plusTage(montag(heute), 6);
  const passend = aufgaben.filter(a => passtZuFilter(a, filter));
  const z = (a: AufgabeZ) => zeile(a, buchungen, spalten, heute);
  const offen = passend.filter(a => !a.abgeschlossen && !istZurueckgestellt(a, heute)).map(z);
  const g: Record<ListenGruppe['art'], AufgabeZeile[]> = { ueberfaellig: [], heute: [], woche: [], spaeter: [], ohne: [] };
  offen.forEach(a => {
    if (!a.frist) g.ohne.push(a);
    else if (a.frist < heute) g.ueberfaellig.push(a);
    else if (a.frist === heute) g.heute.push(a);
    else if (a.frist <= sonntag) g.woche.push(a);
    else g.spaeter.push(a);
  });
  Object.values(g).forEach(x => x.sort(nachFrist));
  const namen: Record<ListenGruppe['art'], string> = { ueberfaellig: 'Überfällig', heute: 'Heute fällig', woche: 'Diese Woche', spaeter: 'Später', ohne: 'Ohne Frist' };
  return {
    heute, offen: offen.length,
    gruppen: (Object.keys(g) as ListenGruppe['art'][]).map(art => ({ art, name: namen[art], aufgaben: g[art] })),
    zurueckgestellt: passend.filter(a => !a.abgeschlossen && istZurueckgestellt(a, heute)).map(z).sort((x, y) => (x.wiedervorlage ?? '').localeCompare(y.wiedervorlage ?? '')),
    abgeschlossen: passend.filter(a => a.abgeschlossen).map(z).sort((x, y) => x.titel.localeCompare(y.titel, 'de')),
  };
}

/** Board: alle Aufgaben mit Status – auch abgeschlossene (sie bleiben stehen), aber keine zurückgestellten */
export function board(aufgaben: AufgabeZ[], buchungen: BuchungZ[], spalten: SpalteZ[], heute: Datum): Board {
  const map = new Map(spalten.map(s => [s.id, s]));
  const karten = aufgaben.filter(a => a.status && map.has(a.status) && !istZurueckgestellt(a, heute)).map(a => zeile(a, buchungen, map, heute));
  return {
    kategorien: KATEGORIEN.map(k => {
      const sp = spalten.filter(s => s.kategorie === k.id).map(s => ({
        id: s.id, name: s.name,
        karten: karten.filter(c => c.status!.id === s.id).sort((x, y) => Number(x.abgeschlossen) - Number(y.abgeschlossen) || nachFrist(x, y)),
      }));
      return { id: k.id, name: k.name, anzahl: sp.reduce((n, s) => n + s.karten.length, 0), spalten: sp };
    }),
  };
}
