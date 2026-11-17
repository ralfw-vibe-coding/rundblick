// Detail-Schublade: Aufgabe oder Buchung ansehen und direkt bearbeiten.
// Jede Feldänderung wird sofort als Command an den Body geschickt.
// Kopf: [Abschließen-Kreis] Titel … [Archiv] [Mülleimer] [×]
import { dauerText, kurz, plusTage, WT, wochentag } from '../../basis/datum';
import type { AufgabeDetails } from '../../body/interface';
import { body } from './body';
import { buchungArt, ICON, kapazitaetsBalken, muellKnopf, statusPunkt } from './bausteine';
import { esc, pruefe } from './dom';
import { markieren } from './frisch';

let schublade: HTMLDivElement | null = null;
let aktuell: { art: 'aufgabe' | 'buchung'; id: string } | null = null;

function el(): HTMLDivElement {
  if (schublade) return schublade;
  schublade = document.createElement('div');
  schublade.className = 'drawer';
  document.body.appendChild(schublade);
  return schublade;
}

export function schliessen(): void { schublade?.classList.remove('open'); aktuell = null; }
export const offen = () => !!schublade?.classList.contains('open');
/** schließt die Schublade, falls sie gerade dieses Objekt zeigt (z. B. nach dem Verwerfen) */
export function schliessenWenn(id: string): void { if (aktuell?.id === id) schliessen(); }

/** Nach Änderungen: offene Schublade aktualisieren (ohne Fokus aus einem Feld zu reißen) */
export async function auffrischen(): Promise<void> {
  if (!aktuell || !offen()) return;
  if (schublade!.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement!.tagName)) return;
  if (aktuell.art === 'aufgabe') await aufgabeOeffnen(aktuell.id); else await buchungOeffnen(aktuell.id);
}

const feld = (label: string, inhalt: string, extra = '') => `<div class="fld" ${extra}><label>${label}</label>${inhalt}</div>`;
const knopf = (d: string, icon: string, titel: string) => `<button class="kopfknopf" data-d="${d}" title="${esc(titel)}">${icon}</button>`;

