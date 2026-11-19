// Anzeige und Eingabe von Wiederholungen (pure, von allen Clients geteilt).
import type { Wiederholung } from '../schema/werte';

export const NAMEN = { tag: ['Tag', 'Tage', 'täglich'], woche: ['Woche', 'Wochen', 'wöchentlich'], monat: ['Monat', 'Monate', 'monatlich'], jahr: ['Jahr', 'Jahre', 'jährlich'] } as const;

/** „monatlich“, „alle 6 Monate“, „alle 17 Tage“ */
export function wiederholungText(w: Wiederholung): string {
  const n = NAMEN[w.einheit];
  if (w.alle === 1) return n[2];
  if (w.einheit === 'monat' && w.alle === 3) return 'vierteljährlich';
  if (w.einheit === 'monat' && w.alle === 6) return 'halbjährlich';
  return `alle ${w.alle} ${n[1]}`;
}
