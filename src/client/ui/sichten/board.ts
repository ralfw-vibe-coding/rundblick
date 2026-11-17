// Sicht: Kanban-Board. Voll = alle Spalten gruppiert nach Kategorie; kompakt = eine Spalte je Kategorie; mini = Balken.
// Kategorien und Spalten lassen sich per Chevron zuklappen. Zurückgestellte und abgeschlossene Aufgaben stehen
// in jeder Spalte unten in eigenen, anfangs zugeklappten Bereichen „Zurückgestellt“ und „Abgeschlossen“.
import type { AufgabeZeile, Bereich, Board } from '../../../body/interface';
import { body } from '../body';
import { karte, spaltenKategorien, statusPunkt } from '../bausteine';
import { esc } from '../dom';
import { ausgewaehlt } from '../detail';
import { I } from '../icons';
import type { Dichte, Sicht } from './sicht';

export type BoardZustand = {
  /** zugeklappte Kategorien und Spalten */
  zu?: string[];
  /** offene Bereiche: „<spalte>“ = Abgeschlossen, „zur:<spalte>“ = Zurückgestellt (im kompakten Board je Kategorie) */
  abgOffen?: string[];
};

export class BoardSicht implements Sicht {
  readonly bereiche: Bereich[] = ['board', 'einstellungen'];
  private el: HTMLElement | null = null;
  private dichte: Dichte = 'full';
  constructor(private z: BoardZustand = {}) { this.z.zu ??= []; this.z.abgOffen ??= []; }
  zustand() { return this.z; }

  private zu = (k: string) => this.z.zu!.includes(k);
  private abg = (k: string) => this.z.abgOffen!.includes(k);
  private schalten(liste: 'zu' | 'abgOffen', k: string, an?: boolean): void {
    const l = this.z[liste]!, ist = l.includes(k), soll = an ?? !ist;
    if (soll && !ist) l.push(k);
    if (!soll && ist) l.splice(l.indexOf(k), 1);
  }

