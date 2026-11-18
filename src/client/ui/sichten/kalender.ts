// Sicht: Kalender – Tag, 3 Tage, Woche, Monat, 3 Monate und Timeline.
// Daten kommen aus der Query `zeitraum`; hier steckt nur Darstellungslogik (Layout, Pixel ↔ Zeit, Zoom).
import {
  relativ,   dauerText, differenz, kurz, kw, MON, MON_LANG, monatsErster, montag, plusMonate, plusTage, tagImMonat, uhrzeit, WT, WT_LANG, wochentag, jahr, monat,
} from '../../../basis/datum';
import type { AufgabeZeile, Aufgabenliste, Bereich, BuchungDto, ExternDto, Tag, Zeitraum } from '../../../body/interface';
import { body } from '../body';
import { auslastungsAnteil, auslastungsStufe, kapazitaetsBalken, zeile } from '../bausteine';
import { esc } from '../dom';
import { I } from '../icons';
import type { Dichte, Sicht } from './sicht';

export type KalAnsicht = 'tag' | 'tage3' | 'woche' | 'monat' | 'monate3' | 'timeline';
export type KalZustand = { ansicht: KalAnsicht; anker: string | null; pph: number; ganzerTag?: boolean };

// Sichtbares Zeitfenster: eingestellte Tageszeit (KERN), erweitert um Termine davor/danach oder ganzer Tag.
// Die Werte gelten jeweils für das gerade gezeichnete Raster; am Raster stehen sie als data-h0/data-h1,
// damit Ziehen, Doppelklick und Dauer-Ziehen (interaktion.ts) mit demselben Fenster rechnen.
let H0 = 7, H1 = 21, SPAN = 14, SPANMIN = 840, KERN = { von: 7, bis: 21 };
function fensterSetzen(h0: number, h1: number, kern: { von: number; bis: number }): void {
  H0 = h0; H1 = h1; SPAN = h1 - h0; SPANMIN = SPAN * 60; KERN = kern;
}
const pct = (min: number) => ((min - H0 * 60) / SPANMIN) * 100;
/** Zeitfenster des Rasters, in dem ein Element liegt (für Interaktionen) */
export function fensterVon(el: Element): { h0: number; h1: number; min: number } {
  const r = el.closest<HTMLElement>('[data-h0]');
  const h0 = Number(r?.dataset.h0 ?? 7), h1 = Number(r?.dataset.h1 ?? 21);
  return { h0, h1, min: (h1 - h0) * 60 };
}
/** Tageszeit, erweitert auf volle Stunden um alle zeitgebundenen Termine der Tage */
function erweitertesFenster(tage: Tag[], kern: { von: number; bis: number }): [number, number] {
  let h0 = kern.von, h1 = kern.bis;
  for (const t of tage) {
    for (const b of t.termine) { h0 = Math.min(h0, Math.floor(b.s / 60)); h1 = Math.max(h1, Math.ceil(Math.min(b.e, 1440) / 60)); }
    for (const x of t.extern) if (x.start !== null) { h0 = Math.min(h0, Math.floor(x.start / 60)); h1 = Math.max(h1, Math.ceil(Math.min(x.ende!, 1440) / 60)); }
  }
  return [Math.max(0, h0), Math.min(24, h1)];
}
const ZEITANSICHTEN: KalAnsicht[] = ['tag', 'tage3', 'woche'];
const NAMEN: Record<KalAnsicht, string> = { tag: 'Tag', tage3: '3 Tage', woche: 'Woche', monat: 'Monat', monate3: '3 Monate', timeline: 'Timeline' };

type Ev = { kind: 'own' | 'extern'; s: number; e: number; lane: number; n: number; titel: string; b?: BuchungDto & { s: number; e: number }; x?: ExternDto };

export class KalenderSicht implements Sicht {
  readonly bereiche: Bereich[] = ['kalender', 'aufgaben'];
  private heute = '';
  private scrollX: number | null = null;
  private el: HTMLElement | null = null;
  private dichte: Dichte = 'full';

  constructor(private z: KalZustand, private readonly ansichten: KalAnsicht[]) {}
  zustand() { return this.z; }

