// Sicht: Aufgabenliste, gruppiert nach Fälligkeit. Jeder Abschnitt ist auf-/zuklappbar;
// Zurückgestellte und Abgeschlossene sind anfangs zu, das Archiv erscheint nur auf Wunsch.
import type { AufgabeZeile, Bereich } from '../../../body/interface';
import { body } from '../body';
import { ICON, zeile } from '../bausteine';
import { I } from '../icons';
import { esc } from '../dom';
import { alter, einmalZeigen, istFrisch } from '../frisch';
import { ausgewaehlt } from '../detail';
import type { Dichte, Sicht } from './sicht';

export type ListeZustand = { filter?: string; zu?: string[]; archiv?: boolean };
const STANDARD_ZU = ['zurueck', 'fertig'];

export class ListenSicht implements Sicht {
  readonly bereiche: Bereich[] = ['aufgaben'];
  constructor(private z: ListeZustand = {}) { this.z.zu ??= [...STANDARD_ZU]; }
  zustand() { return this.z; }

  private istZu(k: string) { return this.z.zu!.includes(k); }
  private umschalten(k: string) { this.z.zu = this.istZu(k) ? this.z.zu!.filter(x => x !== k) : [...this.z.zu!, k]; }

  async render(el: HTMLElement, dichte: Dichte): Promise<void> {
    if (dichte === 'mini') return this.mini(el);
    if (!el.querySelector(':scope > .list')) {
      el.innerHTML = `<div class="list" data-drop-list="1"><div class="list-h"><input placeholder="Filtern: Titel, #tag, @person …" /><span class="muted cnt"></span><button class="archivbtn" title="Archiv zeigen">${ICON.archiv}</button></div><div class="list-b"></div></div>`;
      const inp = el.querySelector('input')!;
      inp.value = this.z.filter ?? '';
      let t: ReturnType<typeof setTimeout>;
      inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { this.z.filter = inp.value; void this.render(el, dichte); }, 120); });
      el.querySelector<HTMLElement>('.archivbtn')!.onclick = () => { this.z.archiv = !this.z.archiv; void this.render(el, dichte); };
      el.addEventListener('click', e => {
        const g = (e.target as HTMLElement).closest<HTMLElement>('[data-grp]');
        if (g) { this.umschalten(g.dataset.grp!); void this.render(el, dichte); }
      });
    }
    const voll = dichte === 'full';
    el.querySelector('.list')!.className = `list ${dichte}`;
    el.querySelector('.archivbtn')!.classList.toggle('on', !!this.z.archiv);
    const l = await body.liste({ filter: this.z.filter ?? '' });

    const abschnitte: { k: string; name: string; aufgaben: AufgabeZeile[]; klasse?: string }[] = [
      ...l.gruppen.map(g => ({ k: g.art, name: g.name, aufgaben: g.aufgaben, klasse: g.art })),
      { k: 'zurueck', name: 'Zurückgestellt', aufgaben: l.zurueckgestellt },
      { k: 'fertig', name: 'Abgeschlossen', aufgaben: l.abgeschlossen },
      ...(this.z.archiv ? [{ k: 'archiv', name: 'Archiv', aufgaben: l.archiv }] : []),
    ];
    // Ein frisch angelegter Eintrag in einem zugeklappten Abschnitt klappt diesen auf
    const gewaehlt = ausgewaehlt();
    for (const a of abschnitte) if (a.aufgaben.some(x => istFrisch(x.id) || x.id === gewaehlt) && this.istZu(a.k)) this.umschalten(a.k);

    let h = '';
    for (const a of abschnitte) {
      if (!a.aufgaben.length && a.k !== 'archiv') continue;
      const offen = !this.istZu(a.k);
      h += `<div class="grp-h ${a.klasse ?? ''} ${offen ? 'open' : ''}" data-grp="${a.k}"><span class="caret">${I.rechts}</span>${esc(a.name)} <span class="n">${a.aufgaben.length}</span></div>`;
      if (offen) h += a.aufgaben.map(x => zeile(x, l.heute, voll, istFrisch(x.id), x.id === gewaehlt)).join('') || '<div class="leer" style="padding:6px 12px;text-align:left">leer</div>';
    }
    if (!h) h = this.z.filter ? '<div class="leer">Nichts gefunden.</div>' : '<div class="leer">Noch keine Aufgaben.<br>Oben eintippen und ↵ – oder <kbd>N</kbd>.</div>';
    const b = el.querySelector<HTMLElement>('.list-b')!;
    b.innerHTML = h;
    el.querySelector('.cnt')!.textContent = `${l.offen} offen`;

    b.querySelectorAll<HTMLElement>('.row.frisch').forEach(r => {
      r.style.animationDelay = `-${alter(r.dataset.task!)}ms`;
      if (einmalZeigen(r.dataset.task!)) r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    // die in der Schublade geöffnete Aufgabe bleibt im Blick – auch wenn sie den Abschnitt wechselt
    b.querySelector<HTMLElement>('.row.gewaehlt')?.scrollIntoView({ block: 'nearest' });
  }

  private async mini(el: HTMLElement): Promise<void> {
    const l = await body.liste({});
    const n = (art: string) => l.gruppen.find(g => g.art === art)!.aufgaben.length;
    const vorn = l.gruppen.slice(0, 3).flatMap(g => g.aufgaben).slice(0, 6);
    el.innerHTML = `<div class="mini">
      <div class="kpis">
        <div class="kpi" style="color:var(--d-ueberfaellig)"><b>${n('ueberfaellig')}</b> überfällig</div>
        <div class="kpi" style="color:var(--d-heute)"><b>${n('heute')}</b> heute</div>
        <div class="kpi"><b>${n('woche')}</b> diese Woche</div>
        <div class="kpi"><b>${l.offen}</b> offen</div>
      </div>
      <div class="peek">${vorn.map(a => `<div data-task="${a.id}">${I.frist} ${esc(a.titel)}</div>`).join('')}</div>
    </div>`;
  }
}
