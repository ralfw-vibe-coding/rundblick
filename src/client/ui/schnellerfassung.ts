// Schnellerfassung in der Kopfzeile: eine Zeile, Vorschau als Chips, ↵ legt an.
import { dauerText, kurz, WT, wochentag } from '../../basis/datum';
import type { ErfassungVorschau } from '../../body/interface';
import { body } from './body';
import { statusPunkt } from './bausteine';
import { esc, pruefe } from './dom';
import { markieren } from './frisch';

const SYNTAX = `<code>#tag</code> <code>@person</code> <code>/ort</code> <code>!fr</code> Frist · <code>^1.12.</code> Wiedervorlage · <code>=inarbeit</code> Status · <code>&gt;do 2h</code> Reservierung · <code>&gt;morgen 14:00 1h</code> Termin<br>Zeile beginnt mit <code>&gt;</code> → nur Buchung ohne Aufgabe, z. B. <code>&gt;fr 17:00 45m Friseur</code><br>Datum: <code>heute</code> <code>morgen</code> <code>mo…so</code> <code>+3</code> <code>+2w</code> <code>24.12.</code>`;
const tag = (d: string) => `${WT[wochentag(d)]} ${kurz(d)}`;

function chips(p: ErfassungVorschau): string {
  const c: string[] = [];
  p.tags.forEach(t => c.push(`<span class="chip tag">#${esc(t)}</span>`));
  if (p.verantwortlich) c.push(`<span class="chip person">@${esc(p.verantwortlich)}</span>`);
  if (p.ort) c.push(`<span class="chip ort">⌖ ${esc(p.ort)}</span>`);
  if (p.frist) c.push(`<span class="chip frist">◆ Frist ${tag(p.frist)}</span>`);
  if (p.wiedervorlage) c.push(`<span class="chip wv">↩ unsichtbar bis ${tag(p.wiedervorlage)}</span>`);
  if (p.status) c.push(`<span class="chip status">${statusPunkt(p.status.id)}${esc(p.status.name)} → Board</span>`);
  if (p.nurBuchung) c.push('<span class="chip" style="background:#e5e7eb">nur Buchung · keine Aufgabe</span>');
  if (p.buchung) c.push(`<span class="chip res">${p.buchung.start ? '■ Termin' : '▭ Reservierung'} ${tag(p.buchung.datum)}${p.buchung.start ? ' ' + p.buchung.start : ''} · ${dauerText(p.buchung.dauer)}</span>`);
  p.fehler.forEach(f => c.push(`<span class="chip err" title="nicht verstanden">${esc(f)}</span>`));
  return c.join('');
}

export function schnellerfassungAnbinden(root: HTMLElement): HTMLInputElement {
  root.classList.add('qc');
  root.innerHTML = `<span class="plus">+</span><input placeholder="Neue Aufgabe … z. B. „Angebot Müller #kunde !fr &gt;mi 2h“" /><span class="hint"><kbd>N</kbd></span>
    <div class="qc-preview"><div class="pt"></div><div class="chips"></div><div class="syntax">${SYNTAX}</div></div>`;
  const inp = root.querySelector('input')!;
  let lauf = 0;
  const vorschau = async () => {
    const n = ++lauf;
    const p = await body.erfassungVorschau({ text: inp.value });
    if (n !== lauf) return;
    root.querySelector('.pt')!.textContent = p.titel || 'Titel fehlt noch …';
    root.querySelector('.chips')!.innerHTML = chips(p) || `<span class="muted">→ landet in der Liste${p.status ? '' : ' (ohne Status nicht auf dem Board)'}</span>`;
  };
  inp.addEventListener('focus', () => { root.classList.add('open'); void vorschau(); });
  inp.addEventListener('blur', () => setTimeout(() => root.classList.remove('open'), 150));
  inp.addEventListener('input', () => void vorschau());
  inp.addEventListener('keydown', async e => {
    if (e.key === 'Escape') { inp.value = ''; inp.blur(); }
    if (e.key !== 'Enter' || !inp.value.trim()) return;
    const text = inp.value;
    const r = await body.schnellErfassen({ text });
    if (r.ok && r.ids?.aufgabeId) markieren(r.ids.aufgabeId);
    if (pruefe(r, `Erfasst: ${(await body.erfassungVorschau({ text })).titel}`)) { inp.value = ''; void vorschau(); }
  });
  return inp;
}