  /** Zeitbereich, den die aktuelle Ansicht braucht */
  private bereich(anker: string): [string, string] {
    switch (this.z.ansicht) {
      case 'tag': return [anker, anker];
      case 'tage3': return [anker, plusTage(anker, 2)];
      case 'woche': { const m = montag(anker); return [m, plusTage(m, 6)]; }
      case 'monat': { const s = montag(monatsErster(anker)); return [s, plusTage(s, 41)]; }
      case 'monate3': { const s = montag(monatsErster(anker)); return [s, plusTage(montag(plusMonate(anker, 2)), 41)]; }
      case 'timeline': { const s = plusTage(montag(anker), -7); return [s, plusTage(s, 55)]; }
    }
  }

  async render(el: HTMLElement, dichte: Dichte): Promise<void> {
    this.el = el; this.dichte = dichte;
    if (!this.heute) this.heute = (await body.heute()).datum;
    const anker = this.z.anker ?? this.heute;
    if (dichte === 'mini') {
      const z = await body.zeitraum({ von: this.heute, bis: this.heute });
      el.innerHTML = agendaMini(z);
      return;
    }
    const [von, bis] = this.bereich(anker);
    const [z, e] = await Promise.all([body.zeitraum({ von, bis }), body.einstellungen()]);
    this.heute = z.heute;
    const zeitansicht = ZEITANSICHTEN.includes(this.z.ansicht);
    const [h0, h1] = zeitansicht && this.z.ganzerTag ? [0, 24] : erweitertesFenster(z.tage, e.tageszeit);
    fensterSetzen(h0, h1, e.tageszeit);
    let inhalt = '';
    switch (this.z.ansicht) {
      case 'tag': {
        const liste = dichte === 'full' ? await body.liste({}) : null;
        inhalt = `<div style="display:flex;flex:1;min-height:0"><div style="flex:1;min-width:0;display:flex;flex-direction:column">${woche(z, z.tage, dichte)}</div>${liste ? tagSeite(z.tage[0]!, liste, z.heute) : ''}</div>`;
        break;
      }
      case 'tage3': case 'woche': inhalt = woche(z, z.tage, dichte); break;
      case 'monat': inhalt = monatsRaster(z, z.tage, anker, dichte); break;
      case 'monate3': inhalt = `<div class="months">${[0, 1, 2].map(i => { const m = plusMonate(anker, i); const s = montag(monatsErster(m)); const t = z.tage.filter(x => x.datum >= s && x.datum <= plusTage(s, 41)); return `<div class="mm"><div class="mm-h">${MON_LANG[monat(m)]} ${jahr(m)}</div>${monatsRaster(z, t, m, 'compact')}</div>`; }).join('')}</div>`; break;
      case 'timeline': inhalt = timeline(z, this.z.pph); break;
    }
    el.innerHTML = `<div class="cal ${dichte}">
      <div class="cal-tb">
        ${this.ansichten.length > 1 ? `<div class="seg">${this.ansichten.map(v => `<button data-cal-view="${v}" class="${this.z.ansicht === v ? 'on' : ''}">${NAMEN[v]}</button>`).join('')}</div>` : ''}
        ${zeitansicht ? `<button class="ganztag ${this.z.ganzerTag ? 'on' : ''}" data-cal-ganz="1" title="${this.z.ganzerTag ? 'Nur Tageszeit zeigen (davor/danach nur, wenn dort Termine sind)' : `Ganzen Tag zeigen (0–24 Uhr) – sonst ${e.tageszeit.von}–${e.tageszeit.bis} Uhr`}">${this.z.ganzerTag ? I.einklappen : I.ausklappen}</button>` : ''}
        <div class="nav"><button data-cal-nav="-1" title="zurück">${I.links}</button><button data-cal-nav="0">Heute</button><button data-cal-nav="1" title="vor">${I.rechts}</button></div>
        ${this.z.ansicht !== 'timeline' ? `<span class="title">${titel(this.z.ansicht, anker)}</span>`
          : `<span class="zoom">Zoom <input type="range" min="2" max="48" value="${this.z.pph}" data-cal-zoom /> <span>${this.z.pph < 6 ? 'Wochen' : this.z.pph < 20 ? 'Tage' : 'Stunden'}</span></span>`}
        <span class="spacer"></span>
        ${dichte === 'full' ? `<span class="legend"><span><i style="background:var(--own)"></i>Termin</span><span><i style="border:1.5px dashed var(--own)"></i>Reservierung</span><span><i style="background:var(--free)"></i>ohne Aufgabe</span><span><i style="background:#9ca3af"></i>extern</span></span>` : ''}
      </div>
      <div class="cal-b">${inhalt}</div></div>`;
    this.binden(el, anker);
  }

