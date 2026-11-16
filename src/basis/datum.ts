// Reine Datums-Helfer (kein Zugriff auf die Uhr). Datum = 'YYYY-MM-DD', Uhrzeit = 'HH:MM'.
import type { Datum, Uhrzeit } from '../schema/werte';

export const WT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
export const WT_LANG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'] as const;
export const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'] as const;
export const MON_LANG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'] as const;

export function parse(s: Datum): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d!); }
export function fmt(d: Date): Datum {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function plusTage(s: Datum, n: number): Datum { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }
export function plusMonate(s: Datum, n: number): Datum { const d = parse(s); return fmt(new Date(d.getFullYear(), d.getMonth() + n, 1)); }
/** b − a in Tagen */
export function differenz(a: Datum, b: Datum): number { return Math.round((parse(b).getTime() - parse(a).getTime()) / 864e5); }
/** 0 = Montag … 6 = Sonntag */
export function wochentag(s: Datum): number { return (parse(s).getDay() + 6) % 7; }
export function montag(s: Datum): Datum { return plusTage(s, -wochentag(s)); }
export function monatsErster(s: Datum): Datum { const d = parse(s); return fmt(new Date(d.getFullYear(), d.getMonth(), 1)); }
export function tagImMonat(s: Datum): number { return parse(s).getDate(); }
export function monat(s: Datum): number { return parse(s).getMonth(); }
export function jahr(s: Datum): number { return parse(s).getFullYear(); }
export function kurz(s: Datum): string { const d = parse(s); return `${d.getDate()}.${d.getMonth() + 1}.`; }
export function kw(s: Datum): number {
  const d = parse(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - w1.getTime()) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
export function istDatum(s: unknown): s is Datum {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fmt(parse(s)) === s;
}
export function istUhrzeit(s: unknown): s is Uhrzeit {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
export function minuten(t: Uhrzeit): number { const [h, m] = t.split(':').map(Number); return h! * 60 + m!; }
export function uhrzeit(min: number): Uhrzeit {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
export function dauerText(min: number): string {
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',')} h`;
}
/** relative Bezeichnung zu `heute`: Heute, Morgen, Gestern, „Mi 18.11.“ oder „24.12.“ */
export function relativ(s: Datum, heute: Datum): string {
  const n = differenz(heute, s);
  if (n === 0) return 'Heute';
  if (n === 1) return 'Morgen';
  if (n === -1) return 'Gestern';
  if (n > 1 && n < 7) return `${WT[wochentag(s)]} ${kurz(s)}`;
  return kurz(s);
}
