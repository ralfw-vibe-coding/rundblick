// Auswahl eines externen Kalenders: nach Quelle gruppiert (Google zuerst), darin alphabetisch, mit Kalenderfarbe.
// Eigene Liste statt <select>, weil native Optionen keine Farben zeigen können.
import type { KalenderEintrag } from '../../body/interface';
import { esc } from './dom';
import { I } from './icons';

type Kal = Pick<KalenderEintrag, 'id' | 'name' | 'konto' | 'farbe'>;

/** Gruppen nach Quelle: Google zuerst, dann die übrigen alphabetisch; in jeder Gruppe alphabetisch nach Name */
export function kalenderGruppen<T extends Kal>(liste: T[]): { konto: string; kalender: T[] }[] {
  const nach = new Map<string, T[]>();
  for (const k of liste) { const q = k.konto || 'Andere'; nach.set(q, [...(nach.get(q) ?? []), k]); }
  const istGoogle = (q: string) => q.toLowerCase().includes('google');
  return [...nach.entries()]
    .sort(([a], [b]) => Number(istGoogle(b)) - Number(istGoogle(a)) || a.localeCompare(b, 'de'))
    .map(([konto, kalender]) => ({ konto, kalender: kalender.sort((x, y) => x.name.localeCompare(y.name, 'de')) }));
}

const SPEICHER = 'rb-spiegelziel';
const eintrag = (k: Kal) => `<span class="sdot" style="background:${k.farbe}"></span><span class="kw-name">${esc(k.name)}</span>`;

export function kalenderWahlHtml(liste: Kal[]): string {
  const gruppen = kalenderGruppen(liste);
  const zuletzt = localStorage.getItem(SPEICHER);
  const start = liste.find(k => k.id === zuletzt) ?? gruppen[0]?.kalender[0];
  if (!start) return '';
  return `<div class="kwahl" data-kwahl data-wert="${esc(start.id)}">
    <button type="button" class="kwahl-knopf">${eintrag(start)}<span class="kw-konto">${esc(start.konto)}</span>${I.aufklappen}</button>
    <div class="kwahl-liste">${gruppen.map(g => `<div class="kwahl-gruppe">${esc(g.konto)}</div>${g.kalender.map(k =>
      `<button type="button" class="kwahl-eintrag ${k.id === start.id ? 'an' : ''}" data-kwahl-id="${esc(k.id)}" data-konto="${esc(k.konto)}">${eintrag(k)}</button>`).join('')}`).join('')}</div>
  </div>`;
}

/** Bindet alle Kalenderauswahlen unter root an (Auf-/Zuklappen, Wählen, Esc, Klick daneben) */
export function kalenderWahlAnbinden(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-kwahl]').forEach(w => {
    const knopf = w.querySelector<HTMLElement>('.kwahl-knopf')!;
    knopf.onclick = e => { e.stopPropagation(); w.classList.toggle('offen'); w.querySelector('.kwahl-eintrag.an')?.scrollIntoView({ block: 'nearest' }); };
    w.querySelector<HTMLElement>('.kwahl-liste')!.onclick = e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-kwahl-id]');
      if (!b) return;
      e.stopPropagation();
      w.dataset.wert = b.dataset.kwahlId!;
      localStorage.setItem(SPEICHER, b.dataset.kwahlId!);
      w.querySelectorAll('.kwahl-eintrag').forEach(x => x.classList.toggle('an', x === b));
      knopf.innerHTML = `${b.innerHTML}<span class="kw-konto">${esc(b.dataset.konto ?? '')}</span>${I.aufklappen}`;
      w.classList.remove('offen');
    };
  });
}

document.addEventListener('mousedown', e => {
  document.querySelectorAll('.kwahl.offen').forEach(w => { if (!w.contains(e.target as Node)) w.classList.remove('offen'); });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const offen = document.querySelector('.kwahl.offen');
  if (offen) { offen.classList.remove('offen'); e.stopPropagation(); }
}, true);