export async function aufgabeOeffnen(id: string): Promise<void> {
  const [a, e, h] = await Promise.all([body.aufgabe({ aufgabeId: id }), body.einstellungen(), body.heute()]);
  if (!a) { schliessen(); return; }
  aktuell = { art: 'aufgabe', id };
  const s = el();
  const gesperrt = a.abgeschlossen || a.archiviert;
  const zu = gesperrt ? 'disabled' : '';
  const morgen = plusTage(h.datum, 1);
  s.innerHTML = `
    <div class="dh">
      <button class="chk ${a.abgeschlossen ? 'an' : ''}" data-d="${a.abgeschlossen ? 'auf' : 'ab'}" title="${a.abgeschlossen ? 'Wieder öffnen' : 'Abschließen'}" ${a.archiviert ? 'disabled' : ''}></button>
      <input class="titel-input" data-f="titel" value="${esc(a.titel)}" ${zu}>
      ${a.archiviert ? knopf('ausArchiv', ICON.ausArchiv, 'Aus dem Archiv holen') : knopf('archiv', ICON.archiv, 'Archivieren – verbergen, nicht löschen')}
      ${muellKnopf('verwerfen', 'Aufgabe verwerfen', id)}
      ${knopf('zu', ICON.zu, 'Schließen (Esc)')}
    </div>
    <div class="db aufgabe">
      ${a.archiviert ? '<div class="hinweis">Archiviert – überall verborgen. Zum Bearbeiten erst aus dem Archiv holen.</div>' : a.abgeschlossen ? '<div class="hinweis" style="background:#e9f7ee;color:#1f6b46">✓ Abgeschlossen – zum Bearbeiten wieder öffnen (Kreis links oben).</div>' : ''}
      ${feld('Status', `<div class="statuschips">
        <button class="schip ${a.status ? '' : 'an'}" data-status="" ${zu}>ohne</button>
        ${e.spalten.map(sp => `<button class="schip ${a.status?.id === sp.id ? 'an' : ''}" data-status="${sp.id}" ${zu}>${statusPunkt(sp.id)}${esc(sp.name)}</button>`).join('')}
      </div>`)}
      <div class="fld-grid">
        ${feld('Frist', `<div class="inl"><input type="date" data-f="frist" value="${a.frist ?? ''}" ${zu}><button data-leer="frist" title="Frist entfernen">×</button></div>`)}
        ${feld('Wiedervorlage', `<div class="inl"><input type="date" data-f="wiedervorlage" value="${a.wiedervorlage ?? ''}" ${zu}><button data-leer="wiedervorlage" title="Wiedervorlage aufheben">×</button></div>`)}
        ${feld('Verantwortlich', `<input type="text" data-f="verantwortlich" value="${esc(a.verantwortlich)}" list="dl-person" ${zu}>`)}
        ${feld('Ort', `<input type="text" data-f="ort" value="${esc(a.ort)}" list="dl-ort" ${zu}>`)}
      </div>
      ${feld('Tags', `<input type="text" data-f="tags" value="${esc(a.tags.join(', '))}" placeholder="kunde, büro" ${zu}>`)}
      ${a.zurueckgestellt ? `<div class="muted" style="font-size:12px">↩ Bis ${WT[wochentag(a.wiedervorlage!)]} ${kurz(a.wiedervorlage!)} zurückgestellt – bis dahin in der Liste eingeklappt.</div>` : ''}
      ${feld('Notiz', `<textarea data-f="beschreibung" placeholder="Notizen, Details, Links …" ${zu}>${esc(a.beschreibung)}</textarea>`, 'style="flex:1;display:flex;flex-direction:column;min-height:120px"')}
      ${gesperrt ? '' : feld('Buchung hinzufügen', `<div class="buchen">
        <input type="date" data-b="datum" value="${morgen}" title="Datum">
        <input type="time" data-b="start" title="Uhrzeit – leer lassen für eine Reservierung">
        <select data-b="dauer" title="Dauer">${[15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480].map(m => `<option value="${m}" ${m === e.standarddauer ? 'selected' : ''}>${dauerText(m)}</option>`).join('')}</select>
        <button class="btn primary" data-d="buchen">Buchen</button></div>`)}
      ${feld(`Buchungen · gebucht ${dauerText(a.buchungen.gebucht)}`, `<div class="bk-list">${buchungsliste(a)}</div>`)}
    </div>
    ${datalisten()}`;
  void vorschlaegeLaden(s);
  s.onchange = async ev => {
    const t = ev.target as HTMLInputElement;
    const f = t.dataset.f;
    if (!f) return;
    const wert = f === 'tags' ? t.value.split(/[,\s]+/).filter(Boolean) : (f === 'frist' || f === 'wiedervorlage') ? (t.value || null) : t.value;
    pruefe(await body.aufgabeAendern({ aufgabeId: id, aenderungen: { [f]: wert } }));
  };
  s.onclick = async ev => {
    const t = ev.target as HTMLElement;
    const st = t.closest<HTMLElement>('[data-status]');
    if (st && !gesperrt) { if (pruefe(await body.statusSetzen({ aufgabeId: id, status: st.dataset.status || null }))) void aufgabeOeffnen(id); return; }
    const leer = t.closest<HTMLElement>('[data-leer]');
    if (leer && !gesperrt) { pruefe(await body.aufgabeAendern({ aufgabeId: id, aenderungen: { [leer.dataset.leer!]: null } })); return; }
    const bk = t.closest<HTMLElement>('.bk-item[data-booking]');
    if (bk) { void buchungOeffnen(bk.dataset.booking!); return; }
    const d = t.closest<HTMLElement>('[data-d]')?.dataset.d;
    if (d === 'zu') schliessen();
    if (d === 'ab' && pruefe(await body.aufgabeAbschliessen({ aufgabeId: id }), 'Abgeschlossen')) void aufgabeOeffnen(id);
    if (d === 'auf' && pruefe(await body.aufgabeWiedereroeffnen({ aufgabeId: id }))) void aufgabeOeffnen(id);
    if (d === 'archiv' && pruefe(await body.aufgabeArchivieren({ aufgabeId: id }), 'Archiviert')) schliessen();
    if (d === 'ausArchiv' && pruefe(await body.aufgabeAusArchivHolen({ aufgabeId: id }), 'Aus dem Archiv geholt')) { markieren(id); void aufgabeOeffnen(id); }
    if (d === 'buchen') {
      const w = (k: string) => s.querySelector<HTMLInputElement>(`[data-b="${k}"]`)!.value;
      const r = await body.buchungAnlegen({ aufgabeId: id, datum: w('datum'), start: w('start') || null, dauer: Number(w('dauer')) });
      if (pruefe(r, `${w('start') ? 'Termin' : 'Reservierung'} gebucht`)) void aufgabeOeffnen(id);
    }
  };
  s.classList.add('open');
}

function buchungsliste(a: AufgabeDetails): string {
  return a.buchungsliste.map(b => `<div class="bk-item" data-booking="${b.id}"><span class="k ${b.start ? 'term' : 'res'}">${buchungArt(b)}</span><span class="tt">${WT[wochentag(b.datum)]} ${kurz(b.datum)}${b.start ? ' · ' + b.start : ''}${b.titel !== a.titel ? ` <span class="muted">· ${esc(b.titel)}</span>` : ''}</span><span class="muted">${dauerText(b.dauer)}${b.belegt ? '' : ' (frei)'}</span></div>`).join('')
    || '<div class="muted" style="font-size:12px">Noch keine Buchung. Oben buchen oder die Aufgabe in den Kalender ziehen.</div>';
}

