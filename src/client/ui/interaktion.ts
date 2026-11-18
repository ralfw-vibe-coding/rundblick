// Globale Interaktion: Klicks auf Aufgaben/Buchungen, Drag & Drop (= Planen), Hervorhebung, freie Buchung per Doppelklick.
import { dauerText, plusTage, relativ, uhrzeit } from '../../basis/datum';
import type { CommandStatus } from '../../body/interface';
import { body } from './body';
import { aufgabeOeffnen, buchungOeffnen, schliessen } from './detail';
import { ICON } from './bausteine';
import { esc, pruefe, toast } from './dom';
import { markieren } from './frisch';
import { H0, H1, SPANMIN } from './sichten/kalender';

let heute = '';
const heuteLaden = async () => { heute = (await body.heute()).datum; };

// ---- Zwei-Klick-Muster für zerstörende Aktionen: Mülleimer → „?“ → ausführen; Klick woanders oder 5 s → zurück
const ZWEISTUFIG: Record<string, (id: string) => Promise<void>> = {
  verwerfen: async id => { pruefe(await body.aufgabeVerwerfen({ aufgabeId: id }), 'Aufgabe verworfen'); },
  stornieren: async id => { pruefe(await body.buchungStornieren({ buchungId: id }), 'Buchung gelöscht'); },
  anhangEntfernen: async id => { const [aufgabeId, anhangId] = id.split('/'); pruefe(await body.anhangEntfernen({ aufgabeId: aufgabeId!, anhangId: anhangId! })); },
};
/** weitere zweistufige Aktionen (z. B. Arbeitsbereich löschen im Raster) */
export function zweistufigRegistrieren(act: string, f: (id: string) => Promise<void>): void { ZWEISTUFIG[act] = f; }
let fragenTimer: ReturnType<typeof setTimeout> | undefined;
function fragenZuruecksetzen(ausser?: Element): void {
  document.querySelectorAll<HTMLElement>('[data-zweistufig].fragen').forEach(b => {
    if (b === ausser) return;
    b.classList.remove('fragen'); b.innerHTML = b.dataset.icon ?? ICON.muell;
  });
}
export function zweistufigAnbinden(nachAusfuehren?: (act: string, id: string) => void): void {
  document.addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-zweistufig]');
    if (!b) { fragenZuruecksetzen(); return; }
    e.stopPropagation(); e.preventDefault();
    const act = b.dataset.zweistufig!, id = b.dataset.id ?? b.closest<HTMLElement>('[data-task]')?.dataset.task ?? '';
    if (!b.classList.contains('fragen')) {
      fragenZuruecksetzen(b);
      b.dataset.icon = b.innerHTML;
      b.classList.add('fragen'); b.textContent = '?'; b.title = 'Nochmal klicken zum Ausführen';
      clearTimeout(fragenTimer);
      fragenTimer = setTimeout(() => fragenZuruecksetzen(), 5000);
      return;
    }
    clearTimeout(fragenTimer);
    fragenZuruecksetzen();
    await ZWEISTUFIG[act]?.(id);
    nachAusfuehren?.(act, id);
  }, true);
}