  private binden(el: HTMLElement, anker: string): void {
    el.onclick = e => {
      const t = e.target as HTMLElement;
      const v = t.closest<HTMLElement>('[data-cal-view]'), n = t.closest<HTMLElement>('[data-cal-nav]');
      if (t.closest('[data-cal-ganz]')) { this.z.ganzerTag = !this.z.ganzerTag; void this.neu(); return; }
      if (v) { this.z.ansicht = v.dataset.calView as KalAnsicht; this.scrollX = null; void this.neu(); }
      if (n) {
        const k = Number(n.dataset.calNav);
        if (k === 0) { this.z.anker = null; this.scrollX = null; }
        else {
          const a = this.z.ansicht;
          this.z.anker = a === 'tag' ? plusTage(anker, k) : a === 'tage3' ? plusTage(anker, 3 * k) : a === 'woche' ? plusTage(anker, 7 * k)
            : a === 'timeline' ? plusTage(anker, 14 * k) : plusMonate(anker, k);
          if (a === 'timeline') this.scrollX = null;
        }
        void this.neu();
      }
    };
    el.ondblclick = e => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('.mc[data-day]');
      if (c && this.ansichten.includes('tag')) { this.z.ansicht = 'tag'; this.z.anker = c.dataset.day!; void this.neu(); }
    };
    if (this.z.ansicht === 'woche' || this.z.ansicht === 'tag' || this.z.ansicht === 'tage3') {
      const sc = el.querySelector<HTMLElement>('.wk-scroll');
      if (sc && this.dichte === 'full') sc.scrollTop = Math.max(0, ((KERN.von - H0) / SPAN) * sc.scrollHeight - 10);
    }
    if (this.z.ansicht === 'timeline') {
      const sc = el.querySelector<HTMLElement>('.tl-scroll')!;
      const start = plusTage(montag(anker), -7), dayW = SPAN * this.z.pph;
      sc.scrollLeft = this.scrollX ?? Math.max(0, (differenz(start, this.heute) - 1) * dayW);
      sc.onscroll = () => { this.scrollX = sc.scrollLeft; };
      const zoom = (pph: number, cx: number) => {
        pph = Math.max(2, Math.min(48, Math.round(pph)));
        if (pph === this.z.pph) return;
        const t = (sc.scrollLeft + cx) / (SPAN * this.z.pph);
        this.z.pph = pph;
        this.scrollX = t * SPAN * pph - cx;
        void this.neu();
      };
      const r = el.querySelector<HTMLInputElement>('[data-cal-zoom]')!;
      r.oninput = () => zoom(Number(r.value), sc.clientWidth / 2);
      sc.onwheel = ev => {
        if (!(ev.ctrlKey || ev.metaKey)) return;
        ev.preventDefault();
        zoom(this.z.pph * Math.exp(-ev.deltaY * 0.01), ev.clientX - sc.getBoundingClientRect().left);
      };
      (el as HTMLElement & { _tl?: unknown })._tl = { start, pph: this.z.pph, h0: H0, h1: H1 };
    }
  }

  private async neu(): Promise<void> { if (this.el) await this.render(this.el, this.dichte); }
}

function titel(a: KalAnsicht, anker: string): string {
  if (a === 'tag') return `${WT_LANG[wochentag(anker)]}, ${tagImMonat(anker)}. ${MON_LANG[monat(anker)]}`;
  if (a === 'woche') { const m = montag(anker); return `KW ${kw(m)} · ${kurz(m)}–${kurz(plusTage(m, 6))}`; }
  if (a === 'tage3') return `${WT[wochentag(anker)]} ${kurz(anker)} – ${WT[wochentag(plusTage(anker, 2))]} ${kurz(plusTage(anker, 2))}`;
  if (a === 'monate3') { const b = plusMonate(anker, 2); return `${MON[monat(anker)]} – ${MON[monat(b)]} ${jahr(b)}`; }
  return `${MON_LANG[monat(anker)]} ${jahr(anker)}`;
}

