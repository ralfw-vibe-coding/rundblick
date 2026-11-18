// Raster: das Fenster ist ein Baum aus Splits und Zellen; jede Zelle zeigt eine Sicht.
// Layouts werden als Arbeitsbereiche gespeichert (UI-Zustand pro Gerät, über den Body in den Einstellungen).
import type { Bereich, Layout } from '../../body/interface';
import { body } from './body';
import { esc } from './dom';
import { I } from './icons';
import { zweistufigRegistrieren } from './interaktion';
import { BoardSicht, type BoardZustand } from './sichten/board';
import { KalenderSicht, type KalZustand } from './sichten/kalender';
import { ListenSicht, type ListeZustand } from './sichten/liste';
import { LogbuchSicht, type LogbuchZustand } from './sichten/logbuch';
import type { Dichte, Sicht } from './sichten/sicht';

export type SichtArt = 'liste' | 'board' | 'kalender' | 'timeline' | 'logbuch';
type Zelle = { t: 'zelle'; id: string; sicht: SichtArt | null; zustand: unknown };
type Split = { t: 'split'; richtung: 'row' | 'col'; anteile: number[]; kinder: Knoten[] };
type Knoten = Zelle | Split;
type Arbeitsbereich = { name: string; wurzel: Knoten };

export const SICHTEN: Record<SichtArt, { name: string; icon: string }> = {
  liste: { name: 'Aufgabenliste', icon: I.liste },
  board: { name: 'Kanban-Board', icon: I.board },
  kalender: { name: 'Kalender', icon: I.mehrtage },
  timeline: { name: 'Timeline', icon: I.timeline },
  logbuch: { name: 'Logbuch', icon: I.logbuch },
};

const uid = () => 'z' + Math.random().toString(36).slice(2, 8);
const Z = (sicht: SichtArt | null, zustand: unknown = null): Zelle => ({ t: 'zelle', id: uid(), sicht, zustand });
const S = (richtung: 'row' | 'col', anteile: number[], kinder: Knoten[]): Split => ({ t: 'split', richtung, anteile, kinder });

function vorlagen(): Arbeitsbereich[] {
  return [
    { name: 'Überblick', wurzel: S('row', [27, 73], [Z('liste'), S('col', [42, 58], [Z('board'), Z('kalender', { ansicht: 'woche', anker: null, pph: 10 })])]) },
    { name: 'Heute', wurzel: S('row', [30, 70], [Z('kalender', { ansicht: 'tag', anker: null, pph: 10 }), S('col', [55, 45], [Z('liste'), Z('timeline')])]) },
    { name: 'Planen', wurzel: S('col', [40, 60], [Z('timeline'), S('row', [30, 70], [Z('liste'), Z('kalender', { ansicht: 'monate3', anker: null, pph: 10 })])]) },
    { name: 'Board', wurzel: S('row', [76, 24], [Z('board'), Z('kalender', { ansicht: 'tag', anker: null, pph: 10 })]) },
  ];
}

/** Alte Layouts: „Tageskalender“/„Mehrtageskalender“ sind jetzt eine Sicht „Kalender“ mit Zeitraum-Auswahl */
function umstellen(k: Knoten): void {
  if (k.t === 'split') { k.kinder.forEach(umstellen); return; }
  const alt = k.sicht as string | null;
  if (alt === 'tag') { k.sicht = 'kalender'; k.zustand = { ...(k.zustand as object ?? {}), ansicht: 'tag' }; }
  if (alt === 'mehrtage') k.sicht = 'kalender';
}

function sichtErzeugen(z: Zelle): Sicht | null {
  switch (z.sicht) {
    case 'liste': return new ListenSicht((z.zustand as ListeZustand) ?? {});
    case 'board': return new BoardSicht((z.zustand as BoardZustand) ?? {});
    case 'kalender': return new KalenderSicht({ ansicht: 'woche', anker: null, pph: 10, ...(z.zustand as Partial<KalZustand>) }, ['tag', 'tage3', 'woche', 'monat', 'monate3']);
    case 'timeline': return new KalenderSicht({ ansicht: 'timeline', anker: null, pph: 16, ...(z.zustand as Partial<KalZustand>) }, ['timeline']);
    case 'logbuch': return new LogbuchSicht((z.zustand as LogbuchZustand) ?? {});
    default: return null;
  }
}

const ICON = { row: I.nebeneinander, col: I.untereinander, max: I.maximieren, min: I.minimieren, x: I.x };

export class Raster {
  private bereiche: Arbeitsbereich[] = vorlagen();
  private aktiv = 0;
  private maxId: string | null = null;
  private sichten = new Map<string, Sicht>();
  private dichten = new Map<string, Dichte>();
  private ro = new ResizeObserver(es => es.forEach(en => this.groesseGeaendert(en.target as HTMLElement)));
  private gespeichert = '';

