// Parser der Schnellerfassung (pure). Syntax:
//   Titel  #tag  @person  /ort  !frist  ^wiedervorlage  =status  >datum [hh:mm] [dauer]  *wiederholung
// *wiederholung: *täglich *wöchentlich *monatlich *jährlich oder *3t *2w *6m *1j (ab Frist; ohne !frist gilt heute)
// Beginnt die Zeile mit '>', entsteht nur eine (freie) Buchung, keine Aufgabe.
import { plusTage, wochentag, WT_LANG, fmt, parse as parseDatum, istDatum, minuten, uhrzeit } from '../../basis/datum';
import type { Datum, Minuten, Uhrzeit, Wiederholung } from '../../schema/werte';

export type Erfassung = {
  titel: string; tags: string[]; verantwortlich: string; ort: string;
  frist: Datum | null; wiedervorlage: Datum | null; status: string | null;
  buchung: { datum: Datum; start: Uhrzeit | null; dauer: Minuten } | null;
  wiederholung: Wiederholung | null;
  nurBuchung: boolean; fehler: string[];
};

const WORTE: Record<string, Wiederholung> = {
  täglich: { einheit: 'tag', alle: 1 }, taeglich: { einheit: 'tag', alle: 1 },
  wöchentlich: { einheit: 'woche', alle: 1 }, woechentlich: { einheit: 'woche', alle: 1 },
  monatlich: { einheit: 'monat', alle: 1 }, quartalsweise: { einheit: 'monat', alle: 3 }, halbjährlich: { einheit: 'monat', alle: 6 },
  jährlich: { einheit: 'jahr', alle: 1 }, jaehrlich: { einheit: 'jahr', alle: 1 },
};
const KUERZEL: Record<string, Wiederholung['einheit']> = { t: 'tag', w: 'woche', m: 'monat', j: 'jahr' };

export function wiederholungAusText(s: string): Wiederholung | null {
  s = s.toLowerCase();
  if (WORTE[s]) return { ...WORTE[s]! };
  const m = s.match(/^(\d{1,3})([twmj])$/);
  return m && Number(m[1]) >= 1 ? { einheit: KUERZEL[m[2]!]!, alle: Number(m[1]) } : null;
}

const WDK = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];

export function datumAusText(s: string, heute: Datum): Datum | null {
  s = s.toLowerCase();
  if (s === 'heute' || s === 'h') return heute;
  if (s === 'morgen' || s === 'mrg') return plusTage(heute, 1);
  if (s === 'übermorgen' || s === 'üm') return plusTage(heute, 2);
  let m = s.match(/^\+(\d+)([tw])?$/);
  if (m) return plusTage(heute, Number(m[1]) * (m[2] === 'w' ? 7 : 1));
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?$/);
  if (m) {
    const jahr0 = parseDatum(heute).getFullYear();
    const y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : jahr0;
    const kandidat = (j: number) => fmt(new Date(j, Number(m![2]) - 1, Number(m![1])));
    let r = kandidat(y);
    if (Number(m[2]) > 12 || Number(m[1]) > 31 || !istDatum(r) || new Date(y, Number(m[2]) - 1, Number(m[1])).getDate() !== Number(m[1])) return null;
    if (!m[3] && r < plusTage(heute, -60)) r = kandidat(y + 1);
    return r;
  }
  m = s.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (m && istDatum(m[1])) return m[1]!;
  const w = WDK.indexOf(s.slice(0, 2));
  if (w >= 0 && (s.length === 2 || WT_LANG[w]!.toLowerCase().startsWith(s))) return plusTage(heute, (w - wochentag(heute) + 7) % 7);
  return null;
}

export function dauerAusText(s: string): Minuten | null {
  const m = s.toLowerCase().match(/^(\d+(?:[.,]\d+)?)(h|std|m|min)$/);
  if (!m) return null;
  const v = Number(m[1]!.replace(',', '.'));
  const r = Math.round(m[2] === 'h' || m[2] === 'std' ? v * 60 : v);
  return r > 0 ? r : null;
}

export function parseErfassung(text: string, heute: Datum, spalten: { id: string; name: string }[], standarddauer: Minuten): Erfassung {
  const r: Erfassung = { titel: '', tags: [], verantwortlich: '', ort: '', frist: null, wiedervorlage: null, status: null, buchung: null, wiederholung: null, nurBuchung: false, fehler: [] };
  const toks = text.trim().split(/\s+/).filter(Boolean);
  r.nurBuchung = !!toks[0] && toks[0].startsWith('>');
  const woerter: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i]!, c = tk[0], rest = tk.slice(1);
    if (tk.length < 2) { woerter.push(tk); continue; }
    if (c === '#') r.tags.push(rest.toLowerCase());
    else if (c === '@') r.verantwortlich = rest;
    else if (c === '/') r.ort = rest.replace(/_/g, ' ');
    else if (c === '!') { r.frist = datumAusText(rest, heute); if (!r.frist) r.fehler.push(tk); }
    else if (c === '*') { r.wiederholung = wiederholungAusText(rest); if (!r.wiederholung) r.fehler.push(tk); }
    else if (c === '^') { r.wiedervorlage = datumAusText(rest, heute); if (!r.wiedervorlage) r.fehler.push(tk); }
    else if (c === '=') {
      const n = rest.toLowerCase().replace(/[^a-zäöüß]/g, '');
      const s = spalten.find(x => x.id.toLowerCase().startsWith(n) || x.name.toLowerCase().replace(/\s/g, '').startsWith(n));
      if (s) r.status = s.id; else r.fehler.push(tk);
    } else if (c === '>') {
      const datum = datumAusText(rest, heute);
      if (!datum) { r.fehler.push(tk); continue; }
      const b = { datum, start: null as Uhrzeit | null, dauer: standarddauer };
      if (toks[i + 1] && /^\d{1,2}:\d{2}$/.test(toks[i + 1]!)) {
        const min = minuten(toks[i + 1]!.padStart(5, '0'));
        if (min < 24 * 60) { b.start = uhrzeit(min); i++; }
      }
      if (toks[i + 1] && dauerAusText(toks[i + 1]!)) b.dauer = dauerAusText(toks[++i]!)!;
      r.buchung = b;
    } else woerter.push(tk);
  }
  r.titel = woerter.join(' ');
  if (r.wiederholung && !r.frist) r.frist = heute;
  if (r.nurBuchung && !r.buchung) r.fehler.push('Datum der Buchung fehlt');
  return r;
}
