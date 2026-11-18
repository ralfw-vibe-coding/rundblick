// Timeline: horizontal, zoombar – bewusst dezent, ohne Schrift im Verlauf.
//   Kopf: KW, Tage (Klick markiert) mit Auslastungsbalken wie im Kalender, bei großem Zoom Stunden.
//   Symbolzeile: Punktuelles – Frist (Raute), Wiedervorlage, Reservierung.
//   Strichzeile: Termine als Striche von Beginn bis Ende, bei Überlappung gestaffelt (eigene + externe).
//   Überfahren → Tooltip; Klick → Info-Fenster; nochmal klicken (auf Eintrag oder Fenster) → Schublade.
//   Markierter Tag → darunter Leitlinien von jedem Eintrag zu einer Beschriftung mit Details.
import { dauerText, differenz, kurz, kw, monat, relativ, tagImMonat, uhrzeit, WT, WT_LANG, wochentag } from '../../../basis/datum';
import type { BuchungDto, ExternDto, Tag, Zeitraum } from '../../../body/interface';
import { kapazitaetsBalken } from '../bausteine';
import { aufgabeOeffnen, buchungOeffnen, externOeffnen } from '../detail';
import { esc } from '../dom';
import { I } from '../icons';

type Oeffnen = { art: 'aufgabe'; id: string } | { art: 'buchung'; id: string } | { art: 'extern'; id: string; datum: string };
type Eintrag = {
  key: string; datum: string;
  /** Lage im Inhalt (px): Mitte bzw. Beginn des Elements */
  x: number; y: number;
  symbol: string; farbe: string;
  titel: string; zeile: string; info: string[];
  oeffnen: Oeffnen | null;
  /** zugehörige Aufgabe einer Buchung (für Ziehen auf Liste/Board und Hervorhebung) */
  aufgabe?: string | null;
  /** nur Striche: Breite in px; bahn = gestaffelte Zeile (Symbole: -1) */
  breite?: number; bahn?: number;
};

const SYM = 16, SYM_ABSTAND = 15, STRICH = 8, STRICH_ABSTAND = 12, ZEILE = 20;
let EINTRAEGE = new Map<string, Eintrag>();

/** Breite einer Beschriftung in px (gemessen mit der Schrift der Oberfläche) */
const LABEL_MAX = 300;
let messer: CanvasRenderingContext2D | null = null;
function labelBreite(text: string, mitSymbol: boolean): number {
  messer ??= document.createElement('canvas').getContext('2d');
  if (messer) messer.font = '11px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif';
  const t = messer ? messer.measureText(text).width : text.length * 6;
  return Math.ceil(t) + 3 + 7 + 6 + (mitSymbol ? 15 : 0); // Rand links + Polster + Symbol
}

const herkunftText = (b: BuchungDto) => (b.herkunft === 'board' ? 'Aufgabe auf dem Kanban-Board' : b.herkunft === 'liste' ? 'Aufgabe in der Aufgabenliste' : 'Buchung ohne Aufgabe');
const herkunftSym = (b: BuchungDto) => (b.herkunft === 'board' ? I.board : b.herkunft === 'liste' ? I.liste : '');

/** gestaffelte Bahnen für überlappende Zeiträume */
function bahnen<T extends { s: number; e: number }>(xs: T[]): (T & { bahn: number })[] {
  const enden: number[] = [];
  return [...xs].sort((a, b) => a.s - b.s || b.e - a.e).map(x => {
    let i = enden.findIndex(e => e <= x.s);
    if (i < 0) { i = enden.length; enden.push(0); }
    enden[i] = x.e;
    return { ...x, bahn: i };
  });
}