// ---------- Bausteine ----------
function anordnen(evs: Ev[]): Ev[] {
  evs.sort((a, b) => a.s - b.s || b.e - a.e);
  const gruppen: Ev[][] = []; let cur: Ev[] = [], ende = -1;
  for (const e of evs) { if (cur.length && e.s >= ende) { gruppen.push(cur); cur = []; } cur.push(e); ende = Math.max(ende, e.e); }
  if (cur.length) gruppen.push(cur);
  for (const g of gruppen) {
    const lanes: number[] = [];
    for (const e of g) { let i = lanes.findIndex(x => x <= e.s); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = e.e; e.lane = i; }
    g.forEach(e => { e.n = lanes.length; });
  }
  return evs;
}

function ereignisse(t: Tag): Ev[] {
  return anordnen([
    ...t.termine.map(b => ({ kind: 'own' as const, s: b.s, e: b.e, lane: 0, n: 1, titel: b.titel, b })),
    ...t.extern.filter(x => x.start !== null).map(x => ({ kind: 'extern' as const, s: x.start!, e: Math.max(x.ende!, x.start! + 15), lane: 0, n: 1, titel: x.titel, x })),
  ]);
}

function evHtml(e: Ev, dichte: Dichte): string {
  const top = Math.max(0, pct(e.s)), h = Math.max(2.2, pct(e.e) - pct(e.s));
  const w = 100 / e.n;
  const pos = `top:${top}%;height:${h}%;left:calc(${e.lane * w}% + 1px);width:calc(${w}% - 3px)`;
  const zeit = dichte === 'full' && e.e - e.s >= 45 ? `<small>${uhrzeit(e.s)}–${uhrzeit(e.e)}</small>` : '';
  if (e.b) {
    const b = e.b;
    const tip = `${b.titel}${b.aufgabentitel && b.aufgabentitel !== b.titel ? ` (Aufgabe: ${b.aufgabentitel})` : ''} · ${uhrzeit(b.s)}–${uhrzeit(b.e)}${b.belegt ? '' : ' · belegt keine Kapazität'}`;
    return `<div class="ev own ${b.aufgabeId ? '' : 'frei'} ${b.abgeschlossen ? 'done' : ''}" draggable="true" data-booking="${b.id}"${b.aufgabeId ? ` data-task="${b.aufgabeId}"` : ''} style="${pos}" title="${esc(tip)}">${esc(b.titel)}${zeit}<span class="zieh" data-zieh="${b.id}" data-dauer="${b.dauer}" title="Ziehen: Dauer ändern"></span></div>`;
  }
  const x = e.x!;
  return `<div class="ev extern ${x.belegt ? 'belegt' : ''}" style="${pos};--kf:${x.farbe}" title="${esc(`${x.titel} · ${uhrzeit(e.s)}–${uhrzeit(e.e)} · ${x.konto} / ${x.kalender}${x.belegt ? ' · belegt Kapazität' : ''}${x.ort ? ' · ' + x.ort : ''}`)}">${esc(x.titel)}${zeit}</div>`;
}

export const resHtml = (r: BuchungDto) =>
  `<div class="resv ${r.aufgabeId ? '' : 'frei'} ${r.abgeschlossen ? 'done' : ''}" draggable="true" data-booking="${r.id}"${r.aufgabeId ? ` data-task="${r.aufgabeId}"` : ''} title="${esc(`${r.aufgabeId ? '' : 'Freie '}Reservierung: ${r.titel} · ${dauerText(r.dauer)}${r.belegt ? '' : ' · belegt keine Kapazität'}`)}"><b>${dauerText(r.dauer).replace(' ', '')}</b><span>${esc(r.titel)}</span></div>`;

const ganztags = (t: Tag) => t.extern.filter(x => x.start === null).map(x => `<div class="ext-ganz" style="background:${x.farbe}" title="${esc(`${x.titel} · ganztägig · ${x.kalender}`)}">${esc(x.titel)}</div>`).join('');

