// Sicht: Kanban-Board. Voll = alle Spalten gruppiert nach Kategorie; kompakt = eine Spalte je Kategorie; mini = Balken.
// Kategorien und Spalten lassen sich per Chevron zuklappen. Zurückgestellte und abgeschlossene Aufgaben stehen
// in jeder Spalte unten in eigenen, anfangs zugeklappten Bereichen „Zurückgestellt“ und „Abgeschlossen“.
import type { AufgabeZeile, Bereich, Board } from '../../../body/interface';
import type { KategorieId } from '../../../schema/werte';
import { body } from '../body';
import { karte, spaltenKategorien, statusPunkt } from '../bausteine';
import { esc, pruefe } from '../dom';
import { ausgewaehlt } from '../detail';
import { I } from '../icons';
import type { Dichte, Sicht } from './sicht';

export type BoardZustand = {
  /** zugeklappte Kategorien und Spalten */
  zu?: string[];
  /** offene Bereiche: „<spalte>“ = Abgeschlossen, „zur:<spalte>“ = Zurückgestellt (im kompakten Board je Kategorie) */
  abgOffen?: string[];
  /** manuell gesetzte Spaltenbreiten in px (sonst teilen sich die Spalten den Platz) */
  breiten?: Record<string, number>;
};
const MIN = 150, ZU = 34, LUECKE = 8;