export function interaktionAnbinden(): void {
  void heuteLaden();

  document.addEventListener('click', async e => {
    const t = e.target as HTMLElement;
    if (t.closest('.drawer, .pop, .einst, .qc')) return;
    const act = t.closest<HTMLElement>('[data-act]');
    if (act) {
      e.stopPropagation();
      const id = act.closest<HTMLElement>('[data-task]')!.dataset.task!;
      if (act.dataset.act === 'abschliessen') pruefe(await body.aufgabeAbschliessen({ aufgabeId: id }), 'Abgeschlossen');
      if (act.dataset.act === 'wiederoeffnen') pruefe(await body.aufgabeWiedereroeffnen({ aufgabeId: id }));
      return;
    }
    const b = t.closest<HTMLElement>('[data-booking]');
    if (b) { void buchungOeffnen(b.dataset.booking!); return; }
    const a = t.closest<HTMLElement>('[data-task]');
    if (a) void aufgabeOeffnen(a.dataset.task!, true);
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') { schliessen(); popZu(); } });

  // ---- Doppelklick ins Reservierungsband oder Zeitraster: freie Buchung eintragen
  document.addEventListener('dblclick', e => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-booking], .ev')) return;
    const rb = t.closest<HTMLElement>('.rb[data-drop-res]'), dc = t.closest<HTMLElement>('.dcol[data-drop-day]');
    if (rb) neueFreieBuchung(e.clientX, e.clientY, rb.dataset.dropRes!, null);
    else if (dc) {
      const r = dc.getBoundingClientRect();
      const min = Math.floor((H0 * 60 + ((e.clientY - r.top) / r.height) * SPANMIN) / 30) * 30;
      neueFreieBuchung(e.clientX, e.clientY, dc.dataset.dropDay!, uhrzeit(Math.max(H0 * 60, Math.min(H1 * 60 - 30, min))));
    }
  });

  // ---- Drag & Drop
  // dauer: Länge des künftigen Termins (Standarddauer bzw. Dauer der Buchung); versatz: Minuten zwischen
  // Oberkante des gezogenen Termins und Mauszeiger – so folgt die Einfügemarke dem Terminbeginn.
  type Zug = { aufgabe: string | null; buchung: string | null; frei: boolean; dauer: number; versatz: number };
  let zug: Zug | null = null;
  let standarddauer = 60;
  const standarddauerLaden = async () => { standarddauer = (await body.einstellungen()).standarddauer; };
  void standarddauerLaden();
  body.beiAenderung(b => { if (b.includes('einstellungen')) void standarddauerLaden(); });
  const ZIELE = '[data-drop-status],[data-drop-res],[data-drop-day],[data-drop-tl],[data-drop-list]';
  document.addEventListener('dragstart', e => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('[data-booking]'), a = t.closest<HTMLElement>('[data-task]');
    if (!a && !b) return;
    zug = { aufgabe: a?.dataset.task ?? null, buchung: b?.dataset.booking ?? null, frei: !!b && !b.dataset.task, dauer: standarddauer, versatz: 0 };
    if (b) {
      const z = zug;
      void body.buchung({ buchungId: b.dataset.booking! }).then(x => { if (x) z.dauer = x.dauer; });
      const spalte = b.closest<HTMLElement>('.dcol');
      if (spalte && b.classList.contains('ev')) {
        z.versatz = ((e.clientY - b.getBoundingClientRect().top) / spalte.getBoundingClientRect().height) * SPANMIN;
      }
    }
    e.dataTransfer!.setData('text/plain', JSON.stringify(zug));
    e.dataTransfer!.effectAllowed = 'copyMove';
  });
  document.addEventListener('dragend', () => { zug = null; markeWeg(); document.querySelectorAll('.over').forEach(x => x.classList.remove('over')); });
  document.addEventListener('dragover', e => {
    const z = (e.target as HTMLElement).closest<HTMLElement>(ZIELE);
    if (!z || !zug) return;
    const zuAufgabe = z.dataset.dropStatus !== undefined || z.dataset.dropList !== undefined;
    if (zuAufgabe && !(zug.buchung ? zug.frei : zug.aufgabe)) return;
    if (z.dataset.dropList !== undefined && !zug.frei) return;
    e.preventDefault();
    document.querySelectorAll('.over').forEach(x => x !== z && x.classList.remove('over'));
    if (z.dataset.dropDay) { z.classList.remove('over'); marke(z, startImRaster(z, e.clientY, zug), zug.dauer); }
    else { markeWeg(); z.classList.add('over'); }
  });
  document.addEventListener('dragleave', e => {
    const z = (e.target as HTMLElement).closest<HTMLElement>('.dcol[data-drop-day]');
    if (z && !z.contains(e.relatedTarget as Node | null)) markeWeg();
  });
  document.addEventListener('drop', async e => {
    const z = (e.target as HTMLElement).closest<HTMLElement>(ZIELE);
    if (!z || !zug) return;
    e.preventDefault();
    z.classList.remove('over');
    markeWeg();
    const { aufgabe, buchung, frei } = zug;
    const platzieren = async (datum: string, start: string | null) => {
      const ort = `${relativ(datum, heute || datum)}${start ? ' ' + start : ''}`;
      if (buchung) { pruefe(await body.buchungAendern({ buchungId: buchung, datum, start }), `${start ? 'Termin' : 'Reservierung'} verschoben: ${ort}`); return; }
      if (aufgabe) pruefe(await body.buchungAnlegen({ aufgabeId: aufgabe, datum, start }), `${start ? 'Termin' : 'Reservierung'} angelegt: ${ort} (Dauer änderbar)`);
    };
    if (z.dataset.dropStatus !== undefined || z.dataset.dropList !== undefined) {
      const status = z.dataset.dropStatus ?? null;
      let r: CommandStatus;
      if (buchung && frei) { r = await body.aufgabeAusBuchung({ buchungId: buchung, status }); if (pruefe(r, 'Aufgabe aus Buchung erstellt') && r.ok) markieren(r.ids!.aufgabeId!); }
      else if (aufgabe && status) pruefe(await body.statusSetzen({ aufgabeId: aufgabe, status }));
    } else if (z.dataset.dropRes) await platzieren(z.dataset.dropRes, null);
    else if (z.dataset.dropDay) await platzieren(z.dataset.dropDay, uhrzeit(startImRaster(z, e.clientY, zug))); else if (z.dataset.dropTl) {
      let host: HTMLElement | null = z;
      while (host && !(host as HTMLElement & { _tl?: unknown })._tl) host = host.parentElement;
      if (!host) return;
      const tl = (host as HTMLElement & { _tl: { start: string; pph: number } })._tl;
      const dayW = (H1 - H0) * tl.pph;
      const xx = e.clientX - z.getBoundingClientRect().left;
      const i = Math.floor(xx / dayW), datum = plusTage(tl.start, i);
      const min = Math.round((H0 * 60 + ((xx - i * dayW) / tl.pph) * 60) / 15) * 15;
      await platzieren(datum, z.dataset.dropTl === 'termin' ? uhrzeit(Math.max(H0 * 60, Math.min(H1 * 60 - 15, min))) : null);
    }
  });

  // ---- Dauer eines Termins durch Ziehen an der Unterkante ändern (15-Minuten-Raster)
  document.addEventListener('pointerdown', e => {
    const griff = (e.target as HTMLElement).closest<HTMLElement>('[data-zieh]');
    if (!griff) return;
    e.preventDefault(); e.stopPropagation();
    const ev = griff.parentElement!, spalte = ev.closest<HTMLElement>('.dcol')!;
    const proPx = SPANMIN / spalte.clientHeight, start = e.clientY, alt = Number(griff.dataset.dauer), hoehe = ev.offsetHeight;
    ev.draggable = false;
    let neu = alt;
    const bewegen = (m: PointerEvent) => {
      neu = Math.max(15, Math.round((alt + (m.clientY - start) * proPx) / 15) * 15);
      ev.style.height = `${hoehe + (neu - alt) / proPx}px`;
      ev.title = dauerText(neu);
    };
    const los = async () => {
      removeEventListener('pointermove', bewegen); removeEventListener('pointerup', los);
      ev.draggable = true;
      if (neu !== alt) pruefe(await body.buchungAendern({ buchungId: griff.dataset.zieh!, dauer: neu }), `Dauer: ${dauerText(neu)}`);
    };
    addEventListener('pointermove', bewegen); addEventListener('pointerup', los);
  }, true);
  document.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-zieh]')) e.stopImmediatePropagation(); }, true);

  // ---- Hervorhebung: Fährt man über eine Aufgabe, leuchten all ihre Darstellungen auf
  let hl: string | null = null;
  document.addEventListener('mouseover', e => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-task]')?.dataset.task ?? null;
    if (id === hl) return;
    document.querySelectorAll('.hl').forEach(x => x.classList.remove('hl'));
    hl = id;
    if (id) document.querySelectorAll(`[data-task="${CSS.escape(id)}"]`).forEach(x => x.classList.add('hl'));
  });
}

