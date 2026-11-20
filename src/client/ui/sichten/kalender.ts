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
import { timelineBinden, timelineZeichnen } from './timeline';

export type KalAnsicht = 'tag' | 'tage3' | 'woche' | 'monat' | 'monate3' | 'timeline';
export type KalZustand = {
  ansicht: KalAnsicht; anker: string | null; pph: number; ganzerTag?: boolean;
  /** markierter Tag – bleibt beim Wechsel der Ansicht im Blick */ markiert?: string | null;
  /** gescrollt: Woche beginnt am Anker (statt am Montag), Monat an der Anker-Woche (statt am Monatsersten) */
  frei?: boolean;
};

/** markierter Tag der gerade gezeichneten Sicht (für die Zeichenfunktionen) */
let MARKIERT: string | null = null;

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
const NAMEN: Record<KalAnsicht, string> = { tag: '1 Tag', tage3: '3 Tage', woche: 'Woche', monat: 'Monat', monate3: '3 Monate', timeline: 'Timeline' };

type Ev = { kind: 'own' | 'extern'; s: number; e: number; lane: number; n: number; titel: string; b?: BuchungDto & { s: number; e: number }; x?: ExternDto };

export class KalenderSicht implements Sicht {
  readonly bereiche: Bereich[] = ['kalender', 'aufgaben'];
  private heute = '';
  private scrollX: number | null = null;
  /** zuletzt gezeichneter Zeitraum der Timeline – Zoom zeichnet nur den Inhalt neu, nicht den Regler */
  private tlZeitraum: Zeitraum | null = null;
  private el: HTMLElement | null = null;
  private dichte: Dichte = 'full';

  constructor(private z: KalZustand, private readonly ansichten: KalAnsicht[]) {}
  zustand() { return this.z; }

  /** Zeitbereich, den die aktuelle Ansicht braucht */
  private bereich(anker: string): [string, string] {
    switch (this.z.ansicht) {
      case 'tag': return [anker, anker];
      case 'tage3': return [anker, plusTage(anker, 2)];
      case 'woche': { const m = this.z.frei ? anker : montag(anker); return [m, plusTage(m, 6)]; }
      case 'monat': { const s = this.z.frei ? montag(anker) : montag(monatsErster(anker)); return [s, plusTage(s, 41)]; }
      case 'monate3': { const s = montag(monatsErster(anker)); return [s, plusTage(montag(plusMonate(anker, 2)), 41)]; }
      case 'timeline': { const s = plusTage(montag(anker), -7); return [s, plusTage(s, 55)]; }
    }
  }

