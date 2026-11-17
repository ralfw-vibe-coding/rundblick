// HTML-Bausteine für Aufgaben (Zeile, Karte, Fristen, Buchungssymbole) aus den DTOs des Body.
import { dauerText, kurz, relativ, WT, wochentag } from '../../basis/datum';
import type { AufgabeZeile, Auslastung, BuchungDto, Dringlichkeit } from '../../body/interface';
import { esc } from './dom';
import { I } from './icons';

const DRING: Record<Dringlichkeit, string> = { ueberfaellig: 'd-ueberfaellig', heute: 'd-heute', woche: 'd-woche', spaeter: 'd-spaeter' };
export const dringKlasse = (d: Dringlichkeit | null) => (d ? DRING[d] : '');

export function frist(a: AufgabeZeile, heute: string): string {
  return a.frist ? `<span class="due ${dringKlasse(a.dringlichkeit)}" title="Frist ${WT[wochentag(a.frist)]} ${kurz(a.frist)}">${I.frist}${relativ(a.frist, heute)}</span>` : '';
}

export function buchungsSymbole(a: AufgabeZeile): string {
  const { reservierungen: r, termine: t, gebucht: g } = a.buchungen;
  if (!r && !t) return '';
  return `<span class="bk" title="${r} Reservierung(en), ${t} Termin(e) · gebucht ${dauerText(g)}">${r ? `<span class="bk-i" title="Reservierungen">${I.reservierung}<b>${r}</b></span>` : ''}${t ? `<span class="bk-i" title="Termine">${I.termin}<b>${t}</b></span>` : ''}${g ? `<span class="bkh">${dauerText(g).replace(' ', '')}</span>` : ''}</span>`;
}

export const tagsChips = (a: AufgabeZeile) => a.tags.map(t => `<span class="chip tag">#${esc(t)}</span>`).join('');
export const personChip = (a: AufgabeZeile) => (a.verantwortlich ? `<span class="chip person">@${esc(a.verantwortlich)}</span>` : '');
export const ortChip = (a: AufgabeZeile) => (a.ort ? `<span class="chip ort">${I.ort}${esc(a.ort)}</span>` : '');
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

export const ICON = { muell: I.muell, archiv: I.archiv, ausArchiv: I.ausArchiv, zu: I.x };

/** Mülleimer nach dem Zwei-Klick-Muster: 1. Klick → „?“, 2. Klick → Aktion; sonst nach 5 s zurück */
export const muellKnopf = (act: string, titel: string, id?: string) => `<button class="muell" data-zweistufig="${act}"${id ? ` data-id="${esc(id)}"` : ''} title="${esc(titel)}">${ICON.muell}</button>`;

export function zeile(a: AufgabeZeile, heute: string, voll: boolean, frisch = false, gewaehlt = false): string {
  const cls = ['row', a.abgeschlossen ? 'done' : '', a.zurueckgestellt ? 'deferred' : '', frisch ? 'frisch' : '', gewaehlt ? 'gewaehlt' : ''].join(' ');
  const rechts = voll
    ? `${buchungsSymbole(a)}${a.status ? `<span class="chip">${statusPunkt(a.status.id)}${esc(a.status.name)}</span>` : ''}${a.zurueckgestellt && a.wiedervorlage ? `<span class="chip wv">${I.wiedervorlage}${kurz(a.wiedervorlage)}</span>` : ''}`
    : `${buchungsSymbole(a)}${a.status ? `<span title="${esc(a.status.name)}">${statusPunkt(a.status.id)}</span>` : ''}`;
  return `<div class="${cls}" draggable="true" data-task="${a.id}">
    <button class="chk" data-act="${a.abgeschlossen ? 'wiederoeffnen' : 'abschliessen'}" title="${a.abgeschlossen ? 'Wieder öffnen' : 'Abschließen'}">${a.abgeschlossen ? I.erledigt : I.offen}</button>
    <div class="main"><div class="t"><span class="tt">${esc(a.titel)}</span>${frist(a, heute)}</div>${voll && (a.tags.length || a.verantwortlich || a.ort) ? `<div class="meta">${tagsChips(a)}${personChip(a)}${ortChip(a)}</div>` : ''}</div>
    <div class="right">${rechts}${a.archiviert ? '' : muellKnopf('verwerfen', 'Aufgabe verwerfen')}</div></div>`;
}

export function karte(a: AufgabeZeile, heute: string, voll: boolean, mitStatus: boolean, gewaehlt = false): string {
  const beendet = a.status?.kategorie === 'beendet';
  const knopf = a.abgeschlossen
    ? `<span class="closed-badge">${I.haken}abgeschlossen</span><button class="done-btn" data-act="wiederoeffnen" title="Wieder öffnen" style="color:var(--mute)">${I.zuruecksetzen}</button>`
    : beendet ? `<button class="done-btn" data-act="abschliessen" title="Abschließen – eigener Zustand, unabhängig von der Spalte">${I.haken}abschließen</button>` : '';
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