function fristMarke(t: Tag): string {
  if (!t.fristen.length) return '';
  const d = t.fristen[0]!.dringlichkeit;
  const farbe = `var(--d-${d})`;
  return `<span class="fr" style="color:${farbe}" title="${esc('Fällig:\n' + t.fristen.map(f => f.titel).join('\n'))}">${I.frist}${t.fristen.length}</span>`;
}

function woche(z: Zeitraum, tage: Tag[], dichte: Dichte): string {
  const n = tage.length;
  const kopf = tage.map(t => `<div class="dh ${t.datum === z.heute ? 'today' : ''} ${wochentag(t.datum) > 4 ? 'we' : ''}" data-day="${t.datum}"><span class="wd">${n === 1 ? WT_LANG[wochentag(t.datum)] : WT[wochentag(t.datum)]}</span><span class="dn">${tagImMonat(t.datum)}</span>${fristMarke(t)}</div>`).join('');
  const band = tage.map(t => `<div class="rb" data-drop-res="${t.datum}">${ganztags(t)}${t.reservierungen.map(resHtml).join('')}${kapazitaetsBalken(t.auslastung)}</div>`).join('');
  let stunden = '';
  // auch erste und letzte Stunde beschriften: oben unter, unten über die Randlinie gesetzt
  for (let h = H0; h <= H1; h++) stunden += `<span class="${h === H0 ? 'erst' : h === H1 ? 'letzt' : ''}" style="top:${((h - H0) / SPAN) * 100}%">${h}</span>`;
  const spalten = tage.map(t => {
    const jetzt = t.datum === z.heute && z.jetzt >= H0 * 60 && z.jetzt <= H1 * 60 ? `<div class="nowline" style="top:${pct(z.jetzt)}%"></div>` : '';
    // Stunden außerhalb der eingestellten Tageszeit dezent schraffiert
    const davor = KERN.von > H0 ? `<div class="ausserhalb" style="top:0;height:${pct(KERN.von * 60)}%"></div>` : '';
    const danach = KERN.bis < H1 ? `<div class="ausserhalb" style="top:${pct(KERN.bis * 60)}%;bottom:0"></div>` : '';
    return `<div class="dcol ${wochentag(t.datum) > 4 ? 'we' : ''}" data-drop-day="${t.datum}">${davor}${danach}${ereignisse(t).map(e => evHtml(e, dichte)).join('')}${jetzt}</div>`;
  }).join('');
  return `<div class="wk ${dichte}" style="--n:${n};--stunden:${SPAN}" data-h0="${H0}" data-h1="${H1}">
    <div class="wk-row wk-h"><div></div>${kopf}</div>
    <div class="wk-row wk-res"><div class="lbl">Reser&shy;vie&shy;rung</div>${band}</div>
    <div class="wk-scroll"><div class="wk-grid"><div class="wk-row"><div class="hours">${stunden}</div>${spalten}</div></div></div>
  </div>`;
}

/** Seitenleiste der Tagesansicht: überfällige und an diesem Tag fällige Aufgaben – als ziehbare Zeilen
 *  wie in der Aufgabenliste (Rauten in denselben Farben), dazu Wiedervorlagen. Buchungen und Auslastung
 *  stehen bereits im Raster und fehlen hier bewusst. */
