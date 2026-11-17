// Notizfeld mit Markdown: leer → Bearbeiten, sonst Ansicht (Links, Listen, abhakbare Checklisten).
// In der Ansicht: ✎ oder Doppelklick → Bearbeiten. Verlassen des Feldes (oder ⌘↵ / Esc) speichert und zeigt die Ansicht.
import { checkboxUmschalten, markdownHtml } from '../../basis/markdown';
import { esc } from './dom';

export function notizFeld(root: HTMLElement, o: { text: string; gesperrt: boolean; fokus: boolean; speichern(text: string): Promise<void> }): void {
  let text = o.text;
  root.classList.add('notiz');
  const ansicht = () => {
    root.innerHTML = `<div class="md">${markdownHtml(text)}</div>${o.gesperrt ? '' : '<button class="md-bearbeiten" title="Bearbeiten (Doppelklick)">✎</button>'}`;
  };
  const bearbeiten = (fokus: boolean) => {
    root.innerHTML = `<textarea placeholder="Notizen … Markdown: **fett**, *kursiv*, [Link](https://…), - Liste, - [ ] Aufgabe" ${o.gesperrt ? 'disabled' : ''}>${esc(text)}</textarea>`;
    const ta = root.querySelector('textarea')!;
    const fertig = async () => {
      const neu = ta.value;
      if (neu !== text) { text = neu; await o.speichern(neu); }
      if (text.trim() && root.isConnected) ansicht();
    };
    ta.addEventListener('blur', () => void fertig());
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.stopPropagation(); ta.blur(); }
    });
    if (fokus) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  };
  root.addEventListener('click', async e => {
    const t = e.target as HTMLElement;
    if (t.closest('.md-bearbeiten')) { bearbeiten(true); return; }
    const cb = t.closest<HTMLInputElement>('input[type=checkbox][data-zeile]');
    if (cb && !o.gesperrt) { text = checkboxUmschalten(text, Number(cb.dataset.zeile)); ansicht(); await o.speichern(text); }
    else if (cb) e.preventDefault();
  });
  root.addEventListener('dblclick', e => { if (!o.gesperrt && (e.target as HTMLElement).closest('.md') && !(e.target as HTMLElement).closest('a, input')) bearbeiten(true); });
  if (text.trim()) ansicht(); else bearbeiten(o.fokus && !o.gesperrt);
}