  async render(el: HTMLElement, dichte: Dichte): Promise<void> {
    MARKIERT = this.z.markiert ?? null;
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
      case 'monat': inhalt = monatsRaster(z, z.tage, this.monatsBezug(anker), dichte); break;
      case 'monate3': inhalt = `<div class="months">${[0, 1, 2].map(i => { const m = plusMonate(anker, i); const s = montag(monatsErster(m)); const t = z.tage.filter(x => x.datum >= s && x.datum <= plusTage(s, 41)); return `<div class="mm"><div class="mm-h">${MON_LANG[monat(m)]} ${jahr(m)}</div>${monatsRaster(z, t, m, 'compact')}</div>`; }).join('')}</div>`; break;
      case 'timeline': this.tlZeitraum = z; inhalt = timelineZeichnen(z, this.z.pph, H0, H1, MARKIERT); break;
    }
    el.innerHTML = `<div class="cal ${dichte}">
      <div class="cal-tb">
        ${this.ansichten.length > 1 ? `<div class="seg">${this.ansichten.map(v => `<button data-cal-view="${v}" class="${this.z.ansicht === v ? 'on' : ''}">${NAMEN[v]}</button>`).join('')}</div>` : ''}
        ${zeitansicht ? `<button class="ganztag ${this.z.ganzerTag ? 'on' : ''}" data-cal-ganz="1" title="${this.z.ganzerTag ? 'Nur Tageszeit zeigen (davor/danach nur, wenn dort Termine sind)' : `Ganzen Tag zeigen (0–24 Uhr) – sonst ${e.tageszeit.von}–${e.tageszeit.bis} Uhr`}">${this.z.ganzerTag ? I.einklappen : I.ausklappen}</button>` : ''}
        <div class="nav"><button data-cal-nav="-1" title="zurück">${I.links}</button><button data-cal-nav="0">Heute</button><button data-cal-nav="1" title="vor">${I.rechts}</button></div>
        ${this.z.ansicht !== 'timeline' ? `<span class="title">${titel(this.z.ansicht, this.z.ansicht === 'monat' ? this.monatsBezug(anker) : this.z.ansicht === 'woche' ? this.bereich(anker)[0] : anker)}</span>`
          : `<span class="zoom">Zoom <input type="range" min="2" max="48" value="${this.z.pph}" data-cal-zoom /> <span class="zoom-stufe">${zoomStufe(this.z.pph)}</span></span>`}
        <span class="spacer"></span>
        ${dichte === 'full' ? `<span class="legend"><span><i style="background:var(--own)"></i>Termin</span><span><i style="border:1.5px dashed var(--own)"></i>Reservierung</span><span><i style="background:var(--free)"></i>ohne Aufgabe</span><span><i style="background:#9ca3af"></i>extern</span></span>` : ''}
      </div>
      <div class="cal-b">${inhalt}</div></div>`;
    this.binden(el, anker);
    if (this.fokussieren) {
      // markierten Tag in den Blick holen (nach Wechsel der Ansicht oder beim Markieren)
      this.fokussieren = false;
      el.querySelector<HTMLElement>('.markiert')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    monatEinpassen(el);
    if (!el.dataset.einpassen) {
      // ändert sich die Zellgröße (Trenner, Fenster), neu einpassen
      el.dataset.einpassen = '1';
      new ResizeObserver(() => monatEinpassen(el)).observe(el);
    }
  }

  private fokussieren = false;

