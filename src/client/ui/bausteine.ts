// HTML-Bausteine für Aufgaben (Zeile, Karte, Fristen, Buchungssymbole) aus den DTOs des Body.
import { dauerText, kurz, relativ, WT, wochentag } from '../../basis/datum';
import type { AufgabeZeile, Auslastung, BuchungDto, Dringlichkeit } from '../../body/interface';
import { esc } from './dom';

const DRING: Record<Dringlichkeit, string> = { ueberfaellig: 'd-ueberfaellig', heute: 'd-heute', woche: 'd-woche', spaeter: 'd-spaeter' };
export const dringKlasse = (d: Dringlichkeit | null) => (d ? DRING[d] : '');

export function frist(a: AufgabeZeile, heute: string): string {
  return a.frist ? `<span class="due ${dringKlasse(a.dringlichkeit)}" title="Frist ${WT[wochentag(a.frist)]} ${kurz(a.frist)}">◆ ${relativ(a.frist, heute)}</span>` : '';
}

export function buchungsSymbole(a: AufgabeZeile): string {
  const { reservierungen: r, termine: t, gebucht: g } = a.buchungen;
  if (!r && !t) return '';
  return `<span class="bk" title="${r} Reservierung(en), ${t} Termin(e) · gebucht ${dauerText(g)}">${r ? `<i class="ic-res"></i><b>${r}</b>` : ''}${t ? `<i class="ic-term"></i><b>${t}</b>` : ''}${g ? `<span class="bkh">${dauerText(g).replace(' ', '')}</span>` : ''}</span>`;
}

export const tagsChips = (a: AufgabeZeile) => a.tags.map(t => `<span class="chip tag">#${esc(t)}</span>`).join('');
export const personChip = (a: AufgabeZeile) => (a.verantwortlich ? `<span class="chip person">@${esc(a.verantwortlich)}</span>` : '');
export const ortChip = (a: AufgabeZeile) => (a.ort ? `<span class="chip ort">⌖ ${esc(a.ort)}</span>` : '');
export const avatar = (a: AufgabeZeile) => (a.verantwortlich ? `<span class="avatar" title="${esc(a.verantwortlich)}">${esc(a.verantwortlich[0]!.toUpperCase())}</span>` : '');
export const statusPunkt = (id: string) => `<span class="sdot" style="background:${statusFarbe(id)}"></span>`;

/** Farbe einer Spalte: fest für die Standardspalten, sonst aus der Kategorie abgeleitet */
const FARBEN: Record<string, string> = {
  idee: '#c4b5a5', backlog: '#94a3b8', bereit: '#475569', inarbeit: '#d97706', blockiert: '#e11d48', erledigt: '#16a34a', abgebrochen: '#a8a29e',
};
let katVon: Record<string, string> = {};
export function spaltenKategorien(m: Record<string, string>): void { katVon = m; }
export function statusFarbe(id: string): string {
  return FARBEN[id] ?? ({ nichtBegonnen: '#94a3b8', begonnen: '#d97706', beendet: '#16a34a' } as Record<string, string>)[katVon[id] ?? ''] ?? '#94a3b8';
}