export function timelineZeichnen(z: Zeitraum, pph: number, h0: number, h1: number, markiert: string | null): string {
  const span = h1 - h0, dayW = span * pph, N = z.tage.length, start = z.tage[0]!.datum;
  const xMin = (i: number, min: number) => i * dayW + ((Math.min(Math.max(min, h0 * 60), h1 * 60) - h0 * 60) / 60) * pph;
  EINTRAEGE = new Map();
  let kwZeile = '', tagZeile = '', stdZeile = '', hg = '', treffer = '';
  let symbole = '', striche = '';
  let symZeilen = 1, strichBahnen = 1;
  const proZeile = Math.max(1, Math.floor((dayW - 6) / SYM_ABSTAND));

  // Pass 1: Symbole und Striche je Tag (y innerhalb ihrer Zeile; Versatz kommt nach dem Messen)
  const roh: Eintrag[] = [];
  z.tage.forEach((t, i) => {
    const links = i * dayW, wd = wochentag(t.datum);
    if (wd === 0) kwZeile += `<span style="left:${links}px">KW ${kw(t.datum)} · ${kurz(t.datum)}</span>`;
    if (wd > 4) hg += `<div class="we" style="left:${links}px;width:${dayW}px"></div>`;
    hg += `<div class="dl" style="left:${links}px"></div>`;
    if (t.datum === markiert) hg += `<div class="tl-markiert" style="left:${links}px;width:${dayW}px"></div>`;
    const name = dayW >= 80 ? `${WT[wd]} ${tagImMonat(t.datum)}.${monat(t.datum) + 1}.` : dayW >= 34 ? `${tagImMonat(t.datum)}` : '';
    tagZeile += `<span class="tl2-tag ${t.datum === z.heute ? 'today' : ''} ${t.datum === markiert ? 'mk markiert' : ''}" data-markier="${t.datum}" title="${esc(`${WT_LANG[wd]}, ${kurz(t.datum)} – Klick: Details darunter zeigen`)}" style="left:${links}px;width:${dayW}px"><span class="nm">${name}</span>${kapazitaetsBalken(t.auslastung)}</span>`;
    if (pph >= 22) for (let h = h0 + 1; h < h1; h += pph >= 40 ? 1 : 2) stdZeile += `<span style="left:${links + (h - h0) * pph}px">${h}</span>`;
    // Trefferflächen je Tag (Klick markiert den Tag)
    treffer += `<div class="tl2-flaeche" data-markier="${t.datum}" title="Klick: Details zu diesem Tag zeigen" style="left:${links}px;width:${dayW}px"></div>`;

    // ---- Punktuelles: Fristen, Wiedervorlagen, Reservierungen
    const punkte: Omit<Eintrag, 'x' | 'y' | 'key' | 'datum'>[] = [
      ...t.fristen.map(f => ({
        symbol: I.frist, farbe: `var(--d-${f.dringlichkeit})`, titel: f.titel, zeile: `Frist · ${f.titel}`,
        info: [`Frist ${relativ(t.datum, z.heute)} (${kurz(t.datum)})`, (({ ueberfaellig: 'überfällig', heute: 'heute fällig', bald: 'bald fällig', woche: 'diese Woche fällig' } as Record<string, string>)[f.dringlichkeit] ?? '')].filter(x => x),
        oeffnen: { art: 'aufgabe' as const, id: f.aufgabeId },
      })),
      ...t.wiedervorlagen.map(w => ({
        symbol: I.wiedervorlage, farbe: '#64748b', titel: w.titel, zeile: `Wiedervorlage · ${w.titel}`,
        info: [`Taucht ${relativ(t.datum, z.heute).toLowerCase()} wieder auf`], oeffnen: { art: 'aufgabe' as const, id: w.aufgabeId },
      })),
      ...t.reservierungen.map(r => ({
        symbol: I.reservierung, farbe: r.aufgabeId ? 'var(--own)' : 'var(--free)', titel: r.titel,
        zeile: `${dauerText(r.dauer)} reserviert · ${r.titel}`,
        info: [`Reservierung ${dauerText(r.dauer)} (ohne Uhrzeit)`, herkunftText(r), ...(r.aufgabentitel && r.aufgabentitel !== r.titel ? [`Aufgabe: ${r.aufgabentitel}`] : []), ...(r.belegt ? [] : ['belegt keine Kapazität'])],
        oeffnen: { art: 'buchung' as const, id: r.id }, aufgabe: r.aufgabeId,
      })),
    ];
    punkte.forEach((p, k) => {
      const zeileNr = Math.floor(k / proZeile), spalte = k % proZeile;
      symZeilen = Math.max(symZeilen, zeileNr + 1);
      roh.push({ ...p, key: `p${i}-${k}`, datum: t.datum, x: links + 4 + spalte * SYM_ABSTAND + SYM / 2, y: 3 + zeileNr * (SYM + 2) + SYM / 2 });
    });

    // ---- Termine (eigene und externe) als Striche, gestaffelt
    type T = { s: number; e: number; b?: BuchungDto & { s: number; e: number }; x?: ExternDto };
    const termine: T[] = [
      ...t.termine.map(b => ({ s: b.s, e: b.e, b })),
      ...t.extern.filter(x => x.start !== null).map(x => ({ s: x.start!, e: Math.max(x.ende!, x.start! + 15), x })),
    ];
    bahnen(termine).forEach((m, k) => {
      strichBahnen = Math.max(strichBahnen, m.bahn + 1);
      const x0 = xMin(i, m.s), x1 = Math.max(x0 + 3, xMin(i, m.e) - 1);
      const zeit = `${uhrzeit(m.s)}–${uhrzeit(m.e)}`;
      const e: Eintrag = m.b
        ? {
            key: `t${i}-${k}`, datum: t.datum, x: x0, y: 0, symbol: herkunftSym(m.b), farbe: m.b.aufgabeId ? 'var(--own)' : 'var(--free)',
            titel: m.b.titel, zeile: `${zeit} · ${m.b.titel}`,
            info: [`Termin ${zeit} (${dauerText(m.b.dauer)})`, herkunftText(m.b), ...(m.b.aufgabentitel && m.b.aufgabentitel !== m.b.titel ? [`Aufgabe: ${m.b.aufgabentitel}`] : []), ...(m.b.belegt ? [] : ['belegt keine Kapazität'])],
            oeffnen: { art: 'buchung', id: m.b.id }, aufgabe: m.b.aufgabeId,
          }
        : {
            key: `t${i}-${k}`, datum: t.datum, x: x0, y: 0, symbol: '', farbe: m.x!.farbe,
            titel: m.x!.titel, zeile: `${zeit} · ${m.x!.titel}`,
            info: [`Termin ${zeit}`, `${m.x!.konto} / ${m.x!.kalender}`, ...(m.x!.ort ? [m.x!.ort] : []), ...(m.x!.belegt ? ['belegt Kapazität'] : [])],
            oeffnen: { art: 'extern', id: m.x!.id, datum: m.x!.datum },
          };
      roh.push({ ...e, breite: x1 - x0, bahn: m.bahn });
    });
  });

  // Pass 2: Höhen festlegen und Elemente zeichnen
  const hSym = 6 + symZeilen * (SYM + 2), hStrich = 10 + strichBahnen * STRICH_ABSTAND;
  const yStrich = (bahn: number) => hSym + 6 + bahn * STRICH_ABSTAND;
  for (const e of roh) {
    const daten = zugDaten(e);
    const tip = esc([e.titel, ...e.info].join('\n'));
    if (e.bahn === undefined) {
      symbole += `<span class="tl2-sym ${e.zeile.startsWith('Frist') ? 'frist' : ''}" data-tl="${e.key}"${daten} title="${tip}" style="left:${e.x - SYM / 2}px;top:${e.y - SYM / 2}px;color:${e.farbe}">${e.key.startsWith('p') ? symbolFuer(e) : ''}</span>`;
    } else {
      e.y = yStrich(e.bahn) + STRICH / 2;
      striche += `<span class="tl2-strich" data-tl="${e.key}"${daten} title="${tip}" style="left:${e.x}px;top:${yStrich(e.bahn) - hSym}px;width:${e.breite}px;background:${e.farbe}"></span>`;
    }
    EINTRAEGE.set(e.key, e);
  }

  // Beschriftungen für alle Tage (dauerhaft): unter der Strichzeile, je Eintrag ab seiner Lage nach rechts.
  // Sie dürfen in den nächsten Tag ragen; was sich in einer Zeile überlappen würde, rutscht eine Zeile tiefer.
  // Bei sehr kleinem Zoom (Tage schmaler als 90 px) nur für den markierten Tag.
  let details = '', hDetails = 0;
  const alle = dayW >= 90;
  const liste = [...EINTRAEGE.values()].filter(e => alle || e.datum === markiert).sort((a, b) => a.x - b.x || a.y - b.y);
  if (liste.length) {
    const oben = hSym + hStrich;
    const zeilenEnde: number[] = [];
    const teile = liste.map(e => {
      const breite = Math.min(LABEL_MAX, labelBreite(e.zeile, !!e.symbol));
      let zeile = zeilenEnde.findIndex(ende => ende + 6 <= e.x);
      if (zeile < 0) { zeile = zeilenEnde.length; zeilenEnde.push(0); }
      zeilenEnde[zeile] = e.x + breite;
      const yLabel = oben + 12 + zeile * ZEILE + ZEILE / 2;
      return `<span class="tl2-leit" style="left:${e.x}px;top:${e.y}px;height:${yLabel - e.y}px;border-color:${e.farbe}"></span>`
        + `<span class="tl2-label" data-tl="${e.key}"${zugDaten(e)} title="${esc(e.zeile)}" style="left:${e.x}px;max-width:${LABEL_MAX}px;top:${yLabel - 9}px;--lf:${e.farbe}">${e.symbol ? `<span class="sy">${e.symbol}</span>` : ''}<span class="tx">${esc(e.zeile)}</span></span>`;
    });
    hDetails = 12 + zeilenEnde.length * ZEILE + 8;
    details = teile.join('');
  }

  const iHeute = differenz(start, z.heute);
  const jetzt = iHeute >= 0 && iHeute < N ? `<div class="tl-now" style="left:${xMin(iHeute, z.jetzt)}px"></div>` : '';
  return `<div class="tl tl2"><div class="tl-scroll"><div class="tl-inner" style="width:${N * dayW}px">
    <div class="tl-head"><div class="r top">${kwZeile}</div><div class="r tage">${tagZeile}</div>${stdZeile ? `<div class="r hrs">${stdZeile}</div>` : ''}</div>
    <div class="tl2-koerper" style="height:${hSym + hStrich + hDetails}px">
      <div class="tl-bg">${hg}</div>
      <div class="tl2-zone sym" data-drop-tl="res" style="top:0;height:${hSym}px">${treffer}${symbole}</div>
      <div class="tl2-zone str" data-drop-tl="termin" style="top:${hSym}px;height:${hStrich}px">${treffer}${striche}</div>
      ${details}${jetzt}
    </div></div></div></div>`;
}

