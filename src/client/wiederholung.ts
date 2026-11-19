// Eingabefelder für Wiederholungen – von Desktop- und Phone-Client geteilt.
import { NAMEN } from '../basis/wiederholung';
import type { Wiederholung } from '../body/interface';

/** Eingabefelder „alle [n] [Einheit]“ – gelesen mit wiederholungLesen */
export function wiederholungFelder(w: Wiederholung | null, gesperrt: boolean, ohneFrist: boolean): string {
  const aus = gesperrt || ohneFrist ? 'disabled' : '';
  const titel = ohneFrist ? 'title="Wiederholung braucht eine Frist"' : '';
  return `<span class="wh" ${titel}>alle <input type="number" min="1" max="999" data-wh="alle" value="${w?.alle ?? 1}" ${aus}>
    <select data-wh="einheit" ${aus}><option value="" ${w ? '' : 'selected'}>– nicht –</option>${(['tag', 'woche', 'monat', 'jahr'] as const).map(e => `<option value="${e}" ${w?.einheit === e ? 'selected' : ''}>${NAMEN[e][(w?.alle ?? 1) === 1 ? 0 : 1]}</option>`).join('')}</select></span>`;
}

export function wiederholungLesen(huelle: ParentNode): Wiederholung | null {
  const einheit = huelle.querySelector<HTMLSelectElement>('[data-wh="einheit"]')?.value as Wiederholung['einheit'] | '';
  const alle = Math.max(1, Math.min(999, Math.round(Number(huelle.querySelector<HTMLInputElement>('[data-wh="alle"]')?.value) || 1)));
  return einheit ? { einheit, alle } : null;
}
