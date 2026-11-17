// Eingabe als Chips: Tippen zeigt passende Vorschläge, ↵ macht aus der Eingabe einen Chip mit ×.
// Einzelwert (Verantwortlich, Ort) oder mehrere Werte (Tags). ⌫ im leeren Feld entfernt den letzten Chip.
import { body } from './body';
import { esc } from './dom';

export type ChipArt = 'tag' | 'person' | 'ort';
const KLASSE: Record<ChipArt, string> = { tag: 'tag', person: 'person', ort: 'ort' };
const VORZEICHEN: Record<ChipArt, string> = { tag: '#', person: '@', ort: '⌖ ' };

export function chipFeld(root: HTMLElement, o: {
  art: ChipArt; werte: string[]; mehrfach: boolean; gesperrt: boolean; platzhalter: string;
  aendern(werte: string[]): void;
}): void {
  let werte = [...o.werte];
  let vorschlaege: string[] = [];
  let markiert = -1;
  root.classList.add('chipfeld');
  const zeichnen = () => {
    const eingabeSichtbar = !o.gesperrt && (o.mehrfach || werte.length === 0);
    root.innerHTML = werte.map((w, i) => `<span class="chip ${KLASSE[o.art]}">${VORZEICHEN[o.art]}${esc(w)}${o.gesperrt ? '' : `<button class="chip-x" data-weg="${i}" title="entfernen">×</button>`}</span>`).join('')
      + (eingabeSichtbar ? `<input type="text" placeholder="${esc(werte.length ? '' : o.platzhalter)}">` : '')
      + '<div class="vorschl"></div>';
    const inp = root.querySelector('input');
    if (inp) binden(inp);
  };
  const liste = () => {
    const v = root.querySelector<HTMLElement>('.vorschl')!;
    v.innerHTML = vorschlaege.map((w, i) => `<div class="${i === markiert ? 'an' : ''}" data-vorschlag="${i}">${VORZEICHEN[o.art]}${esc(w)}</div>`).join('');
    v.style.display = vorschlaege.length ? 'block' : 'none';
  };
  const uebernehmen = (wert: string, fokus: boolean) => {
    const w = (o.art === 'tag' ? wert.replace(/^#/, '').toLowerCase() : wert.replace(/^@/, '')).trim();
    if (!w || werte.includes(w)) return;
    werte = o.mehrfach ? [...werte, w] : [w];
    vorschlaege = []; markiert = -1;
    o.aendern(werte);
    zeichnen();
    if (fokus) root.querySelector('input')?.focus();
  };
  const binden = (inp: HTMLInputElement) => {
    inp.addEventListener('input', async () => {
      const text = inp.value.replace(/^[#@]/, '');
      const alle = await body.vorschlaege({ art: o.art, praefix: '' });
      vorschlaege = alle.filter(w => !werte.includes(w) && w.toLowerCase().includes(text.toLowerCase())).slice(0, 8);
      markiert = vorschlaege.length && text ? 0 : -1;
      liste();
    });
    inp.addEventListener('focus', () => inp.dispatchEvent(new Event('input')));
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (vorschlaege.length) { markiert = (markiert + (e.key === 'ArrowDown' ? 1 : -1) + vorschlaege.length) % vorschlaege.length; liste(); }
      } else if (e.key === 'Enter' || (e.key === ',' && o.art === 'tag')) {
        e.preventDefault();
        uebernehmen(markiert >= 0 && vorschlaege[markiert] && inp.value.trim() ? vorschlaege[markiert]! : inp.value, true);
      } else if (e.key === 'Escape') {
        e.stopPropagation(); vorschlaege = []; liste(); inp.value = '';
      } else if (e.key === 'Backspace' && !inp.value && werte.length) {
        werte = werte.slice(0, -1); o.aendern(werte); zeichnen(); root.querySelector('input')?.focus();
      }
    });
    inp.addEventListener('blur', () => setTimeout(() => { if (inp.isConnected && inp.value.trim()) uebernehmen(inp.value, false); else { vorschlaege = []; if (root.isConnected) liste(); } }, 150));
  };
  root.addEventListener('mousedown', e => {
    const t = e.target as HTMLElement;
    const v = t.closest<HTMLElement>('[data-vorschlag]');
    if (v) { e.preventDefault(); uebernehmen(vorschlaege[Number(v.dataset.vorschlag)]!, true); return; }
    const weg = t.closest<HTMLElement>('[data-weg]');
    if (weg) { e.preventDefault(); werte = werte.filter((_, i) => i !== Number(weg.dataset.weg)); o.aendern(werte); zeichnen(); root.querySelector('input')?.focus(); return; }
    if (t === root) { e.preventDefault(); root.querySelector('input')?.focus(); }
  });
  zeichnen();
}