  async render(el: HTMLElement, dichte: Dichte): Promise<void> {
    this.el = el; this.dichte = dichte;
    const b = await body.board(), heute = b.heute, gewaehlt = ausgewaehlt();
    spaltenKategorien(Object.fromEntries(b.kategorien.flatMap(k => k.spalten.map(s => [s.id, k.id]))));
    if (dichte === 'mini') { el.innerHTML = mini(b); return; }
    if (b.kategorien.every(k => !k.spalten.length)) { el.innerHTML = `<div class="leer">Keine Board-Spalten. ${I.einstellungen} Einstellungen → Board-Spalten.</div>`; return; }

    // Die geöffnete Aufgabe muss sichtbar sein: ihre Kategorie, Spalte und ggf. „Abgeschlossen“ aufklappen
    for (const k of b.kategorien) for (const s of k.spalten) {
      const a = s.karten.find(x => x.id === gewaehlt);
      if (!a) continue;
      this.schalten('zu', k.id, false); this.schalten('zu', s.id, false);
      const schl = dichte === 'compact' ? k.id : s.id;
      if (a.abgeschlossen) this.schalten('abgOffen', schl, true);
      else if (a.zurueckgestellt) this.schalten('abgOffen', `zur:${schl}`, true);
    }

    const stapel = (schluessel: string, karten: AufgabeZeile[], voll: boolean, mitStatus: boolean) => {
      const k = (a: AufgabeZeile) => karte(a, heute, voll, mitStatus, a.id === gewaehlt);
      const bereich = (name: string, schl: string, liste: AufgabeZeile[]) => liste.length ? `
        <div class="abg-h ${this.abg(schl) ? 'open' : ''}" data-abg="${esc(schl)}"><span class="caret">${I.rechts}</span>${name} <span class="n">${liste.length}</span></div>
        ${this.abg(schl) ? liste.map(k).join('') : ''}` : '';
      return `<div class="cards">${karten.filter(istOffen).map(k).join('')}${bereich('Zurückgestellt', `zur:${schluessel}`, karten.filter(a => !a.abgeschlossen && a.zurueckgestellt))}${bereich('Abgeschlossen', schluessel, karten.filter(a => a.abgeschlossen))}</div>`;
    };
    const offenZahl = (karten: AufgabeZeile[]) => karten.filter(istOffen).length;
    const caret = `<span class="caret">${I.rechts}</span>`;

    if (dichte === 'compact') {
      el.innerHTML = `<div class="board compact">${b.kategorien.map(k => {
        const erste = k.spalten.find(s => /bereit|inarbeit|erledigt/.test(s.id)) ?? k.spalten[0];
        const karten = k.spalten.flatMap(s => s.karten);
        const zu = this.zu(k.id);
        return `<div class="col kcol kat-b-${katKlasse(k.id)} ${zu ? 'zu' : ''}" ${erste ? `data-drop-status="${erste.id}"` : ''}>
          <div class="col-h ${zu ? '' : 'open'}" data-zu="${k.id}" title="${zu ? 'Aufklappen' : 'Zuklappen'}">${caret}<span class="nm">${k.name}</span><span class="n">${offenZahl(karten)}</span></div>
          ${zu ? '' : stapel(k.id, karten, false, true)}</div>`;
      }).join('')}</div>`;
    } else {
      el.innerHTML = `<div class="board2">${b.kategorien.filter(k => k.spalten.length).map(k => {
        const kzu = this.zu(k.id);
        const offenSpalten = kzu ? 0 : k.spalten.filter(s => !this.zu(s.id)).length;
        const kopf = `<div class="kat-h kat-b-${katKlasse(k.id)} ${kzu ? '' : 'open'}" data-zu="${k.id}" title="${kzu ? 'Aufklappen' : 'Zuklappen'}">${caret}<span class="nm">${k.name}</span> <span class="n">${offenZahl(k.spalten.flatMap(s => s.karten))}</span></div>`;
        if (kzu) return `<div class="kat zu">${kopf}</div>`;
        const minBreite = offenSpalten * 150 + (k.spalten.length - offenSpalten) * 34 + (k.spalten.length - 1) * 8;
        return `<div class="kat" style="flex:${Math.max(offenSpalten, 0.2)} 0 0;min-width:${minBreite}px">${kopf}
          <div class="kat-cols">${k.spalten.map(s => {
            const zu = this.zu(s.id);
            return `<div class="col ${zu ? 'zu' : ''}" data-drop-status="${s.id}">
              <div class="col-h ${zu ? '' : 'open'}" data-zu="${s.id}" title="${zu ? 'Aufklappen' : 'Zuklappen'}">${caret}${statusPunkt(s.id)}<span class="nm">${esc(s.name)}</span><span class="n">${offenZahl(s.karten)}</span></div>
              ${zu ? '' : stapel(s.id, s.karten, true, false)}</div>`;
          }).join('')}</div></div>`;
      }).join('')}</div>`;
    }
    el.onclick = e => {
      const t = e.target as HTMLElement;
      const zu = t.closest<HTMLElement>('[data-zu]'), abg = t.closest<HTMLElement>('[data-abg]');
      if (zu) { this.schalten('zu', zu.dataset.zu!); void this.neu(); }
      if (abg) { this.schalten('abgOffen', abg.dataset.abg!); void this.neu(); }
    };
    el.querySelector<HTMLElement>('.card.gewaehlt')?.scrollIntoView({ block: 'nearest' });
  }

  private async neu(): Promise<void> { if (this.el) await this.render(this.el, this.dichte); }
}

/** auf dem Board „offen“ = weder abgeschlossen noch zurückgestellt */
const istOffen = (a: AufgabeZeile) => !a.abgeschlossen && !a.zurueckgestellt;

const katKlasse = (k: string) => ({ nichtBegonnen: 'offen', begonnen: 'begonnen', beendet: 'beendet' } as Record<string, string>)[k]!;

function mini(b: Board): string {
  const offen = (k: Board['kategorien'][number]) => k.spalten.flatMap(s => s.karten).filter(istOffen);
  const max = Math.max(1, ...b.kategorien.map(k => offen(k).length));
  const begonnen = offen(b.kategorien.find(k => k.id === 'begonnen') ?? { id: 'begonnen', name: '', anzahl: 0, spalten: [] });
  return `<div class="mini">${b.kategorien.map(k => `
    <div><div class="mlabel"><span>${k.name}</span><b>${offen(k).length}</b></div><div class="bar"><i class="kat-${katKlasse(k.id)}" style="width:${(offen(k).length / max) * 100}%"></i></div>
      <div class="muted" style="font-size:11px;margin-top:2px">${k.spalten.map(s => `${esc(s.name)} ${s.karten.filter(istOffen).length}`).join(' · ')}</div></div>`).join('')}
    <div class="peek"><div class="muted">Begonnen:</div>${begonnen.map(a => `<div data-task="${a.id}">${statusPunkt(a.status!.id)} ${esc(a.titel)}</div>`).join('')}</div></div>`;
}
