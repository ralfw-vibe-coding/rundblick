// Globale Interaktion: Klicks auf Aufgaben/Buchungen, Drag & Drop (= Planen), Hervorhebung, freie Buchung per Doppelklick.
import { dauerText, plusTage, relativ, uhrzeit } from '../../basis/datum';
import type { CommandStatus } from '../../body/interface';
import { body } from './body';
import { aufgabeOeffnen, buchungOeffnen, schliessen } from './detail';
import { esc, pruefe, toast } from './dom';
import { H0, H1, SPANMIN } from './sichten/kalender';

let heute = '';
const heuteLaden = async () => { heute = (await body.board()).heute; };

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
    if (a) void aufgabeOeffnen(a.dataset.task!);
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
  type Zug = { aufgabe: string | null; buchung: string | null; frei: boolean };
  let zug: Zug | null = null;
  const ZIELE = '[data-drop-status],[data-drop-res],[data-drop-day],[data-drop-tl],[data-drop-list]';
  document.addEventListener('dragstart', e => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('[data-booking]'), a = t.closest<HTMLElement>('[data-task]');
    if (!a && !b) return;
    zug = { aufgabe: a?.dataset.task ?? null, buchung: b?.dataset.booking ?? null, frei: !!b && !b.dataset.task };
    e.dataTransfer!.setData('text/plain', JSON.stringify(zug));
    e.dataTransfer!.effectAllowed = 'copyMove';
  });
  document.addEventListener('dragend', () => { zug = null; document.querySelectorAll('.over').forEach(x => x.classList.remove('over')); });
  document.addEventListener('dragover', e => {
    const z = (e.target as HTMLElement).closest<HTMLElement>(ZIELE);
    if (!z || !zug) return;
    const zuAufgabe = z.dataset.dropStatus !== undefined || z.dataset.dropList !== undefined;
    if (zuAufgabe && !(zug.buchung ? zug.frei : zug.aufgabe)) return;
    if (z.dataset.dropList !== undefined && !zug.frei) return;
    e.preventDefault();
    document.querySelectorAll('.over').forEach(x => x !== z && x.classList.remove('over'));
    z.classList.add('over');
  });
  document.addEventListener('drop', async e => {
    const z = (e.target as HTMLElement).closest<HTMLElement>(ZIELE);
    if (!z || !zug) return;
    e.preventDefault();
    z.classList.remove('over');
    const { aufgabe, buchung, frei } = zug;
    const platzieren = async (datum: string, start: string | null) => {
      const ort = `${relativ(datum, heute || datum)}${start ? ' ' + start : ''}`;
      if (buchung) { pruefe(await body.buchungAendern({ buchungId: buchung, datum, start }), `${start ? 'Termin' : 'Reservierung'} verschoben: ${ort}`); return; }
      if (aufgabe) pruefe(await body.buchungAnlegen({ aufgabeId: aufgabe, datum, start }), `${start ? 'Termin' : 'Reservierung'} angelegt: ${ort} (Dauer änderbar)`);
    };
    if (z.dataset.dropStatus !== undefined || z.dataset.dropList !== undefined) {
      const status = z.dataset.dropStatus ?? null;
      let r: CommandStatus;
      if (buchung && frei) { r = await body.aufgabeAusBuchung({ buchungId: buchung, status }); pruefe(r, 'Aufgabe aus Buchung erstellt'); }
      else if (aufgabe && status) pruefe(await body.statusSetzen({ aufgabeId: aufgabe, status }));
    } else if (z.dataset.dropRes) await platzieren(z.dataset.dropRes, null);
    else if (z.dataset.dropDay) {
      const r = z.getBoundingClientRect();
      const min = Math.round((H0 * 60 + ((e.clientY - r.top) / r.height) * SPANMIN) / 15) * 15;
      await platzieren(z.dataset.dropDay, uhrzeit(Math.max(H0 * 60, Math.min(H1 * 60 - 15, min))));
    } else if (z.dataset.dropTl) {
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