export class BoardSicht implements Sicht {
  readonly bereiche: Bereich[] = ['board', 'einstellungen'];
  private el: HTMLElement | null = null;
  private dichte: Dichte = 'full';
  constructor(private z: BoardZustand = {}) { this.z.zu ??= []; this.z.abgOffen ??= []; this.z.breiten ??= {}; }
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
      const k = (a: AufgabeZeile) => karte(a, heute, voll, mitStatus, a.id === gewaehlt).replace('<div class="card ', `<div ${istOffen(a) ? 'data-offen ' : ''}class="card `);
      const bereich = (name: string, schl: string, liste: AufgabeZeile[]) => liste.length ? `
        <div class="abg-h ${this.abg(schl) ? 'open' : ''}" data-abg="${esc(schl)}"><span class="caret">${I.rechts}</span>${name} <span class="n">${liste.length}</span></div>
        ${this.abg(schl) ? liste.map(k).join('') : ''}` : '';
      return `<div class="cards" data-spalte="${esc(schluessel)}">${karten.filter(istOffen).map(k).join('')}${bereich('Zurückgestellt', `zur:${schluessel}`, karten.filter(a => !a.abgeschlossen && a.zurueckgestellt))}${bereich('Abgeschlossen', schluessel, karten.filter(a => a.abgeschlossen))}</div>`;
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
        const kopf = `<div class="kat-h kat-b-${katKlasse(k.id)} ${kzu ? '' : 'open'}" data-zu="${k.id}" title="${kzu ? 'Aufklappen' : 'Zuklappen'}">${caret}<span class="nm">${k.name}</span> <span class="n">${offenZahl(k.spalten.flatMap(s => s.karten))}</span>${kzu ? '' : `<button class="kat-plus" data-sp-neu="${k.id}" title="Neue Spalte in „${esc(k.name)}“">${I.plus}</button>`}</div>`;
        if (kzu) return `<div class="kat zu">${kopf}</div>`;
        const offene = kzu ? [] : k.spalten.filter(s => !this.zu(s.id));
        const fest = offene.filter(s => this.z.breiten![s.id]), frei = offene.length - fest.length;
        const basis = fest.reduce((n, s) => n + this.z.breiten![s.id]!, 0) + frei * MIN + (k.spalten.length - offenSpalten) * ZU + (k.spalten.length - 1) * LUECKE;
        return `<div class="kat" style="flex:${frei} 0 ${basis}px;min-width:${basis}px">${kopf}
          <div class="kat-cols">${k.spalten.map(s => {
            const zu = this.zu(s.id), b = this.z.breiten![s.id];
            return `<div class="col ${zu ? 'zu' : ''}" data-drop-status="${s.id}"${!zu && b ? ` style="flex:0 0 ${b}px"` : ''}>${zu ? '' : `<div class="spalten-griff" data-griff="${s.id}" title="Ziehen: Breite ändern · Doppelklick: automatisch"></div>`}
              <div class="col-h ${zu ? '' : 'open'}" data-zu="${s.id}" title="${zu ? 'Aufklappen' : 'Zuklappen'}">${caret}${statusPunkt(s.id)}<span class="nm">${esc(s.name)}</span><span class="n">${offenZahl(s.karten)}</span></div>
              ${zu ? '' : stapel(s.id, s.karten, true, false)}</div>`;
          }).join('')}</div></div>`;
      }).join('')}</div>`;
    }
    el.onclick = e => {
      const t = e.target as HTMLElement;
      const plus = t.closest<HTMLElement>('[data-sp-neu]');
      if (plus) { e.stopPropagation(); neueSpalteZeile(plus.closest<HTMLElement>('.kat')!, plus.dataset.spNeu as KategorieId); return; }
      if (t.closest('.col.neu')) return;
      const zu = t.closest<HTMLElement>('[data-zu]'), abg = t.closest<HTMLElement>('[data-abg]');
      if (zu) { this.schalten('zu', zu.dataset.zu!); void this.neu(); }
      if (abg) { this.schalten('abgOffen', abg.dataset.abg!); void this.neu(); }
    };
    el.ondblclick = e => {
      const g = (e.target as HTMLElement).closest<HTMLElement>('[data-griff]');
      if (g) { delete this.z.breiten![g.dataset.griff!]; void this.neu(); }
    };
    if (!el.dataset.board) { el.dataset.board = '1'; this.griffeAnbinden(el); verschiebbarMachen(el); }
    el.querySelector<HTMLElement>('.card.gewaehlt')?.scrollIntoView({ block: 'nearest' });
  }

  /** Spaltenbreite per Ziehgriff am rechten Spaltenrand */
  private griffeAnbinden(el: HTMLElement): void {
    el.addEventListener('pointerdown', e => {
      const g = (e.target as HTMLElement).closest<HTMLElement>('[data-griff]');
      if (!g) return;
      e.preventDefault(); e.stopPropagation();
      const col = g.parentElement!, kat = col.closest<HTMLElement>('.kat')!;
      const start = e.clientX, breite0 = col.getBoundingClientRect().width, kat0 = kat.getBoundingClientRect().width;
      g.setPointerCapture(e.pointerId); g.classList.add('aktiv');
      let breite = breite0;
      const bewegen = (m: PointerEvent) => {
        breite = Math.max(MIN, Math.round(breite0 + m.clientX - start));
        col.style.flex = `0 0 ${breite}px`;
        kat.style.minWidth = `${kat0 + breite - breite0}px`;
      };
      const los = () => {
        g.removeEventListener('pointermove', bewegen); g.removeEventListener('pointerup', los);
        g.classList.remove('aktiv');
        this.z.breiten![g.dataset.griff!] = breite;
        void this.neu();
      };
      g.addEventListener('pointermove', bewegen); g.addEventListener('pointerup', los);
    });
  }

  private async neu(): Promise<void> { if (this.el) await this.render(this.el, this.dichte); }
}

// ---------- Neue Spalte direkt auf dem Board ----------
// „+“ im Gruppenkopf: am Ende der Gruppe erscheint eine Spalte mit Eingabefeld und Cursor.
// ↵ legt sie an (das Board zeichnet sich danach neu), Esc oder leeres Verlassen verwirft sie.
function neueSpalteZeile(kat: HTMLElement, kategorie: KategorieId): void {
  const cols = kat.querySelector<HTMLElement>('.kat-cols')!;
  let col = cols.querySelector<HTMLElement>('.col.neu');
  if (!col) {
    col = document.createElement('div');
    col.className = 'col neu';
    col.innerHTML = '<div class="col-h open"><input placeholder="Name der neuen Spalte"></div>';
    cols.appendChild(col);
    kat.style.minWidth = `${kat.getBoundingClientRect().width + MIN + LUECKE}px`;
    const inp = col.querySelector('input')!;
    let fertig = false;
    const weg = () => { fertig = true; col!.remove(); kat.style.minWidth = ''; };
    inp.addEventListener('keydown', async ev => {
      if (ev.key === 'Escape') { ev.stopPropagation(); weg(); }
      if (ev.key !== 'Enter') return;
      const name = inp.value.trim();
      if (!name) { weg(); return; }
      fertig = true;
      if (!pruefe(await body.spalteAnlegen({ name, kategorie }))) fertig = false;
    });
    inp.addEventListener('blur', () => { if (!fertig && !inp.value.trim()) weg(); });
  }
  col.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  col.querySelector('input')!.focus();
}

// ---------- Karten senkrecht verschieben (manuelle Reihenfolge = derselbe Rang wie in der Liste) ----------
// Gezogen wird nur unter den offenen Karten. Landet eine Karte in einer anderen Spalte, bekommt sie
// zusätzlich deren Status. Die Einfügestelle zeigt eine Linie wie in der Aufgabenliste.
const TYP = 'application/x-rb-karte';
function verschiebbarMachen(el: HTMLElement): void {
  let gezogen: HTMLElement | null = null;
  const weg = () => el.querySelectorAll('.einfuegen-oben, .einfuegen-unten').forEach(x => x.classList.remove('einfuegen-oben', 'einfuegen-unten'));
  const offeneIn = (cards: HTMLElement) => [...cards.querySelectorAll<HTMLElement>(':scope > .card[data-offen]')];
  el.addEventListener('dragstart', e => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.board2 .card[data-offen]');
    gezogen = c;
    if (c) e.dataTransfer!.setData(TYP, c.dataset.task!);
  });
  el.addEventListener('dragend', () => { gezogen = null; weg(); });
  const ziel = (e: DragEvent) => {
    if (!gezogen || !e.dataTransfer!.types.includes(TYP)) return null;
    const c = (e.target as HTMLElement).closest<HTMLElement>('.board2 .card[data-offen]');
    if (c && c !== gezogen) { const r = c.getBoundingClientRect(); return { c, oben: e.clientY < r.top + r.height / 2 }; }
    // unter der letzten offenen Karte einer Spalte
    const cards = (e.target as HTMLElement).closest<HTMLElement>('.board2 .cards');
    const letzte = cards ? offeneIn(cards).filter(x => x !== gezogen).at(-1) : undefined;
    return letzte && e.clientY > letzte.getBoundingClientRect().bottom ? { c: letzte, oben: false } : null;
  };
  el.addEventListener('dragover', e => {
    const z = ziel(e);
    weg();
    if (!z) return;
    e.preventDefault(); e.stopPropagation();
    z.c.classList.add(z.oben ? 'einfuegen-oben' : 'einfuegen-unten');
  });
  el.addEventListener('drop', async e => {
    const z = ziel(e);
    weg();
    if (!z || !gezogen) return;
    e.preventDefault(); e.stopPropagation();
    const id = gezogen.dataset.task!, spalte = z.c.parentElement!.dataset.spalte!;
    const reihe = offeneIn(z.c.parentElement!).filter(x => x !== gezogen);
    const i = reihe.indexOf(z.c) + (z.oben ? 0 : 1);
    if (gezogen.parentElement!.dataset.spalte !== spalte) await body.statusSetzen({ aufgabeId: id, status: spalte });
    await body.aufgabeVerschieben({ aufgabeId: id, oben: reihe[i - 1]?.dataset.task ?? null, unten: reihe[i]?.dataset.task ?? null });
  });
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