  constructor(private readonly flaeche: HTMLElement, private readonly tabs: HTMLElement) {
    this.tabs.addEventListener('click', e => this.tabKlick(e));
    this.tabs.addEventListener('dblclick', e => this.tabUmbenennen(e));
    // „−“ ist zweistufig: 1. Klick → rotes „?“, 2. Klick löscht den aktiven Arbeitsbereich
    zweistufigRegistrieren('arbeitsbereichLoeschen', async () => {
      if (this.bereiche.length < 2) return;
      this.bereiche.splice(this.aktiv, 1); this.aktiv = Math.max(0, this.aktiv - 1);
      this.maxId = null; this.aufbauen();
    });
    setInterval(() => this.speichern(), 4000);
    addEventListener('beforeunload', () => this.speichern());
  }

  async laden(): Promise<void> {
    const l = await body.layout();
    if (l && Array.isArray(l.arbeitsbereiche) && l.arbeitsbereiche.length) {
      this.bereiche = l.arbeitsbereiche as Arbeitsbereich[];
      this.bereiche.forEach(b => umstellen(b.wurzel));
      this.aktiv = Math.min(l.aktiv, this.bereiche.length - 1);
    }
    this.aufbauen();
  }

  wechseln(i: number): void { if (this.bereiche[i]) { this.aktiv = i; this.maxId = null; this.aufbauen(); } }
  maximiertAufheben(): boolean { if (!this.maxId) return false; this.maxId = null; this.aufbauen(); return true; }

  /** Nach Änderungsbenachrichtigung: betroffene Zellen neu zeichnen */
  aktualisieren(bereiche: Bereich[]): void {
    this.zellen().forEach(z => {
      const s = this.sichten.get(z.id);
      if (s && s.bereiche.some(b => bereiche.includes(b))) void this.zeichnen(z);
    });
  }

  // ---------- Aufbau ----------
  private get wurzel(): Knoten { return this.bereiche[this.aktiv]!.wurzel; }
  private set wurzel(k: Knoten) { this.bereiche[this.aktiv]!.wurzel = k; }
  private zellen(k: Knoten = this.wurzel, out: Zelle[] = []): Zelle[] { if (k.t === 'zelle') out.push(k); else k.kinder.forEach(x => this.zellen(x, out)); return out; }

  private aufbauen(): void {
    this.ro.disconnect();
    this.flaeche.innerHTML = '';
    this.sichten.clear(); this.dichten.clear();
    if (this.maxId && !this.zellen().some(z => z.id === this.maxId)) this.maxId = null;
    this.flaeche.appendChild(this.knotenEl(this.wurzel));
    for (const z of this.zellen()) {
      const s = sichtErzeugen(z);
      if (s) { this.sichten.set(z.id, s); z.zustand = s.zustand(); }
      void this.zeichnen(z);
    }
    this.flaeche.querySelectorAll<HTMLElement>('.cb').forEach(cb => this.ro.observe(cb));
    this.tabsZeichnen();
    this.speichern();
  }

  private knotenEl(k: Knoten): HTMLElement {
    if (k.t === 'zelle') return this.zelleEl(k);
    const el = document.createElement('div');
    el.className = `split sp-${k.richtung}`;
    k.kinder.forEach((kind, i) => {
      if (i) el.appendChild(this.trenner(k, i));
      const c = this.knotenEl(kind);
      c.style.flex = `${k.anteile[i]} 1 0`;
      el.appendChild(c);
    });
    return el;
  }

  private zelleEl(z: Zelle): HTMLElement {
    const el = document.createElement('section');
    el.className = 'cell' + (this.maxId === z.id ? ' maxed' : '');
    el.dataset.id = z.id;
    el.innerHTML = `<div class="ch">
      <span class="sicht-icon">${z.sicht ? SICHTEN[z.sicht].icon : ''}</span>
      <select title="Sicht wählen">${z.sicht ? '' : '<option value="">Sicht wählen …</option>'}${(Object.keys(SICHTEN) as SichtArt[]).map(k => `<option value="${k}" ${z.sicht === k ? 'selected' : ''}>${SICHTEN[k].name}</option>`).join('')}</select>
      <span class="info"></span>
      <span class="tools">
        <button data-op="row" title="Nebeneinander teilen">${ICON.row}</button>
        <button data-op="col" title="Untereinander teilen">${ICON.col}</button>
        <button data-op="max" title="Maximieren (Doppelklick auf den Kopf)">${this.maxId === z.id ? ICON.min : ICON.max}</button>
        <button data-op="close" title="Zelle schließen">${ICON.x}</button>
      </span></div><div class="cb"></div>`;
    el.querySelector('select')!.onchange = e => { z.sicht = ((e.target as HTMLSelectElement).value || null) as SichtArt | null; z.zustand = null; this.aufbauen(); };
    el.querySelector<HTMLElement>('.tools')!.onclick = e => {
      const op = (e.target as HTMLElement).closest<HTMLElement>('[data-op]')?.dataset.op;
      if (op === 'row' || op === 'col') this.teilen(z.id, op);
      if (op === 'close') this.schliessen(z.id);
      if (op === 'max') { this.maxId = this.maxId === z.id ? null : z.id; this.aufbauen(); }
    };
    el.querySelector<HTMLElement>('.ch')!.ondblclick = e => {
      if ((e.target as HTMLElement).closest('select, button')) return;
      this.maxId = this.maxId === z.id ? null : z.id; this.aufbauen();
    };
    return el;
  }