  private binden(el: HTMLElement, anker: string): void {
    el.onclick = e => {
      // Tag markieren: Klick auf Tageskopf, Monatszelle oder Tag in der Timeline; nochmal → weg
      const tg = e.target as HTMLElement, markier = tg.closest<HTMLElement>('[data-markier]');
      if (markier && !tg.closest('[data-booking], [data-extern], [data-task], [data-fristen], .me.mehr, button')) {
        const d = markier.dataset.markier!;
        this.z.markiert = this.z.markiert === d ? null : d;
        this.fokussieren = !!this.z.markiert;
        void this.neu();
        return;
      }
      const mehr = (e.target as HTMLElement).closest<HTMLElement>('.me.mehr');
      if (mehr) {
        // „+n weitere“: schon ein Klick öffnet den Tag
        this.z.ansicht = this.ansichten.includes('tag') ? 'tag' : 'tage3';
        this.z.anker = mehr.closest<HTMLElement>('.mc[data-day]')!.dataset.day!;
        void this.neu();
        return;
      }
      const t = e.target as HTMLElement;
      const v = t.closest<HTMLElement>('[data-cal-view]'), n = t.closest<HTMLElement>('[data-cal-nav]');
      if (t.closest('[data-cal-ganz]')) { this.z.ganzerTag = !this.z.ganzerTag; void this.neu(); return; }
      if (v) {
        this.z.ansicht = v.dataset.calView as KalAnsicht; this.scrollX = null; this.z.frei = false;
        // ein markierter Tag bestimmt den Ausschnitt der neuen Ansicht und wird in den Blick geholt
        if (this.z.markiert) { this.z.anker = this.z.markiert; this.fokussieren = true; }
        void this.neu();
      }
      if (n) {
        const k = Number(n.dataset.calNav);
        // Pfeile/Heute rasten wieder ein (Woche ab Montag, Monat ab dem Ersten)
        if (this.z.ansicht === 'monat' && this.z.frei) anker = this.monatsBezug(anker);
        this.z.frei = false;
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
    // Monat: Doppelklick auf die Tageszahl (oder „+n weitere“) öffnet den Tag; in die freie Fläche → Buchung ohne Aufgabe (interaktion.ts)
    el.ondblclick = e => {
      const t = e.target as HTMLElement;
      const c = t.closest<HTMLElement>('.mc[data-day]');
      if (!c || !t.closest('.mh, .me.mehr')) return;
      this.z.ansicht = this.ansichten.includes('tag') ? 'tag' : 'tage3';
      this.z.anker = c.dataset.day!;
      void this.neu();
    };
    if (this.z.ansicht === 'woche' || this.z.ansicht === 'tag' || this.z.ansicht === 'tage3') {
      const sc = el.querySelector<HTMLElement>('.wk-scroll');
      if (sc && this.behalteY !== null) sc.scrollTop = this.behalteY;
      else if (sc && this.dichte === 'full') sc.scrollTop = Math.max(0, ((KERN.von - H0) / SPAN) * sc.scrollHeight - 10);
      this.behalteY = null;
    }
    this.scrollenEinrichten(el, anker);
    if (this.z.ansicht === 'timeline') {
      // Regler: nur einmal je Zeichnung binden – beim Ziehen wird nur der Inhalt neu gezeichnet
      const r = el.querySelector<HTMLInputElement>('[data-cal-zoom]')!;
      r.oninput = () => this.zoomen(el, anker, Number(r.value), el.querySelector<HTMLElement>('.tl-scroll')!.clientWidth / 2);
      this.timelineEinrichten(el, anker);
    }
  }

  /** Scrollposition, Mausrad-Zoom und Klicks der Timeline (nach jedem Zeichnen des Inhalts) */
  private timelineEinrichten(el: HTMLElement, anker: string): void {
    const sc = el.querySelector<HTMLElement>('.tl-scroll')!;
    const start = plusTage(montag(anker), -7), dayW = SPAN * this.z.pph;
    sc.scrollLeft = this.scrollX ?? Math.max(0, (differenz(start, this.z.markiert ?? this.heute) - 1) * dayW);
    sc.onscroll = () => { this.scrollX = sc.scrollLeft; };
    sc.onwheel = ev => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      this.zoomen(el, anker, this.z.pph * Math.exp(-ev.deltaY * 0.01), ev.clientX - sc.getBoundingClientRect().left);
    };
    (el as HTMLElement & { _tl?: unknown })._tl = { start, pph: this.z.pph, h0: H0, h1: H1 };
    timelineBinden(el);
  }

  /** Zoom um den Punkt cx (px im sichtbaren Ausschnitt); zeichnet nur den Timeline-Inhalt neu */
  private zoomen(el: HTMLElement, anker: string, pph: number, cx: number): void {
    pph = Math.max(2, Math.min(48, Math.round(pph)));
    const sc = el.querySelector<HTMLElement>('.tl-scroll');
    if (pph === this.z.pph || !sc || !this.tlZeitraum) return;
    const t = (sc.scrollLeft + cx) / (SPAN * this.z.pph);
    this.z.pph = pph;
    this.scrollX = t * SPAN * pph - cx;
    el.querySelector<HTMLElement>('.cal-b')!.innerHTML = timelineZeichnen(this.tlZeitraum, pph, H0, H1, MARKIERT);
    const stufe = el.querySelector<HTMLElement>('.zoom-stufe');
    if (stufe) stufe.textContent = zoomStufe(pph);
    const r = el.querySelector<HTMLInputElement>('[data-cal-zoom]');
    if (r && Number(r.value) !== pph) r.value = String(pph);
    this.timelineEinrichten(el, anker);
  }

  private async neu(): Promise<void> { if (this.el) await this.render(this.el, this.dichte); }

  /** Monat im gescrollten Zustand: der Monat, der den Ausschnitt dominiert (Mitte der 6 Wochen) */
  private monatsBezug(anker: string): string { return this.z.ansicht === 'monat' && this.z.frei ? plusTage(montag(anker), 17) : anker; }

  // ---------- Scrollen statt Blättern (Nutzer 20.11.2026) ----------
  // Zeitansichten: waagerecht wischen (oder ⇧ + Mausrad) verschiebt tageweise; Monat: senkrecht wochenweise; 3 Monate: monatsweise.
  private behalteY: number | null = null;
  private wischRest = 0;
  private zeichnet = false;
  private ausstehend = 0;

  private scrollenEinrichten(el: HTMLElement, anker: string): void {
    const a = this.z.ansicht;
    if (a === 'timeline') return;
    const b = el.querySelector<HTMLElement>('.cal-b');
    if (!b) return;
    b.onwheel = ev => {
      const zeit = ZEITANSICHTEN.includes(a);
      let d: number, schritt: number;
      if (zeit) {
        // senkrecht bleibt das Scrollen durch die Stunden
        d = ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX;
        if (!ev.shiftKey && Math.abs(ev.deltaX) <= Math.abs(ev.deltaY)) return;
        const tage = a === 'tag' ? 1 : a === 'tage3' ? 3 : 7;
        const raster = b.querySelector<HTMLElement>('.wk-grid') ?? b;
        schritt = Math.max(40, (raster.clientWidth - 50) / tage);
      } else {
        const box = b.querySelector<HTMLElement>('.months');
        if (box && box.scrollHeight > box.clientHeight + 2) return; // 3 Monate scrollt selbst, wenn es nicht passt
        if (Math.abs(ev.deltaY) < Math.abs(ev.deltaX)) return;
        d = ev.deltaY;
        schritt = a === 'monat' ? Math.max(40, b.clientHeight / 6) : Math.max(80, b.clientHeight / 2);
      }
      ev.preventDefault();
      this.wischRest += d;
      const n = Math.trunc(this.wischRest / schritt);
      if (!n) return;
      this.wischRest -= n * schritt;
      this.verschieben(el, anker, n);
    };
  }

  /** n Schritte vor/zurück: Tage (Zeitansichten), Wochen (Monat) oder Monate (3 Monate) */
  private verschieben(el: HTMLElement, anker: string, n: number): void {
    this.ausstehend += n;
    if (this.zeichnet) return;
    const a = this.z.ansicht;
    const start = this.bereich(this.z.anker ?? anker)[0];
    const k = this.ausstehend; this.ausstehend = 0;
    if (a === 'monate3') { this.z.anker = plusMonate(this.z.anker ?? anker, k); }
    else {
      this.z.frei = a === 'woche' || a === 'monat';
      this.z.anker = plusTage(a === 'monat' ? montag(start) : start, a === 'monat' ? 7 * k : k);
    }
    this.behalteY = el.querySelector<HTMLElement>('.wk-scroll')?.scrollTop ?? null;
    this.zeichnet = true;
    void this.neu().finally(() => {
      this.zeichnet = false;
      if (this.ausstehend) this.verschieben(el, this.z.anker!, 0);
    });
  }
}

const zoomStufe = (pph: number) => (pph < 6 ? 'Wochen' : pph < 20 ? 'Tage' : 'Stunden');

function titel(a: KalAnsicht, anker: string): string {
  if (a === 'tag') return `${WT_LANG[wochentag(anker)]}, ${tagImMonat(anker)}. ${MON_LANG[monat(anker)]}`;
  // Woche: anker = erster Tag; gescrollt beginnt sie nicht am Montag → nur Zeitraum
  if (a === 'woche') { const m = anker; return wochentag(m) === 0 ? `KW ${kw(m)} · ${kurz(m)}–${kurz(plusTage(m, 6))}` : `${WT[wochentag(m)]} ${kurz(m)} – ${WT[wochentag(plusTage(m, 6))]} ${kurz(plusTage(m, 6))}`; }
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
    return `<div class="ev own ${b.aufgabeId ? '' : 'frei'} ${b.abgeschlossen ? 'done' : ''}" draggable="true" data-booking="${b.id}"${b.aufgabeId ? ` data-task="${b.aufgabeId}"` : ''} style="${pos}" title="${esc(tip)}">${herkunft(b)}${esc(b.titel)}${zeit}<span class="zieh" data-zieh="${b.id}" data-dauer="${b.dauer}" title="Ziehen: Dauer ändern"></span></div>`;
  }
  const x = e.x!;
  return `<div class="ev extern ${x.belegt ? 'belegt' : ''}" data-extern="${esc(x.id)}" data-datum="${x.datum}" style="${pos};--kf:${x.farbe}" title="${esc(`${x.titel} · ${uhrzeit(e.s)}–${uhrzeit(e.e)} · ${x.konto} / ${x.kalender}${x.belegt ? ' · belegt Kapazität' : ''}${x.ort ? ' · ' + x.ort : ''}`)}">${esc(x.titel)}${zeit}</div>`;
}