export async function buchungOeffnen(id: string): Promise<void> {
  const b = await body.buchung({ buchungId: id });
  if (!b) { schliessen(); return; }
  aktuell = { art: 'buchung', id };
  const s = el();
  s.innerHTML = `<div class="dh"><input class="titel-input" data-f="titel" value="${esc(b.titel)}">${muellKnopf('stornieren', 'Buchung löschen', id)}${knopf('zu', ICON.zu, 'Schließen (Esc)')}</div>
    <div class="db">
      <div class="fld-grid">
        ${feld('Datum', `<input type="date" data-f="datum" value="${b.datum}">`)}
        ${feld('Uhrzeit', `<div class="inl"><input type="time" data-f="start" value="${b.start ?? ''}"><button data-leer="start" title="Uhrzeit entfernen → Reservierung">×</button></div>`)}
      </div>
      ${feld('Dauer', `<span class="dur"><button data-dur="-15">−</button><b>${dauerText(b.dauer)}</b><button data-dur="15">+</button></span><span class="durq">${[30, 45, 60, 90, 120, 180, 240].map(m => `<button data-dauer="${m}" class="${b.dauer === m ? 'on' : ''}">${dauerText(m).replace(' ', '')}</button>`).join('')}</span>`)}
      ${feld('Kapazität', `<label style="display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink)"><input type="checkbox" data-f="belegt" ${b.belegt ? 'checked' : ''}> belegt ${dauerText(b.dauer)} der Tageskapazität</label>`)}
      <div class="muted" style="font-size:12px">${buchungArt(b)} · ${b.start ? 'mit Uhrzeit' : 'ohne Uhrzeit – erscheint im Reservierungsband'}</div>
      ${b.aufgabeId
        ? feld('Gehört zu Aufgabe', `<a href="#" data-d="aufgabe" style="color:var(--own)">${esc(b.aufgabentitel)}</a>`)
        : '<div class="muted" style="line-height:1.5;font-size:12px">Freie Buchung ohne Aufgabe. Wird mehr daraus: „→ Aufgabe daraus machen“ – Titel und Notiz wandern mit, die Buchung bleibt und gehört dann zur Aufgabe. Oder die Buchung auf Liste/Board ziehen.</div>'}
      ${feld('Notiz', `<textarea data-f="beschreibung">${esc(b.beschreibung)}</textarea>`)}
      ${feld('Tagesauslastung', `<div>${dauerText(b.tag.belegt)} von ${dauerText(b.tag.kapazitaet)}${kapazitaetsBalken(b.tag, true)}</div>`)}
    </div>
    ${b.aufgabeId ? '' : '<div class="df"><button class="btn primary" data-d="aufgabeMachen">→ Aufgabe daraus machen</button></div>'}`;
  const aendern = async (x: Parameters<typeof body.buchungAendern>[0]) => { if (pruefe(await body.buchungAendern(x))) void buchungOeffnen(id); };
  s.onchange = async ev => {
    const t = ev.target as HTMLInputElement;
    const f = t.dataset.f;
    if (f === 'belegt') return aendern({ buchungId: id, belegt: t.checked });
    if (f === 'start') return aendern({ buchungId: id, start: t.value || null });
    if (f === 'datum' && t.value) return aendern({ buchungId: id, datum: t.value });
    if (f === 'titel' || f === 'beschreibung') return aendern({ buchungId: id, [f]: t.value });
  };
  s.onclick = async ev => {
    const t = ev.target as HTMLElement;
    if (t.closest('[data-leer="start"]')) return aendern({ buchungId: id, start: null });
    const dur = t.closest<HTMLElement>('[data-dur],[data-dauer]');
    if (dur) return aendern({ buchungId: id, dauer: dur.dataset.dauer ? Number(dur.dataset.dauer) : Math.max(15, b.dauer + Number(dur.dataset.dur)) });
    const d = t.closest<HTMLElement>('[data-d]')?.dataset.d;
    if (d === 'zu') schliessen();
    if (d === 'aufgabe') { ev.preventDefault(); void aufgabeOeffnen(b.aufgabeId!); }
    if (d === 'aufgabeMachen') {
      const r = await body.aufgabeAusBuchung({ buchungId: id });
      if (pruefe(r, 'Aufgabe erstellt') && r.ok) { markieren(r.ids!.aufgabeId!); void aufgabeOeffnen(r.ids!.aufgabeId!); }
    }
  };
  s.classList.add('open');
}

function datalisten(): string { return '<datalist id="dl-person"></datalist><datalist id="dl-ort"></datalist>'; }
async function vorschlaegeLaden(s: HTMLElement): Promise<void> {
  const [p, o] = await Promise.all([body.vorschlaege({ art: 'person', praefix: '' }), body.vorschlaege({ art: 'ort', praefix: '' })]);
  const dp = s.querySelector('#dl-person'), dor = s.querySelector('#dl-ort');
  if (dp) dp.innerHTML = p.map(x => `<option value="${esc(x)}">`).join('');
  if (dor) dor.innerHTML = o.map(x => `<option value="${esc(x)}">`).join('');
}
