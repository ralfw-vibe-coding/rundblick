// Sicht: Logbuch – was an einem Tag abgehakt wurde (Aufgaben, Checklisten-Punkte) und Notizen.
// Endlos: neuester Tag oben, beim Scrollen werden ältere Tage nachgeladen. Oben: Notiz schreiben (↵ speichert,
// ⇧↵ neue Zeile, #tags werden übernommen), Filter, Sprung zu einem Datum.
import { jahr, MON_LANG, monat, relativ, tagImMonat, WT_LANG, wochentag } from '../../../basis/datum';
import type { Bereich, LogEintrag, Logbuch } from '../../../body/interface';
import { body } from '../body';
import { muellKnopf } from '../bausteine';
import { ausgewaehlt, ausgewaehlteNotiz, notizOeffnen } from '../detail';
import { esc, pruefe } from '../dom';
import { alter, einmalZeigen, istFrisch, markieren } from '../frisch';
import { I } from '../icons';
import type { Dichte, Sicht } from './sicht';

export type LogbuchZustand = { filter?: string };
const PORTION = 14;

export class LogbuchSicht implements Sicht {
  readonly bereiche: Bereich[] = ['aufgaben'];
  private anzahl = PORTION;
  /** null = ab heute; sonst nach einem Datumssprung ab diesem Tag */
  private ab: string | null = null;
  private weiter: string | null = null;
  private laedt = false;
  private el: HTMLElement | null = null;
  private dichte: Dichte = 'full';
  constructor(private z: LogbuchZustand = {}) {}
  zustand() { return this.z; }