// ---------- Einfügemarke beim Ziehen in Tages-, 3-Tages- und Wochenansicht ----------
/** Startminute (15-Minuten-Raster) für die Mausposition in einer Tagesspalte */
function startImRaster(spalte: HTMLElement, clientY: number, z: { dauer: number; versatz: number }): number {
  const r = spalte.getBoundingClientRect();
  const roh = H0 * 60 + ((clientY - r.top) / r.height) * SPANMIN - z.versatz;
  return Math.max(H0 * 60, Math.min(H1 * 60 - 15, Math.round(roh / 15) * 15));
}

let markeEl: HTMLDivElement | null = null;
function marke(spalte: HTMLElement, start: number, dauer: number): void {
  if (!markeEl) { markeEl = document.createElement('div'); markeEl.className = 'einfuegemarke'; }
  if (markeEl.parentElement !== spalte) spalte.appendChild(markeEl);
  const pct = (m: number) => ((m - H0 * 60) / SPANMIN) * 100;
  const ende = Math.min(start + dauer, H1 * 60);
  markeEl.style.top = `${pct(start)}%`;
  markeEl.style.height = `${pct(ende) - pct(start)}%`;
  markeEl.innerHTML = `<span class="zeit">${uhrzeit(start)}–${uhrzeit(start + dauer)}</span>`;
}
function markeWeg(): void { markeEl?.remove(); }

