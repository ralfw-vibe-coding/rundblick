// Pure Funktion: eigene Buchungen + externe Termine + Fristen/Wiedervorlagen + Auslastung je Tag.
import { differenz, minuten, plusTage, wochentag } from '../../basis/datum';
import type { AufgabeZ, BuchungZ, PlanungZ } from '../../domain/interface';
import type { ExternerTermin, KalenderEinstellung, KalenderInfo } from '../../schema/extern';
import type { Datum } from '../../schema/werte';
import type { Auslastung, BuchungDto, ExternDto, Tag, Zeitraum } from '../interface';
import { dringlichkeit } from './aufgaben';

export const KALENDER_STANDARD: KalenderEinstellung = { sichtbar: true, belegt: false };

export function buchungDto(b: BuchungZ, aufgaben: Map<string, AufgabeZ>): BuchungDto {
  const a = b.aufgabeId ? aufgaben.get(b.aufgabeId) : undefined;
  return {
    id: b.id, aufgabeId: b.aufgabeId, titel: b.titel, beschreibung: b.beschreibung, aufgabentitel: a ? a.titel : null,
    datum: b.datum, start: b.start, dauer: b.dauer, belegt: b.belegt, abgeschlossen: !!a?.abgeschlossen,
    herkunft: a ? (a.status ? 'board' : 'liste') : null,
    spiegel: b.verknuepfung ? { kalender: b.verknuepfung.kalender, konto: b.verknuepfung.konto, farbe: b.verknuepfung.farbe } : null,
    hinweis: b.hinweis,
  };
}

export type ZeitraumEingabe = {
  von: Datum; bis: Datum; heute: Datum; jetzt: number;
  aufgaben: AufgabeZ[]; buchungen: BuchungZ[]; planung: PlanungZ;
  extern: ExternerTermin[]; kalender: KalenderInfo[]; kalenderEinstellungen: Record<string, KalenderEinstellung>;
};

export function zeitraum(x: ZeitraumEingabe): Zeitraum {
  const amap = new Map(x.aufgaben.map(a => [a.id, a]));
  const kmap = new Map(x.kalender.map(k => [k.id, k]));
  const einst = (id: string) => x.kalenderEinstellungen[id] ?? KALENDER_STANDARD;
  const tage: Tag[] = [];
  const anzahl = Math.min(400, differenz(x.von, x.bis) + 1);
  for (let i = 0; i < anzahl; i++) {
    const datum = plusTage(x.von, i);
    const eigene = x.buchungen.filter(b => b.datum === datum && (!b.aufgabeId || amap.has(b.aufgabeId))).map(b => buchungDto(b, amap));
    const termine = eigene.filter(b => b.start).map(b => ({ ...b, s: minuten(b.start!), e: minuten(b.start!) + b.dauer })).sort((a, b) => a.s - b.s);
    const reservierungen = eigene.filter(b => !b.start);
    const extern: ExternDto[] = x.extern.filter(t => t.datum === datum && einst(t.kalenderId).sichtbar).map(t => {
      const k = kmap.get(t.kalenderId);
      const s = t.start ? minuten(t.start) : null;
      return {
        id: t.id, kalender: k?.name ?? '?', konto: k?.konto ?? '', farbe: k?.farbe ?? '#888888', titel: t.titel,
        start: s, ende: s === null ? null : s + t.dauer, belegt: einst(t.kalenderId).belegt, ort: t.ort, notiz: t.notiz ?? '',
      };
    }).sort((a, b) => (a.start ?? -1) - (b.start ?? -1));
    tage.push({
      datum, termine, reservierungen, extern,
      fristen: x.aufgaben.filter(a => a.frist === datum && !a.abgeschlossen && !a.archiviert).map(a => ({ aufgabeId: a.id, titel: a.titel, dringlichkeit: dringlichkeit(a.frist, x.heute)! })),
      wiedervorlagen: x.aufgaben.filter(a => a.wiedervorlage === datum && !a.abgeschlossen && !a.archiviert).map(a => ({ aufgabeId: a.id, titel: a.titel })),
      auslastung: auslastung(datum, eigene, extern, x.planung),
    });
  }
  return { heute: x.heute, jetzt: x.jetzt, tage };
}

export function auslastung(datum: Datum, eigene: BuchungDto[], extern: ExternDto[], planung: PlanungZ): Auslastung {
  const eig = eigene.filter(b => b.belegt).reduce((s, b) => s + b.dauer, 0);
  const zeitlich = extern.filter(t => t.start !== null);
  const ext = zeitlich.filter(t => t.belegt).reduce((s, t) => s + (t.ende! - t.start!), 0);
  const nicht = zeitlich.filter(t => !t.belegt).reduce((s, t) => s + (t.ende! - t.start!), 0);
  return { belegt: eig + ext, eigene: eig, extern: ext, nichtBelegend: nicht, kapazitaet: planung.kapazitaet[wochentag(datum)] ?? 0 };
}