  async render(el: HTMLElement, dichte: Dichte): Promise<void> {
    this.el = el; this.dichte = dichte;
    if (dichte === 'mini') return this.mini(el);
    if (!el.querySelector(':scope > .logbuch')) this.geruest(el);
    const lb = await body.logbuch({ bis: this.ab, tage: this.anzahl, filter: this.z.filter ?? '' });
    this.weiter = lb.weiter;
    const b = el.querySelector<HTMLElement>('.lb-b')!;
    const scroll = b.scrollTop;
    b.innerHTML = tageHtml(lb, dichte === 'full') + (lb.weiter ? '<div class="lb-mehr muted">ältere Tage werden geladen …</div>' : lb.tage.length > 1 || lb.tage[0]?.eintraege.length ? '<div class="lb-ende muted">Anfang des Logbuchs</div>' : '');
    b.scrollTop = scroll;
    el.querySelector<HTMLElement>('.lb-heute')!.hidden = !this.ab;
    b.querySelectorAll<HTMLElement>('.lb-e.frisch').forEach(r => {
      r.style.animationDelay = `-${alter(r.dataset.notizId ?? '')}ms`;
      if (einmalZeigen(r.dataset.notizId ?? '')) r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    this.beobachten(b);
  }

  private geruest(el: HTMLElement): void {
    el.innerHTML = `<div class="logbuch">
      <div class="lb-kopf">
        <div class="lb-neu">${I.notiz}<textarea rows="1" placeholder="Notiz für heute …  (↵ speichert, ⇧↵ neue Zeile, #tag)"></textarea></div>
        <div class="lb-werkzeug">
          <input class="lb-filter" placeholder="Filtern: Text, #tag …" value="${esc(this.z.filter ?? '')}">
          <button class="btn lb-heute" title="Zurück zu heute" hidden>Heute</button>
          <input type="date" class="lb-datum" title="Zu einem Tag springen">
        </div>
      </div>
      <div class="lb-b"></div></div>`;
    const ta = el.querySelector('textarea')!;
    const hoehe = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(160, ta.scrollHeight)}px`; };
    ta.addEventListener('input', hoehe);
    ta.addEventListener('keydown', async e => {
      if (e.key === 'Escape') { ta.value = ''; hoehe(); ta.blur(); return; }
      if (e.key !== 'Enter' || e.shiftKey || !ta.value.trim()) return;
      e.preventDefault();
      const r = await body.notizErfassen({ text: ta.value });
      if (pruefe(r) && r.ok) { ta.value = ''; hoehe(); this.ab = null; markieren(r.ids!.notizId!); }
    });
    const filter = el.querySelector<HTMLInputElement>('.lb-filter')!;
    let t: ReturnType<typeof setTimeout>;
    filter.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { this.z.filter = filter.value; this.anzahl = PORTION; void this.neu(); }, 150); });
    const datum = el.querySelector<HTMLInputElement>('.lb-datum')!;
    datum.addEventListener('change', () => { if (datum.value) { this.ab = datum.value; this.anzahl = PORTION; el.querySelector('.lb-b')!.scrollTop = 0; void this.neu(); } });
    el.querySelector<HTMLElement>('.lb-heute')!.onclick = () => { this.ab = null; datum.value = ''; this.anzahl = PORTION; el.querySelector('.lb-b')!.scrollTop = 0; void this.neu(); };
    // Doppelklick auf eine Notiz öffnet sie direkt im Bearbeiten-Modus
    el.addEventListener('dblclick', e => { const n = (e.target as HTMLElement).closest<HTMLElement>('[data-notiz-id]'); if (n) void notizOeffnen(n.dataset.notizId!, true); });
  }

  /** Endlos: kommt das Ende in Sicht, die nächste Portion laden */
  private beobachten(b: HTMLElement): void {
    const mehr = b.querySelector('.lb-mehr');
    if (!mehr) return;
    const io = new IntersectionObserver(async eintraege => {
      if (!eintraege.some(x => x.isIntersecting) || this.laedt || !this.weiter) return;
      io.disconnect();
      this.laedt = true;
      this.anzahl += PORTION;
      try { await this.neu(); } finally { this.laedt = false; }
    }, { root: b, rootMargin: '200px' });
    io.observe(mehr);
  }

  private async neu(): Promise<void> { if (this.el) await this.render(this.el, this.dichte); }

  private async mini(el: HTMLElement): Promise<void> {
    const lb = await body.logbuch({ tage: 1 });
    const t = lb.tage[0];
    const n = t?.datum === lb.heute ? t.eintraege.length : 0;
    el.innerHTML = `<div class="mini">
      <div class="kpi"><b>${n}</b> heute im Logbuch</div>
      <div class="peek">${(t?.datum === lb.heute ? t.eintraege : []).slice(-6).reverse().map(e => `<div ${attrs(e)}>${symbol(e)} ${esc(titel(e))}</div>`).join('')}</div>
    </div>`;
  }
}

function tagKopf(datum: string, heute: string): string {
  const rel = relativ(datum, heute);
  const lang = `${WT_LANG[wochentag(datum)]}, ${tagImMonat(datum)}. ${MON_LANG[monat(datum)]}${jahr(datum) !== jahr(heute) ? ' ' + jahr(datum) : ''}`;
  return rel === 'Heute' || rel === 'Gestern' || rel === 'Morgen' ? `<b>${rel}</b> <span class="muted">${lang}</span>` : `<b>${lang}</b>`;
}

function tageHtml(lb: Logbuch, voll: boolean): string {
  const gewaehlt = ausgewaehlt(), notizGewaehlt = ausgewaehlteNotiz();
  return lb.tage.map(t => `
    <section class="lb-tag ${t.datum === lb.heute ? 'heute' : ''}">
      <div class="lb-tag-h">${tagKopf(t.datum, lb.heute)}<span class="n">${t.eintraege.length || ''}</span></div>
      ${t.eintraege.length ? t.eintraege.map(e => eintragHtml(e, voll, e.art === 'notiz' ? e.notizId === notizGewaehlt : e.aufgabeId === gewaehlt)).join('')
        : '<div class="lb-leer muted">Noch nichts abgehakt oder notiert.</div>'}
    </section>`).join('');
}

const titel = (e: LogEintrag) => (e.art === 'punkt' ? e.text : e.titel);
const symbol = (e: LogEintrag) => (e.art === 'aufgabe' ? I.erledigt : e.art === 'punkt' ? I.punkt : I.notiz);
const attrs = (e: LogEintrag) => (e.art === 'notiz' ? `data-notiz-id="${esc(e.notizId)}"` : `data-task="${esc(e.aufgabeId)}"`);

function eintragHtml(e: LogEintrag, voll: boolean, gewaehlt: boolean): string {
  const tags = e.art !== 'punkt' ? e.tags.map(t => `<span class="chip tag">#${esc(t)}</span>`).join('') : '';
  const frisch = e.art === 'notiz' && istFrisch(e.notizId);
  const zusatz = e.art === 'punkt' ? `<span class="lb-aus muted">aus ${esc(e.aufgabentitel)}</span>`
    : e.art === 'notiz' && e.vorschau && voll ? `<div class="lb-vorschau muted">${esc(e.vorschau)}</div>` : '';
  const rechts = e.art === 'notiz'
    ? `${e.bilder ? `<span class="bk-i anh" title="${e.bilder} Bild(er)">${I.anhang}<b>${e.bilder}</b></span>` : ''}${muellKnopf('notizVerwerfen', 'Notiz löschen', e.notizId)}`
    : e.art === 'aufgabe' && e.archiviert ? `<span class="muted" title="archiviert">${I.archiv}</span>` : '';
  return `<div class="lb-e lb-${e.art} ${gewaehlt ? 'gewaehlt' : ''} ${frisch ? 'frisch' : ''}" ${attrs(e)}>
    <span class="lb-zeit">${e.uhrzeit ?? ''}</span>
    <span class="lb-sym">${symbol(e)}</span>
    <div class="lb-inhalt"><div class="lb-titel">${esc(titel(e))}${e.art === 'punkt' ? ' ' + zusatz : ''}</div>${e.art === 'notiz' ? zusatz : ''}${tags ? `<div class="lb-tags">${tags}</div>` : ''}</div>
    <div class="lb-rechts">${rechts}</div>
  </div>`;
}
