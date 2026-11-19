// Pure Terminrechnung für wiederkehrende Aufgaben (ab Frist, nicht ab Erledigung).
import { fmt, parse, plusTage } from '../basis/datum';
import type { Datum, Wiederholung } from '../schema/werte';

/** Anker + k·Schritt; Monate/Jahre bleiben am Tag des Ankers (31. → letzter Tag kürzerer Monate, ohne Abdriften) */
export function termin(anker: Datum, w: Wiederholung, k: number): Datum {
  if (w.einheit === 'tag') return plusTage(anker, k * w.alle);
  if (w.einheit === 'woche') return plusTage(anker, 7 * k * w.alle);
  const a = parse(anker);
  const monate = k * w.alle * (w.einheit === 'jahr' ? 12 : 1);
  const letzter = new Date(a.getFullYear(), a.getMonth() + monate + 1, 0).getDate();
  return fmt(new Date(a.getFullYear(), a.getMonth() + monate, Math.min(a.getDate(), letzter)));
}

/** erster Termin der Reihe, der nach `nach` liegt – verpasste Termine laufen nicht auf */
export function naechsterTermin(anker: Datum, w: Wiederholung, nach: Datum): Datum {
  let k = 1;
  // grob vorspulen (Schritt eher zu lang geschätzt → nie über das Ziel), dann schrittweise (hält die Schleife auch nach Jahren Pause kurz)
  const tage = (parse(nach).getTime() - parse(anker).getTime()) / 864e5;
  const schritt = { tag: 1, woche: 7, monat: 31, jahr: 366 }[w.einheit] * w.alle;
  if (tage > 0) k = Math.max(1, Math.floor(tage / schritt) - 2);
  while (termin(anker, w, k) <= nach) k++;
  return termin(anker, w, k);
}

export const istWiederholung = (w: unknown): w is Wiederholung =>
  !!w && typeof w === 'object' && ['tag', 'woche', 'monat', 'jahr'].includes((w as Wiederholung).einheit)
  && Number.isInteger((w as Wiederholung).alle) && (w as Wiederholung).alle >= 1 && (w as Wiederholung).alle <= 999;