  private trenner(k: Split, i: number): HTMLElement {
    const g = document.createElement('div');
    g.className = 'gutter';
    g.onpointerdown = e => {
      g.setPointerCapture(e.pointerId); g.classList.add('drag');
      const a = g.previousElementSibling as HTMLElement, b = g.nextElementSibling as HTMLElement;
      const h = k.richtung === 'row';
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const gesamt = h ? ra.width + rb.width : ra.height + rb.height, summe = k.anteile[i - 1]! + k.anteile[i]!;
      const start = h ? ra.left : ra.top;
      g.onpointermove = ev => {
        const f = Math.max(0.08, Math.min(0.92, ((h ? ev.clientX : ev.clientY) - start) / gesamt));
        k.anteile[i - 1] = summe * f; k.anteile[i] = summe * (1 - f);
        a.style.flex = `${k.anteile[i - 1]} 1 0`; b.style.flex = `${k.anteile[i]} 1 0`;
      };
      g.onpointerup = () => { g.onpointermove = null; g.classList.remove('drag'); this.speichern(); };
    };
    g.ondblclick = () => { const s = k.anteile[i - 1]! + k.anteile[i]!; k.anteile[i - 1] = k.anteile[i] = s / 2; this.aufbauen(); };
    return g;
  }

  // ---------- Zeichnen ----------
  private dichteFuer(el: HTMLElement): Dichte {
    const w = el.clientWidth, h = el.clientHeight;
    if (w < 230 || h < 150) return 'mini';
    if (w >= 640 && h >= 380) return 'full';
    return 'compact';
  }

  private groesseGeaendert(cb: HTMLElement): void {
    const id = cb.closest<HTMLElement>('.cell')?.dataset.id;
    const z = this.zellen().find(x => x.id === id);
    if (z && this.dichteFuer(cb) !== this.dichten.get(z.id)) void this.zeichnen(z);
  }