export const ICON = {
  muell: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.2c.05.7.6 1.3 1.3 1.3h4c.7 0 1.25-.6 1.3-1.3L12 4M6.8 7v5M9.2 7v5"/></svg>',
  archiv: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="3.5" rx="1"/><path d="M2.5 6v6.5c0 .6.4 1 1 1h9c.6 0 1-.4 1-1V6M6.5 8.5h3"/></svg>',
  ausArchiv: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="3.5" rx="1"/><path d="M2.5 6v6.5c0 .6.4 1 1 1h9c.6 0 1-.4 1-1V6M8 12V8M6.3 9.7 8 8l1.7 1.7"/></svg>',
  zu: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

/** Mülleimer nach dem Zwei-Klick-Muster: 1. Klick → „?“, 2. Klick → Aktion; sonst nach 5 s zurück */
export const muellKnopf = (act: string, titel: string, id?: string) => `<button class="muell" data-zweistufig="${act}"${id ? ` data-id="${esc(id)}"` : ''} title="${esc(titel)}">${ICON.muell}</button>`;

export function zeile(a: AufgabeZeile, heute: string, voll: boolean, frisch = false, gewaehlt = false): string {
  const cls = ['row', a.abgeschlossen ? 'done' : '', a.zurueckgestellt ? 'deferred' : '', frisch ? 'frisch' : '', gewaehlt ? 'gewaehlt' : ''].join(' ');
  const rechts = voll
    ? `${buchungsSymbole(a)}${a.status ? `<span class="chip">${statusPunkt(a.status.id)}${esc(a.status.name)}</span>` : ''}${a.zurueckgestellt && a.wiedervorlage ? `<span class="chip wv">↩ ${kurz(a.wiedervorlage)}</span>` : ''}`
    : `${buchungsSymbole(a)}${a.status ? `<span title="${esc(a.status.name)}">${statusPunkt(a.status.id)}</span>` : ''}`;
  return `<div class="${cls}" draggable="true" data-task="${a.id}">
    <button class="chk" data-act="${a.abgeschlossen ? 'wiederoeffnen' : 'abschliessen'}" title="${a.abgeschlossen ? 'Wieder öffnen' : 'Abschließen'}"></button>
    <div class="main"><div class="t"><span class="tt">${esc(a.titel)}</span>${frist(a, heute)}</div>${voll && (a.tags.length || a.verantwortlich || a.ort) ? `<div class="meta">${tagsChips(a)}${personChip(a)}${ortChip(a)}</div>` : ''}</div>
    <div class="right">${rechts}${a.archiviert ? '' : muellKnopf('verwerfen', 'Aufgabe verwerfen')}</div></div>`;
}

export function karte(a: AufgabeZeile, heute: string, voll: boolean, mitStatus: boolean, gewaehlt = false): string {
  const beendet = a.status?.kategorie === 'beendet';
  const knopf = a.abgeschlossen
    ? `<span class="closed-badge">✓ abgeschlossen</span><button class="done-btn" data-act="wiederoeffnen" title="Wieder öffnen" style="color:var(--mute)">↺</button>`
    : beendet ? `<button class="done-btn" data-act="abschliessen" title="Abschließen – eigener Zustand, unabhängig von der Spalte">✓ abschließen</button>` : '';
  return `<div class="card ${beendet ? 'ended' : ''} ${a.abgeschlossen ? 'closed' : ''} ${gewaehlt ? 'gewaehlt' : ''}" draggable="true" data-task="${a.id}">
    <div class="t">${esc(a.titel)}</div>
    <div class="meta">${mitStatus && a.status ? `<span class="chip">${statusPunkt(a.status.id)}${esc(a.status.name)}</span>` : ''}${frist(a, heute)}${buchungsSymbole(a)}${voll ? tagsChips(a) : ''}${knopf}${avatar(a)}</div>
  </div>`;
}

export function kapazitaetsBalken(x: Auslastung, gross = false): string {
  const p = x.kapazitaet ? x.belegt / x.kapazitaet : x.belegt ? 2 : 0;
  const tip = `${dauerText(x.belegt)} von ${dauerText(x.kapazitaet)} belegt${p > 1 ? ' – überbucht!' : ''}\n· eigene Buchungen: ${dauerText(x.eigene)}\n· externe Kalender: ${dauerText(x.extern)}${x.nichtBelegend ? `\n(nicht belegend: ${dauerText(x.nichtBelegend)})` : ''}`;
  return `<div class="cap ${p > 1 ? 'overbooked' : p > 0.8 ? 'full' : ''} ${x.kapazitaet ? '' : 'nocap'}" title="${esc(tip)}"${gross ? ' style="height:6px;margin-top:4px"' : ''}><i style="width:${Math.min(100, p * 100)}%"></i></div>`;
}

export function buchungArt(b: BuchungDto): string { return b.start ? 'Termin' : 'Reservierung'; }