/** kleines Symbol: Aufgabe steht auf dem Board (hat Status) oder nur in der Aufgabenliste; freie Buchungen ohne */
export const herkunft = (b: BuchungDto) => (b.herkunft
  ? `<span class="hk" title="${b.herkunft === 'board' ? 'Aufgabe auf dem Kanban-Board' : 'Aufgabe in der Aufgabenliste'}">${b.herkunft === 'board' ? I.board : I.liste}</span>`
  : '') + spiegelSymbol(b);

/** gespiegelt in Google/iCloud: Link-Symbol in der Farbe des Zielkalenders */
export const spiegelSymbol = (b: BuchungDto) => b.spiegel
  ? `<span class="lk" style="--kf:${b.spiegel.farbe}" title="${esc(`Gespiegelt in ${b.spiegel.kalender}${b.spiegel.konto ? ' · ' + b.spiegel.konto : ''}`)}">${I.spiegel}</span>`
  : '';

export const resHtml = (r: BuchungDto) =>
  `<div class="resv ${r.aufgabeId ? '' : 'frei'} ${r.abgeschlossen ? 'done' : ''}" draggable="true" data-booking="${r.id}"${r.aufgabeId ? ` data-task="${r.aufgabeId}"` : ''} title="${esc(`${r.aufgabeId ? '' : 'Freie '}Reservierung: ${r.titel} · ${dauerText(r.dauer)}${r.belegt ? '' : ' · belegt keine Kapazität'}`)}"><b>${dauerText(r.dauer).replace(' ', '')}</b>${herkunft(r)}<span>${esc(r.titel)}</span></div>`;