function tagSeite(t: Tag, l: Aufgabenliste, heute: string): string {
  const alle = l.gruppen.flatMap(g => g.aufgaben);
  const amTag = alle.filter(a => a.frist === t.datum);
  const ueberfaellig = l.gruppen.find(g => g.art === 'ueberfaellig')!.aufgaben.filter(a => a.frist !== t.datum);
  const wv = t.wiedervorlagen.map(w => alle.find(a => a.id === w.aufgabeId) ?? l.zurueckgestellt.find(a => a.id === w.aufgabeId)).filter(Boolean) as AufgabeZeile[];
  const abschnitt = (name: string, klasse: string, aufgaben: AufgabeZeile[]) => aufgaben.length
    ? `<div class="ds-abschnitt"><div class="ds-h ${klasse}">${esc(name)} <span class="n">${aufgaben.length}</span></div>${aufgaben.map(a => zeile(a, heute, false)).join('')}</div>` : '';
  const tagName = t.datum === heute ? 'heute' : relativ(t.datum, heute);
  const inhalt = abschnitt('Überfällig', 'ueberfaellig', ueberfaellig)
    + abschnitt(`Fällig ${tagName}`, amTag[0]?.dringlichkeit ?? '', amTag)
    + abschnitt('Taucht wieder auf', '', wv);
  return `<div class="day-side">
    ${inhalt || '<div class="muted" style="font-size:12px">Keine überfälligen oder fälligen Aufgaben.</div>'}
    <div class="ds-hinweis">${I.plus}<span>Aufgabe hierher in den Kalender ziehen: Termin.<br>Doppelklick ins Raster oder Reservierungsband: Buchung ohne Aufgabe.</span></div>
  </div>`;
}

/** Monatsansicht: je Tag alle Einträge untereinander über die volle Breite (ganztägig, Reservierungen,
 *  Termine nach Uhrzeit); links ein schmaler Streifen mit Punkten, wo im Tagesverlauf Termine liegen;
 *  unten die Auslastung. */
function monatsRaster(z: Zeitraum, tage: Tag[], anker: string, dichte: Dichte): string {
  const m = monat(anker);
  const max = dichte === 'full' ? 6 : 3;
  const zellen = tage.slice(0, 42).map(t => {
    const ev = ereignisse(t).sort((a, b) => a.s - b.s);
    const farbe = (e: Ev) => (e.b ? (e.b.aufgabeId ? 'var(--own)' : 'var(--free)') : e.x!.farbe);
    const punkte = ev.map(e => `<i style="top:${Math.min(100, Math.max(0, pct(e.s)))}%;background:${farbe(e)}" title="${esc(`${uhrzeit(e.s)} ${e.titel}`)}"></i>`).join('');
    const eintraege = [
      ...t.extern.filter(x => x.start === null).map(x => `<div class="me ganz" style="--kf:${x.farbe}" title="${esc(`${x.titel} · ganztägig · ${x.kalender}`)}"><span class="tt">${esc(x.titel)}</span></div>`),
      ...t.reservierungen.map(r => `<div class="me res ${r.aufgabeId ? '' : 'frei'} ${r.abgeschlossen ? 'done' : ''}" draggable="true" data-booking="${r.id}"${r.aufgabeId ? ` data-task="${r.aufgabeId}"` : ''} title="${esc(`Reservierung ${dauerText(r.dauer)}: ${r.titel}`)}"><span class="zt">${dauerText(r.dauer).replace(' ', '')}</span><span class="tt">${esc(r.titel)}</span></div>`),
      ...ev.map(e => e.b
        ? `<div class="me term ${e.b.aufgabeId ? 'own' : 'frei'} ${e.b.abgeschlossen ? 'done' : ''}" draggable="true" data-booking="${e.b.id}"${e.b.aufgabeId ? ` data-task="${e.b.aufgabeId}"` : ''} style="--kf:${farbe(e)}" title="${esc(`${uhrzeit(e.s)}–${uhrzeit(e.e)} ${e.titel}`)}"><span class="zt">${uhrzeit(e.s)}</span><span class="tt">${esc(e.titel)}</span></div>`
        : `<div class="me term extern" style="--kf:${e.x!.farbe}" title="${esc(`${uhrzeit(e.s)}–${uhrzeit(e.e)} ${e.titel} · ${e.x!.kalender}`)}"><span class="zt">${uhrzeit(e.s)}</span><span class="tt">${esc(e.titel)}</span></div>`),
    ];
    const liste = eintraege.slice(0, max).join('') + (eintraege.length > max ? `<div class="me mehr">+${eintraege.length - max} weitere</div>` : '');
    const anders = monat(t.datum) !== m;
    return `<div class="mc ${anders ? 'other' : ''} ${t.datum === z.heute ? 'today' : ''} ${wochentag(t.datum) > 4 ? 'we' : ''}" data-drop-res="${t.datum}" data-day="${t.datum}" title="Doppelklick: Tagesansicht">
      <div class="mh"><span class="dn">${tagImMonat(t.datum)}</span>${fristMarke(t)}</div>
      <div class="mb"><div class="mpunkte" title="Termine im Tagesverlauf (${H0}–${H1} Uhr)">${punkte}</div><div class="mliste">${liste}</div></div>${kapazitaetsBalken(t.auslastung)}</div>`;
  }).join('');
  return `<div class="mo ${dichte}"><div class="mo-h">${WT.map(w => `<div>${w}</div>`).join('')}</div><div class="mo-g">${zellen}</div></div>`;
}