/** Attribute zum Ziehen (global in interaktion.ts): Buchung samt Aufgabe bzw. Aufgabe (Frist, Wiedervorlage).
 *  Gilt für Symbol, Strich und Beschriftung gleichermaßen. Externe Termine lassen sich nicht ziehen. */
function zugDaten(e: Eintrag): string {
  if (e.oeffnen?.art === 'buchung') return ` draggable="true" data-booking="${e.oeffnen.id}"${e.aufgabe ? ` data-task="${e.aufgabe}"` : ''}`;
  if (e.oeffnen?.art === 'aufgabe') return ` draggable="true" data-task="${e.oeffnen.id}"`;
  return '';
}

function symbolFuer(e: Eintrag): string {
  if (e.zeile.startsWith('Frist')) return I.frist;
  if (e.zeile.startsWith('Wiedervorlage')) return I.wiedervorlage;
  return I.reservierung;
}

// ---------- Klick: Info-Fenster; nochmal klicken → Schublade ----------
let fenster: HTMLDivElement | null = null;
/** zu welchem Eintrag das offene Info-Fenster gehört (zweiter Klick darauf öffnet die Schublade) */
let fensterFuer: string | null = null;
function fensterZu(): void { fenster?.remove(); fenster = null; fensterFuer = null; }
addEventListener('keydown', e => { if (e.key === 'Escape') fensterZu(); });
addEventListener('mousedown', e => { if (fenster && !(e.target as HTMLElement).closest('.tl2-info, [data-tl]')) fensterZu(); });