const ganztags = (t: Tag) => t.extern.filter(x => x.start === null).map(x => `<div class="ext-ganz" data-extern="${esc(x.id)}" data-datum="${x.datum}" style="background:${x.farbe}" title="${esc(`${x.titel} · ganztägig · ${x.kalender}`)}">${esc(x.titel)}</div>`).join('');

function fristMarke(t: Tag): string {
  if (!t.fristen.length) return '';
  const d = t.fristen[0]!.dringlichkeit;
  const farbe = `var(--d-${d})`;
  // Klick öffnet eine knappe Liste der fälligen Aufgaben (interaktion.ts); die Daten stehen am Element
  const daten = esc(JSON.stringify(t.fristen.map(f => [f.aufgabeId, f.titel, f.dringlichkeit])));
  return `<button type="button" class="fr" style="color:${farbe}" data-fristen="${daten}" data-datum="${t.datum}" title="${t.fristen.length} fällig – klicken für die Liste">${I.frist}${t.fristen.length}</button>`;
}

function woche(z: Zeitraum, tage: Tag[], dichte: Dichte): string {
  const n = tage.length;
  // heute ab 3 Tagen mit dünnem Rahmen um die ganze Spalte (Kopf + Band + Raster)
  const heuteRahmen = (t: Tag) => (n > 1 && t.datum === z.heute ? ' heute-rahmen' : '') + (n > 1 && t.datum === MARKIERT ? ' markiert' : '');
  const kopf = tage.map(t => `<div class="dh ${t.datum === z.heute ? 'today' : ''} ${wochentag(t.datum) > 4 ? 'we' : ''}${heuteRahmen(t)}" data-day="${t.datum}" data-markier="${t.datum}" title="Klick: Tag markieren"><span class="wd">${n === 1 ? WT_LANG[wochentag(t.datum)] : WT[wochentag(t.datum)]}</span><span class="dn">${tagImMonat(t.datum)}</span>${fristMarke(t)}</div>`).join('');
  const band = tage.map(t => `<div class="rb${heuteRahmen(t)}" data-drop-res="${t.datum}">${ganztags(t)}${t.reservierungen.map(resHtml).join('')}${kapazitaetsBalken(t.auslastung)}</div>`).join('');
  let stunden = '';
  // auch erste und letzte Stunde beschriften: oben unter, unten über die Randlinie gesetzt
  for (let h = H0; h <= H1; h++) stunden += `<span class="${h === H0 ? 'erst' : h === H1 ? 'letzt' : ''}" style="top:${((h - H0) / SPAN) * 100}%">${h}</span>`;
  const spalten = tage.map(t => {
    const jetzt = t.datum === z.heute && z.jetzt >= H0 * 60 && z.jetzt <= H1 * 60 ? `<div class="nowline" style="top:${pct(z.jetzt)}%"></div>` : '';
    // Stunden außerhalb der eingestellten Tageszeit dezent schraffiert
    const davor = KERN.von > H0 ? `<div class="ausserhalb" style="top:0;height:${pct(KERN.von * 60)}%"></div>` : '';
    const danach = KERN.bis < H1 ? `<div class="ausserhalb" style="top:${pct(KERN.bis * 60)}%;bottom:0"></div>` : '';
    return `<div class="dcol ${wochentag(t.datum) > 4 ? 'we' : ''}${heuteRahmen(t)}" data-drop-day="${t.datum}">${davor}${danach}${ereignisse(t).map(e => evHtml(e, dichte)).join('')}${jetzt}</div>`;
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
    <div class="ds-hinweis">${I.plus}<span>Aufgabe hierher in den Kalender ziehen: Termin.<br>Doppelklick ins Raster oder Reservierungsband (im Monat: in die freie Fläche eines Tages): Buchung ohne Aufgabe.</span></div>
  </div>`;
}

/** Monatsansicht: je Tag alle Einträge untereinander über die volle Breite (ganztägig, Reservierungen,
 *  Termine nach Uhrzeit); links ein schmaler Streifen mit Punkten, wo im Tagesverlauf Termine liegen;
 *  unten die Auslastung. */
function monatsRaster(z: Zeitraum, tage: Tag[], anker: string, dichte: Dichte): string {
  const m = monat(anker);
  const zellen = tage.slice(0, 42).map(t => {
    const ev = ereignisse(t).sort((a, b) => a.s - b.s);
    const farbe = (e: Ev) => (e.b ? (e.b.aufgabeId ? 'var(--own)' : 'var(--free)') : e.x!.farbe);
    const punkte = ev.map(e => `<i style="top:${Math.min(100, Math.max(0, pct(e.s)))}%;background:${farbe(e)}" title="${esc(`${uhrzeit(e.s)} ${e.titel}`)}"></i>`).join('');
    const eintraege = [
      ...t.extern.filter(x => x.start === null).map(x => `<div class="me ganz" data-extern="${esc(x.id)}" data-datum="${x.datum}" style="--kf:${x.farbe}" title="${esc(`${x.titel} · ganztägig · ${x.kalender}`)}"><span class="tt">${esc(x.titel)}</span></div>`),
      ...t.reservierungen.map(r => `<div class="me res ${r.aufgabeId ? '' : 'frei'} ${r.abgeschlossen ? 'done' : ''}" draggable="true" data-booking="${r.id}"${r.aufgabeId ? ` data-task="${r.aufgabeId}"` : ''} title="${esc(`Reservierung ${dauerText(r.dauer)}: ${r.titel}`)}"><span class="zt">${dauerText(r.dauer).replace(' ', '')}</span>${herkunft(r)}<span class="tt">${esc(r.titel)}</span></div>`),
      ...ev.map(e => e.b
        ? `<div class="me term ${e.b.aufgabeId ? 'own' : 'frei'} ${e.b.abgeschlossen ? 'done' : ''}" draggable="true" data-booking="${e.b.id}"${e.b.aufgabeId ? ` data-task="${e.b.aufgabeId}"` : ''} style="--kf:${farbe(e)}" title="${esc(`${uhrzeit(e.s)}–${uhrzeit(e.e)} ${e.titel}`)}"><span class="zt">${uhrzeit(e.s)}</span>${herkunft(e.b)}<span class="tt">${esc(e.titel)}</span></div>`
        : `<div class="me term extern" data-extern="${esc(e.x!.id)}" data-datum="${e.x!.datum}" style="--kf:${e.x!.farbe}" title="${esc(`${uhrzeit(e.s)}–${uhrzeit(e.e)} ${e.titel} · ${e.x!.kalender}`)}"><span class="zt">${uhrzeit(e.s)}</span><span class="tt">${esc(e.titel)}</span></div>`),
    ];
    // alle Einträge – wie viele in die Zelle passen, misst monatEinpassen() nach dem Zeichnen
    const liste = eintraege.join('');
    const anders = monat(t.datum) !== m;
    return `<div class="mc ${anders ? 'other' : ''} ${t.datum === z.heute ? 'today' : ''} ${t.datum === MARKIERT ? 'markiert' : ''} ${wochentag(t.datum) > 4 ? 'we' : ''}" data-drop-res="${t.datum}" data-day="${t.datum}" data-markier="${t.datum}" title="Klick: Tag markieren · Doppelklick: Buchung ohne Aufgabe eintragen">
      <div class="mh" title="Doppelklick: Tag öffnen"><span class="dn">${tagImMonat(t.datum)}</span>${fristMarke(t)}</div>
      <div class="mb"><div class="mpunkte" title="Termine im Tagesverlauf (${H0}–${H1} Uhr)">${punkte}</div><div class="mliste">${liste}</div></div>${kapazitaetsBalken(t.auslastung)}</div>`;
  }).join('');
  return `<div class="mo ${dichte}"><div class="mo-h">${WT.map(w => `<div>${w}</div>`).join('')}</div><div class="mo-g">${zellen}</div></div>`;
}

/**
 * Monatszellen: Passen nicht alle Einträge in die Zelle, werden die letzten ausgeblendet und durch
 * „+n weitere“ ersetzt (Doppelklick öffnet den Tag). Gemessen wird nach dem Zeichnen, weil die
 * Zellhöhe vom Platz in der Rasterzelle abhängt.
 */
export function monatEinpassen(el: HTMLElement): void {
  el.querySelectorAll<HTMLElement>('.mc .mliste').forEach(liste => {
    liste.querySelector('.me.mehr')?.remove();
    const eintraege = [...liste.querySelectorAll<HTMLElement>(':scope > .me')];
    eintraege.forEach(e => { e.style.display = ''; });
    if (liste.scrollHeight <= liste.clientHeight + 1) return;
    const mehr = document.createElement('div');
    mehr.className = 'me mehr';
    mehr.title = 'Doppelklick: Tag öffnen';
    liste.appendChild(mehr);
    let versteckt = 0;
    // der erste Eintrag bleibt immer sichtbar (sonst stünde nur „+n“ in der Zelle)
    for (let i = eintraege.length - 1; i >= 1 && liste.scrollHeight > liste.clientHeight + 1; i--) {
      eintraege[i]!.style.display = 'none';
      versteckt++;
      mehr.textContent = `+${versteckt} weitere`;
    }
    mehr.textContent = `+${versteckt} weitere`;
  });
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