function timeline(z: Zeitraum, pph: number): string {
  const dayW = SPAN * pph, N = z.tage.length, start = z.tage[0]!.datum;
  const x = (i: number, min: number) => i * dayW + ((min - H0 * 60) / 60) * pph;
  let oben = '', tage = '', std = '', hg = '';
  const bahn = { fristen: '', termine: '', res: '', ext: '', wv: '', last: '' };
  let maxF = 1, maxExt = 1;
  z.tage.forEach((t, i) => {
    const wd = wochentag(t.datum), links = i * dayW;
    if (wd === 0) oben += `<span style="left:${links}px">KW ${kw(t.datum)} · ${kurz(t.datum)}</span>`;
    if (wd > 4) hg += `<div class="we" style="left:${links}px;width:${dayW}px"></div>`;
    hg += `<div class="dl" style="left:${links}px"></div>`;
    if (dayW >= 34) tage += `<span class="${t.datum === z.heute ? 'today' : ''}" style="left:${links}px;width:${dayW}px">${dayW >= 80 ? WT[wd] + ' ' : ''}${tagImMonat(t.datum)}${dayW >= 80 ? '.' + (monat(t.datum) + 1) + '.' : ''}</span>`;
    if (pph >= 22) for (let h = H0 + 1; h < H1; h += pph >= 40 ? 1 : 2) std += `<span style="left:${links + (h - H0) * pph}px">${h}</span>`;
    for (const b of t.termine) bahn.termine += `<div class="tl-it own ${b.aufgabeId ? '' : 'frei'}" draggable="true" data-booking="${b.id}"${b.aufgabeId ? ` data-task="${b.aufgabeId}"` : ''} style="left:${x(i, b.s)}px;width:${Math.max(6, (b.dauer / 60) * pph - 2)}px;top:6px" title="${esc(`${b.titel} · ${b.start}`)}">${esc(b.titel)}</div>`;
    let off = H0 * 60;
    for (const r of t.reservierungen) { bahn.res += `<div class="tl-it resv ${r.aufgabeId ? '' : 'frei'}" draggable="true" data-booking="${r.id}"${r.aufgabeId ? ` data-task="${r.aufgabeId}"` : ''} style="left:${x(i, off)}px;width:${Math.max(6, (r.dauer / 60) * pph - 2)}px;top:6px" title="${esc(`Reservierung ${dauerText(r.dauer)}: ${r.titel}`)}"><b>${dauerText(r.dauer).replace(' ', '')}</b> ${esc(r.titel)}</div>`; off += r.dauer; }
    const ext = anordnen(t.extern.filter(e => e.start !== null).map(e => ({ kind: 'extern' as const, s: e.start!, e: Math.max(e.ende!, e.start! + 15), lane: 0, n: 1, titel: e.titel, x: e })));
    ext.forEach(e => { maxExt = Math.max(maxExt, e.lane + 1); bahn.ext += `<div class="tl-it extern" style="left:${x(i, e.s)}px;width:${Math.max(6, ((e.e - e.s) / 60) * pph - 2)}px;top:${4 + e.lane * 24}px;--kf:${e.x!.farbe}" title="${esc(`${e.titel} · ${uhrzeit(e.s)} · ${e.x!.kalender}`)}">${esc(e.titel)}</div>`; });
    maxF = Math.max(maxF, t.fristen.length);
    t.fristen.forEach((f, k) => { bahn.fristen += `<div class="tl-mark" data-task="${f.aufgabeId}" style="--dfarbe:var(--d-${f.dringlichkeit});left:${x(i, H1 * 60) - 4}px;top:${4 + k * 18}px;flex-direction:row-reverse" title="${esc('Frist: ' + f.titel)}"><span class="dia">${I.frist}</span>${dayW >= 60 ? `<span style="max-width:${dayW - 22}px">${esc(f.titel)}</span>` : ''}</div>`; });
    t.wiedervorlagen.forEach((w, k) => { bahn.wv += `<div class="tl-mark wv" data-task="${w.aufgabeId}" style="left:${x(i, H0 * 60) + 6}px;top:${5 + k * 18}px" title="${esc('Wiedervorlage: ' + w.titel)}"><span class="dia">${I.frist}</span>${dayW >= 60 ? `<span style="max-width:${dayW - 22}px">${esc(w.titel)}</span>` : ''}</div>`; });
    const a = t.auslastung, p = auslastungsAnteil(a), stufe = auslastungsStufe(p);
    bahn.last += `<div class="tl-last st-${stufe}" title="${esc(`${dauerText(a.belegt)} von ${dauerText(a.kapazitaet)}${stufe === 'ueber' ? ' – überbucht!' : ''}`)}" style="left:${links + 3}px;width:${dayW - 6}px;height:${(Math.min(1.15, p) / 1.15) * 30}px"></div>`
      + (dayW >= 60 && (a.belegt || a.kapazitaet) ? `<span class="tl-last-text st-${stufe}" style="left:${links + 6}px">${stufe === 'ueber' ? I.warnung : ''}${dauerText(a.belegt).replace(' ', '')} / ${dauerText(a.kapazitaet).replace(' ', '')}</span>`
        : stufe === 'ueber' ? `<span class="tl-last-text st-ueber" style="left:${links + 4}px">${I.warnung}</span>` : '');
  });
  const iHeute = differenz(start, z.heute);
  const jetzt = iHeute >= 0 && iHeute < N ? `<div class="tl-now" style="left:${x(iHeute, Math.min(Math.max(z.jetzt, H0 * 60), H1 * 60))}px"></div>` : '';
  const spur = (k: keyof typeof bahn, label: string, h: number, drop?: string) => `<div class="tl-lane" style="height:${h}px" ${drop ? `data-drop-tl="${drop}"` : ''}><span class="ll">${label}</span>${bahn[k]}</div>`;
  return `<div class="tl"><div class="tl-scroll"><div class="tl-inner" style="width:${N * dayW}px">
    <div class="tl-head"><div class="r top">${oben}</div>${tage ? `<div class="r">${tage}</div>` : ''}${std ? `<div class="r hrs">${std}</div>` : ''}</div>
    <div style="position:relative"><div class="tl-bg">${hg}</div>
      ${spur('fristen', 'Fristen', 8 + maxF * 18)}
      ${spur('termine', 'Termine', 34, 'termin')}
      ${spur('res', 'Reservierungen', 34, 'res')}
      ${spur('ext', 'Extern', 10 + maxExt * 24)}
      ${spur('wv', 'Wiedervorlage', 26)}
      ${spur('last', 'Auslastung', 50)}
      ${jetzt}
    </div></div></div></div>`;
}

function agendaMini(z: Zeitraum): string {
  const t = z.tage[0]!;
  const ev = ereignisse(t);
  const naechstes = ev.find(e => e.e > z.jetzt);
  return `<div class="mini">
    <div class="kpi"><b>${WT[wochentag(t.datum)]} ${tagImMonat(t.datum)}.</b> <span class="muted">KW ${kw(t.datum)}</span></div>
    ${naechstes ? `<div class="muted" style="font-size:12px">Als Nächstes · ${uhrzeit(naechstes.s)}<br><b style="color:var(--ink)">${esc(naechstes.titel)}</b></div>` : ''}
    <div class="peek">${ev.map(e => `<div style="${e.e <= z.jetzt ? 'opacity:.45' : ''}" ${e.b ? `data-booking="${e.b.id}"` : ''}><span class="legend"><i style="background:${e.x ? e.x.farbe : 'var(--own)'}"></i></span>${uhrzeit(e.s)} ${esc(e.titel)}</div>`).join('')}</div>
    <div class="peek">${t.reservierungen.map(resHtml).join('')}</div>
    ${kapazitaetsBalken(t.auslastung)}
  </div>`;
}
