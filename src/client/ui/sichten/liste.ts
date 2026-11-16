// Sicht: Aufgabenliste, gruppiert nach Frist; Zurückgestellte und Abgeschlossene eingeklappt.
import type { Bereich } from '../../../body/interface';
import { body } from '../body';
import { zeile } from '../bausteine';
import { esc } from '../dom';
import type { Dichte, Sicht } from './sicht';

export type ListeZustand = { filter?: string };

export class ListenSicht implements Sicht {
  readonly bereiche: Bereich[] = ['aufgaben'];
  private offen = { zurueck: false, fertig: false };
  constructor(private z: ListeZustand = {}) {}
  zustand() { return this.z; }

  async render(el: HTMLElement, dichte: Dichte): Promise<void> {
    if (dichte === 'mini') return this.mini(el);
    if (!el.querySelector(':scope > .list')) {
      el.innerHTML = `<div class="list" data-drop-list="1"><div class="list-h"><input placeholder="Filtern: Titel, #tag, @person …" /><span class="muted cnt"></span></div><div class="list-b"></div></div>`;
      const inp = el.querySelector('input')!;
      inp.value = this.z.filter ?? '';
      let t: ReturnType<typeof setTimeout>;
      inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { this.z.filter = inp.value; void this.render(el, dichte); }, 120); });
      el.addEventListener('click', e => {
        const g = (e.target as HTMLElement).closest<HTMLElement>('[data-grp]');
        if (g) { const k = g.dataset.grp as 'zurueck' | 'fertig'; this.offen[k] = !this.offen[k]; void this.render(el, dichte); }
      });
    }
    const voll = dichte === 'full';
    el.querySelector('.list')!.className = `list ${dichte}`;
    const l = await body.liste({ filter: this.z.filter ?? '' });
    let h = '';
    for (const g of l.gruppen) {
      if (!g.aufgaben.length) continue;
      const k = g.art === 'ueberfaellig' ? 'over' : g.art === 'heute' ? 'today' : '';
      h += `<div class="grp-h ${k}">${g.name} <span class="n">${g.aufgaben.length}</span></div>` + g.aufgaben.map(a => zeile(a, l.heute, voll)).join('');
    }
    if (l.zurueckgestellt.length) {
      h += `<div class="grp-h toggle ${this.offen.zurueck ? 'open' : ''}" data-grp="zurueck">Zurückgestellt <span class="n">${l.zurueckgestellt.length}</span></div>`;
      if (this.offen.zurueck) h += l.zurueckgestellt.map(a => zeile(a, l.heute, voll)).join('');
    }
    if (l.abgeschlossen.length) {
      h += `<div class="grp-h toggle ${this.offen.fertig ? 'open' : ''}" data-grp="fertig">Abgeschlossen <span class="n">${l.abgeschlossen.length}</span></div>`;
      if (this.offen.fertig) h += l.abgeschlossen.map(a => zeile(a, l.heute, voll)).join('');
    }
    if (!h) h = this.z.filter ? '<div class="leer">Nichts gefunden.</div>' : '<div class="leer">Noch keine Aufgaben.<br>Oben eintippen und ↵ – oder <kbd>N</kbd>.</div>';
    el.querySelector('.list-b')!.innerHTML = h;
    el.querySelector('.cnt')!.textContent = `${l.offen} offen`;
  }

  private async mini(el: HTMLElement): Promise<void> {
    const l = await body.liste({});
    const n = (art: string) => l.gruppen.find(g => g.art === art)!.aufgaben.length;
    const vorn = l.gruppen.slice(0, 3).flatMap(g => g.aufgaben).slice(0, 6);
    el.innerHTML = `<div class="mini">
      <div class="kpis">
        <div class="kpi over"><b>${n('ueberfaellig')}</b> überfällig</div>
        <div class="kpi today"><b>${n('heute')}</b> heute</div>
        <div class="kpi"><b>${n('woche')}</b> diese Woche</div>
        <div class="kpi"><b>${l.offen}</b> offen</div>
      </div>
      <div class="peek">${vorn.map(a => `<div data-task="${a.id}">◆ ${esc(a.titel)}</div>`).join('')}</div>
    </div>`;
  }
}