let pop: HTMLDivElement | null = null;
function popZu(): void { pop?.remove(); pop = null; }
document.addEventListener('mousedown', e => { if (pop && !(e.target as HTMLElement).closest('.pop')) popZu(); });

function neueFreieBuchung(x: number, y: number, datum: string, start: string | null): void {
  popZu();
  pop = document.createElement('div');
  pop.className = 'pop';
  pop.style.left = `${Math.min(x, innerWidth - 300)}px`;
  pop.style.top = `${Math.min(y, innerHeight - 110)}px`;
  pop.innerHTML = `<div class="muted" style="font-size:11px;margin-bottom:4px">${start ? 'Termin' : 'Reservierung'} ${esc(relativ(datum, heute || datum))}${start ? ' ' + start : ''} · ohne Aufgabe</div>
    <input placeholder="Titel … (Dauer z. B. 90m am Ende)" /><div class="muted" style="font-size:11px;margin-top:4px"><kbd>↵</kbd> eintragen · <kbd>Esc</kbd> abbrechen</div>`;
  document.body.appendChild(pop);
  const inp = pop.querySelector('input')!;
  inp.focus();
  inp.addEventListener('keydown', async e => {
    if (e.key === 'Escape') popZu();
    if (e.key !== 'Enter' || !inp.value.trim()) return;
    let titel = inp.value.trim(), dauer: number | undefined;
    const m = titel.match(/\s(\d+(?:[.,]\d+)?)(h|m|min)$/);
    if (m) { dauer = Math.round(Number(m[1]!.replace(',', '.')) * (m[2] === 'h' ? 60 : 1)); titel = titel.slice(0, m.index); }
    popZu();
    pruefe(await body.buchungEintragen({ titel, datum, start, dauer }), `Eingetragen: ${titel}${dauer ? ' · ' + dauerText(dauer) : ''}`);
  });
}

export { toast };