function oeffnen(o: Oeffnen): void {
  if (o.art === 'aufgabe') void aufgabeOeffnen(o.id);
  else if (o.art === 'buchung') void buchungOeffnen(o.id);
  else void externOeffnen(o.id, o.datum);
}

/** an die Timeline-Fläche binden (einmal je Zeichnung) */
export function timelineBinden(el: HTMLElement): void {
  const tl = el.querySelector<HTMLElement>('.tl2');
  if (!tl) return;
  tl.addEventListener('click', ev => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-tl]');
    if (!t) return;
    ev.stopPropagation();
    const e = EINTRAEGE.get(t.dataset.tl!);
    if (!e) return;
    // Beschriftung unter dem markierten Tag: direkt öffnen; Symbol/Strich: erst Info-Fenster
    if (t.classList.contains('tl2-label')) { if (e.oeffnen) oeffnen(e.oeffnen); return; }
    // zweiter Klick auf denselben Eintrag → Details
    if (fensterFuer === e.key && e.oeffnen) { const o = e.oeffnen; fensterZu(); oeffnen(o); return; }
    fensterZu();
    fensterFuer = e.key;
    fenster = document.createElement('div');
    fenster.className = 'pop tl2-info';
    fenster.innerHTML = `<div class="kopf"><span class="sy" style="color:${e.farbe}">${e.symbol || '<span class="punkt" style="background:' + e.farbe + '"></span>'}</span><b>${esc(e.titel)}</b></div>
      ${e.info.map(z => `<div class="z">${esc(z)}</div>`).join('')}
      ${e.oeffnen ? '<div class="hinweis-klick">Klick: Details</div>' : ''}`;
    if (e.oeffnen) { fenster.classList.add('klickbar'); fenster.title = 'Klick: Details öffnen'; }
    document.body.appendChild(fenster);
    const r = t.getBoundingClientRect();
    fenster.style.left = `${Math.min(r.left, innerWidth - 300)}px`;
    fenster.style.top = `${Math.min(r.bottom + 6, innerHeight - fenster.offsetHeight - 8)}px`;
    fenster.addEventListener('click', () => { if (!e.oeffnen) return; const o = e.oeffnen; fensterZu(); oeffnen(o); });
  }, true);
}