  private async zeichnen(z: Zelle): Promise<void> {
    const el = this.flaeche.querySelector<HTMLElement>(`.cell[data-id="${z.id}"]`);
    if (!el) return;
    const cb = el.querySelector<HTMLElement>('.cb')!, info = el.querySelector<HTMLElement>('.info')!;
    const dichte = this.dichteFuer(cb);
    this.dichten.set(z.id, dichte);
    const s = this.sichten.get(z.id);
    if (!s) {
      cb.innerHTML = `<div class="picker"><div class="muted">Welche Sicht soll in diese Zelle?</div><div class="opts">${(Object.keys(SICHTEN) as SichtArt[]).map(k => `<button data-pick="${k}"><b>${SICHTEN[k].icon}</b><span>${esc(SICHTEN[k].name)}</span></button>`).join('')}</div></div>`;
      cb.onclick = e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]'); if (b) { z.sicht = b.dataset.pick as SichtArt; z.zustand = null; this.aufbauen(); } };
      info.textContent = '';
      return;
    }
    cb.onclick = null;
    try { await s.render(cb, dichte); }
    catch (e) { cb.innerHTML = `<div class="leer">Fehler beim Zeichnen: ${esc((e as Error).message)}</div>`; }
    info.textContent = '';
  }

  // ---------- Struktur ändern ----------
  private finde(id: string, k: Knoten = this.wurzel, eltern: Split | null = null, idx = -1): { k: Zelle; eltern: Split | null; idx: number } | null {
    if (k.t === 'zelle') return k.id === id ? { k, eltern, idx } : null;
    for (let i = 0; i < k.kinder.length; i++) { const r = this.finde(id, k.kinder[i]!, k, i); if (r) return r; }
    return null;
  }
  private elternVon(ziel: Knoten, k: Knoten = this.wurzel): { k: Split; idx: number } | null {
    if (k.t !== 'split') return null;
    for (let i = 0; i < k.kinder.length; i++) {
      if (k.kinder[i] === ziel) return { k, idx: i };
      const r = this.elternVon(ziel, k.kinder[i]!); if (r) return r;
    }
    return null;
  }

  private teilen(id: string, richtung: 'row' | 'col'): void {
    const f = this.finde(id); if (!f) return;
    const neu = Z(null);
    if (f.eltern && f.eltern.richtung === richtung) {
      const halb = f.eltern.anteile[f.idx]! / 2;
      f.eltern.anteile.splice(f.idx, 1, halb, halb);
      f.eltern.kinder.splice(f.idx + 1, 0, neu);
    } else {
      const sp = S(richtung, [50, 50], [f.k, neu]);
      if (f.eltern) f.eltern.kinder[f.idx] = sp; else this.wurzel = sp;
    }
    this.aufbauen();
  }

  private schliessen(id: string): void {
    const f = this.finde(id); if (!f) return;
    if (!f.eltern) { f.k.sicht = null; f.k.zustand = null; this.aufbauen(); return; }
    const e = f.eltern;
    e.kinder.splice(f.idx, 1);
    const [weg] = e.anteile.splice(f.idx, 1);
    e.anteile[Math.max(0, f.idx - 1)]! += weg!;
    if (e.kinder.length === 1) {
      const einzig = e.kinder[0]!, ge = this.elternVon(e);
      if (!ge) this.wurzel = einzig; else ge.k.kinder[ge.idx] = einzig;
    }
    this.aufbauen();
  }

  // ---------- Arbeitsbereiche ----------
  private tabsZeichnen(): void {
    this.tabs.innerHTML = this.bereiche.map((w, i) => `<button data-ws="${i}" class="${i === this.aktiv ? 'on' : ''}" title="Taste ${i + 1} · Doppelklick: umbenennen">${esc(w.name)}</button>`).join('')
      + `<button class="add" data-ws="neu" title="Neuer Arbeitsbereich">${I.bereichNeu}</button>`
      + (this.bereiche.length > 1 ? `<button class="add" data-zweistufig="arbeitsbereichLoeschen" data-id="aktiv" title="Diesen Arbeitsbereich löschen">${I.bereichLoeschen}</button>` : '');
  }
  private tabKlick(e: Event): void {
    if ((e.target as HTMLElement).closest('.ws-name')) return;
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ws]'); if (!b) return;
    const w = b.dataset.ws!;
    const neu = w === 'neu';
    if (neu) { this.bereiche.push({ name: `Bereich ${this.bereiche.length + 1}`, wurzel: Z(null) }); this.aktiv = this.bereiche.length - 1; }
    else if (Number(w) === this.aktiv) return;
    else this.aktiv = Number(w);
    this.maxId = null; this.aufbauen();
    // neuer Arbeitsbereich: gleich benennen
    if (neu) this.umbenennen(this.aktiv);
  }
  private tabUmbenennen(e: Event): void {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ws]');
    const i = Number(b?.dataset.ws); if (!b || isNaN(i)) return;
    this.umbenennen(i);
  }

  /** Reiter wird zum Eingabefeld (kein Dialog): ↵ oder Klick daneben übernimmt, Esc verwirft, leer = alter Name */
  private umbenennen(i: number): void {
    const knopf = this.tabs.querySelector<HTMLElement>(`[data-ws="${i}"]`);
    if (!knopf) return;
    const alt = this.bereiche[i]!.name;
    const inp = document.createElement('input');
    inp.className = 'ws-name';
    inp.value = alt;
    inp.size = Math.max(6, alt.length + 1);
    knopf.replaceWith(inp);
    inp.focus(); inp.select();
    let fertig = false;
    const ende = (uebernehmen: boolean) => {
      if (fertig) return;
      fertig = true;
      const n = inp.value.trim();
      if (uebernehmen && n && n !== alt) { this.bereiche[i]!.name = n; this.speichern(); }
      this.tabsZeichnen();
    };
    inp.addEventListener('input', () => { inp.size = Math.max(6, inp.value.length + 1); });
    inp.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') ende(true);
      if (ev.key === 'Escape') ende(false);
    });
    inp.addEventListener('blur', () => ende(true));
  }

  private speichern(): void {
    // Zustand der Sichten (Filter, Ansicht, Zoom) in die Zellen übernehmen
    for (const z of this.zellen()) { const s = this.sichten.get(z.id); if (s) z.zustand = s.zustand(); }
    const layout: Layout = { arbeitsbereiche: this.bereiche, aktiv: this.aktiv };
    const json = JSON.stringify(layout);
    if (json === this.gespeichert) return;
    this.gespeichert = json;
    void body.layoutSpeichern({ layout });
  }
}
