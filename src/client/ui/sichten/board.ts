// Sicht: Kanban-Board. Voll = alle Spalten gruppiert nach Kategorie; kompakt = eine Spalte je Kategorie; mini = Balken.
import type { Bereich, Board } from '../../../body/interface';
import { body } from '../body';
import { karte, spaltenKategorien, statusPunkt } from '../bausteine';
import { esc } from '../dom';
import { ausgewaehlt } from '../detail';
import { I } from '../icons';
import type { Dichte, Sicht } from './sicht';

export class BoardSicht implements Sicht {
  readonly bereiche: Bereich[] = ['board', 'einstellungen'];
  zustand() { return {}; }

  async render(el: HTMLElement, dichte: Dichte): Promise<void> {
    const b = await body.board(), heute = b.heute, gewaehlt = ausgewaehlt();
    spaltenKategorien(Object.fromEntries(b.kategorien.flatMap(k => k.spalten.map(s => [s.id, k.id]))));
    if (dichte === 'mini') { el.innerHTML = mini(b); return; }
    if (b.kategorien.every(k => !k.spalten.length)) { el.innerHTML = `<div class="leer">Keine Board-Spalten. ${I.einstellungen} Einstellungen → Board-Spalten.</div>`; return; }
    if (dichte === 'compact') {
      el.innerHTML = `<div class="board compact">${b.kategorien.map(k => {
        const erste = k.spalten.find(s => /bereit|inarbeit|erledigt/.test(s.id)) ?? k.spalten[0];
        const karten = k.spalten.flatMap(s => s.karten);
        return `<div class="col kcol kat-b-${katKlasse(k.id)}" ${erste ? `data-drop-status="${erste.id}"` : ''}><div class="col-h">${k.name}<span class="n">${karten.length}</span></div>
          <div class="cards">${karten.map(a => karte(a, heute, false, true, a.id === gewaehlt)).join('')}</div></div>`;
      }).join('')}</div>`;
      el.querySelector<HTMLElement>('.card.gewaehlt')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    el.innerHTML = `<div class="board2">${b.kategorien.filter(k => k.spalten.length).map(k => `
      <div class="kat" style="flex:${k.spalten.length} 1 0"><div class="kat-h kat-b-${katKlasse(k.id)}">${k.name} <span class="n">${k.anzahl}</span></div>
        <div class="kat-cols">${k.spalten.map(s => `
          <div class="col" data-drop-status="${s.id}"><div class="col-h">${statusPunkt(s.id)}${esc(s.name)}<span class="n">${s.karten.length}</span></div>
            <div class="cards">${s.karten.map(a => karte(a, heute, true, false, a.id === gewaehlt)).join('')}</div></div>`).join('')}
        </div></div>`).join('')}</div>`;
    el.querySelector<HTMLElement>('.card.gewaehlt')?.scrollIntoView({ block: 'nearest' });
  }
}

const katKlasse = (k: string) => ({ nichtBegonnen: 'offen', begonnen: 'begonnen', beendet: 'beendet' } as Record<string, string>)[k]!;

function mini(b: Board): string {
  const max = Math.max(1, ...b.kategorien.map(k => k.anzahl));
  const begonnen = b.kategorien.find(k => k.id === 'begonnen')?.spalten.flatMap(s => s.karten).filter(a => !a.abgeschlossen) ?? [];
  return `<div class="mini">${b.kategorien.map(k => `
    <div><div class="mlabel"><span>${k.name}</span><b>${k.anzahl}</b></div><div class="bar"><i class="kat-${katKlasse(k.id)}" style="width:${(k.anzahl / max) * 100}%"></i></div>
      <div class="muted" style="font-size:11px;margin-top:2px">${k.spalten.map(s => `${esc(s.name)} ${s.karten.length}`).join(' · ')}</div></div>`).join('')}
    <div class="peek"><div class="muted">Begonnen:</div>${begonnen.map(a => `<div data-task="${a.id}">${statusPunkt(a.status!.id)} ${esc(a.titel)}</div>`).join('')}</div></div>`;
}
