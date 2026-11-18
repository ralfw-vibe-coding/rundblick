// Uhrzeitfeld statt des nativen <input type="time">: Textfeld + Auswahlliste in Viertelstunden.
// Tippen: „930“, „9:30“, „9.30“, „9“ → 09:30 / 09:00; krumme Minuten werden auf die Viertelstunde gerundet.
// ↑/↓ = ±15 min, ↵ übernimmt, Esc schließt. Leer ist erlaubt. Nach jeder Übernahme feuert das Feld
// ein normales 'change'-Ereignis – bestehende Handler (data-f / data-b) funktionieren unverändert.
import { body } from './body';
import { esc } from './dom';

/** HTML für ein Uhrzeitfeld; `attribute` z. B. 'data-f="start"' */
export function uhrzeitFeld(attribute: string, wert: string | null, titel = ''): string {
  return `<input type="text" class="uhrzeit" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="--:--" ${attribute} value="${esc(wert ?? '')}"${titel ? ` title="${esc(titel)}"` : ''}>`;
}

const SCHRITT = 15;
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Freie Eingabe → „HH:MM“ auf Viertelstunden gerundet; '' bleibt leer; null = nicht verstanden */
export function uhrzeitLesen(text: string): string | null {
  const t = text.trim();
  if (!t) return '';
  let h: number, m: number;
  const mit = t.match(/^(\d{1,2})\s*[:.,h]\s*(\d{1,2})?$/);
  if (mit) { h = Number(mit[1]); m = Number(mit[2] ?? 0); if (mit[2]?.length === 1) m *= 10; }
  else if (/^\d{1,4}$/.test(t)) { h = t.length <= 2 ? Number(t) : Number(t.slice(0, t.length - 2)); m = t.length <= 2 ? 0 : Number(t.slice(-2)); }
  else return null;
  if (h > 23 || m > 59) return null;
  const gesamt = Math.min(23 * 60 + 45, Math.round((h * 60 + m) / SCHRITT) * SCHRITT);
  return hm(gesamt);
}

let liste: HTMLDivElement | null = null;
let feld: HTMLInputElement | null = null;
let tageszeit = { von: 7, bis: 21 };

function schliessen(): void { liste?.remove(); liste = null; feld = null; }

function uebernehmen(f: HTMLInputElement, wert: string): void {
  const vorher = f.dataset.wert ?? f.defaultValue;
  f.value = wert;
  f.dataset.wert = wert;
  if (wert !== vorher) f.dispatchEvent(new Event('change', { bubbles: true }));
}

function oeffnen(f: HTMLInputElement): void {
  schliessen();
  feld = f;
  f.dataset.wert ??= f.value;
  liste = document.createElement('div');
  liste.className = 'uhrzeit-liste';
  const aktuell = uhrzeitLesen(f.value) || null;
  let h = '';
  for (let min = 0; min < 24 * 60; min += SCHRITT) {
    const z = hm(min), ausser = min < tageszeit.von * 60 || min >= tageszeit.bis * 60;
    h += `<button type="button" data-zeit="${z}" class="${ausser ? 'ausser' : ''} ${z === aktuell ? 'gewaehlt' : ''} ${min % 60 === 0 ? 'voll' : ''}">${z}</button>`;
  }
  liste.innerHTML = h;
  document.body.appendChild(liste);
  const r = f.getBoundingClientRect();
  const unten = innerHeight - r.bottom > 230;
  liste.style.left = `${Math.min(r.left, innerWidth - 110)}px`;
  liste.style.top = unten ? `${r.bottom + 4}px` : `${r.top - 4 - 220}px`;
  // an die gewählte Uhrzeit bzw. den Beginn der Tageszeit scrollen
  const ziel = liste.querySelector<HTMLElement>(`[data-zeit="${aktuell ?? hm(tageszeit.von * 60)}"]`);
  if (ziel) liste.scrollTop = ziel.offsetTop - 88;
  liste.addEventListener('mousedown', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-zeit]');
    if (!b) return;
    e.preventDefault();
    uebernehmen(f, b.dataset.zeit!);
    schliessen();
    f.blur();
  });
}

function markieren(wert: string | null): void {
  if (!liste) return;
  liste.querySelectorAll('.gewaehlt').forEach(x => x.classList.remove('gewaehlt'));
  const b = wert ? liste.querySelector<HTMLElement>(`[data-zeit="${wert}"]`) : null;
  if (b) { b.classList.add('gewaehlt'); b.scrollIntoView({ block: 'nearest' }); }
}

/** einmal beim Start: Verhalten für alle .uhrzeit-Felder (auch später gezeichnete) */
export function uhrzeitfelderAnbinden(): void {
  const tageszeitLaden = async () => { tageszeit = (await body.einstellungen()).tageszeit; };
  void tageszeitLaden();
  body.beiAenderung(b => { if (b.includes('einstellungen')) void tageszeitLaden(); });

  document.addEventListener('focusin', e => {
    const f = (e.target as HTMLElement).closest<HTMLInputElement>('input.uhrzeit');
    if (f && f !== feld) { oeffnen(f); f.select(); }
  });
  document.addEventListener('mousedown', e => {
    const t = e.target as HTMLElement;
    if (liste && !t.closest('.uhrzeit-liste') && t !== feld) schliessen();
    const f = t.closest<HTMLInputElement>('input.uhrzeit');
    if (f && f === document.activeElement && !liste) oeffnen(f);
  });
  // ursprüngliche 'change'-Ereignisse des Textfelds abfangen – übernommen wird erst normalisiert
  document.addEventListener('change', e => {
    const f = e.target as HTMLElement;
    if (f instanceof HTMLInputElement && f.classList.contains('uhrzeit') && e.isTrusted) e.stopImmediatePropagation();
  }, true);
  document.addEventListener('input', e => {
    const f = e.target as HTMLInputElement;
    if (f.classList?.contains('uhrzeit')) markieren(uhrzeitLesen(f.value));
  });
  document.addEventListener('keydown', e => {
    const f = e.target as HTMLInputElement;
    if (!(f instanceof HTMLInputElement) || !f.classList.contains('uhrzeit')) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const z = uhrzeitLesen(f.value) || hm(tageszeit.von * 60);
      const [hh, mm] = z.split(':').map(Number);
      const min = Math.max(0, Math.min(23 * 60 + 45, hh! * 60 + mm! + (e.key === 'ArrowUp' ? -SCHRITT : SCHRITT)));
      f.value = hm(min);
      markieren(f.value);
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      f.blur();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      f.value = f.dataset.wert ?? f.defaultValue;
      schliessen(); f.blur();
    }
  }, true);
  document.addEventListener('focusout', e => {
    const f = e.target as HTMLInputElement;
    if (!(f instanceof HTMLInputElement) || !f.classList.contains('uhrzeit')) return;
    const w = uhrzeitLesen(f.value);
    if (w === null) f.value = f.dataset.wert ?? f.defaultValue;   // Unverständliches verwerfen
    else uebernehmen(f, w);
    if (feld === f) schliessen();
  });
}
