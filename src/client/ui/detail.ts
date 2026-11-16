// Detail-Schublade: Aufgabe oder Buchung ansehen und direkt bearbeiten.
// Jede Feldänderung wird sofort als Command an den Body geschickt.
import { dauerText, kurz, plusTage, WT, wochentag } from '../../basis/datum';
import { body } from './body';
import { buchungArt, kapazitaetsBalken } from './bausteine';
import { esc, pruefe } from './dom';

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

/** Nach Änderungen: offene Schublade aktualisieren (ohne Fokus aus einem Feld zu reißen) */
export async function auffrischen(): Promise<void> {
  if (!aktuell || !offen()) return;
  if (schublade!.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement!.tagName)) return;
  if (aktuell.art === 'aufgabe') await aufgabeOeffnen(aktuell.id); else await buchungOeffnen(aktuell.id);
}

const feld = (label: string, inhalt: string) => `<div class="fld"><label>${label}</label>${inhalt}</div>`;

export async function aufgabeOeffnen(id: string): Promise<void> {
  const [a, e] = await Promise.all([body.aufgabe({ aufgabeId: id }), body.einstellungen()]);
  if (!a) { schliessen(); return; }
  aktuell = { art: 'aufgabe', id };
  const s = el();
  const zu = a.abgeschlossen ? 'disabled' : '';
  s.innerHTML = `<div class="dh"><input class="titel-input" data-f="titel" value="${esc(a.titel)}" ${zu}>${a.abgeschlossen ? '<span class="zustand">✓ abgeschlossen</span>' : ''}<button data-d="zu" title="Schließen (Esc)">×</button></div>
    <div class="db">
      ${feld('Beschreibung', `<textarea data-f="beschreibung" ${zu}>${esc(a.beschreibung)}</textarea>`)}
      <div class="fld-grid">
        ${feld('Status (Board)', `<select data-f="status" ${zu}><option value="">– ohne (nicht auf dem Board) –</option>${e.spalten.map(sp => `<option value="${sp.id}" ${a.status?.id === sp.id ? 'selected' : ''}>${esc(sp.name)}</option>`).join('')}</select>`)}
        ${feld('Verantwortlich', `<input type="text" data-f="verantwortlich" value="${esc(a.verantwortlich)}" list="dl-person" ${zu}>`)}
        ${feld('Frist', `<div class="inl"><input type="date" data-f="frist" value="${a.frist ?? ''}" ${zu}><button data-leer="frist" title="Frist entfernen">×</button></div>`)}
        ${feld('Wiedervorlage', `<div class="inl"><input type="date" data-f="wiedervorlage" value="${a.wiedervorlage ?? ''}" ${zu}><button data-leer="wiedervorlage" title="Wiedervorlage aufheben">×</button></div>`)}
        ${feld('Ort', `<input type="text" data-f="ort" value="${esc(a.ort)}" list="dl-ort" ${zu}>`)}
        ${feld('Tags', `<input type="text" data-f="tags" value="${esc(a.tags.join(', '))}" placeholder="kunde, büro" ${zu}>`)}
      </div>
      ${a.zurueckgestellt ? `<div class="muted" style="font-size:12px">↩ Bis ${WT[wochentag(a.wiedervorlage!)]} ${kurz(a.wiedervorlage!)} zurückgestellt – bis dahin in der Liste eingeklappt.</div>` : ''}
      ${feld(`Buchungen · gebucht ${dauerText(a.buchungen.gebucht)}`, `<div class="bk-list">
        ${a.buchungsliste.map(b => `<div class="bk-item" data-booking="${b.id}"><span class="k ${b.start ? 'term' : 'res'}">${buchungArt(b)}</span><span class="tt">${WT[wochentag(b.datum)]} ${kurz(b.datum)}${b.start ? ' · ' + b.start : ''}${b.titel !== a.titel ? ` <span class="muted">· ${esc(b.titel)}</span>` : ''}</span><span class="muted">${dauerText(b.dauer)}${b.belegt ? '' : ' (frei)'}</span></div>`).join('') || '<div class="muted">Noch keine Buchung. Aufgabe in den Kalender ziehen oder:</div>'}
        ${a.abgeschlossen ? '' : `<button class="btn" data-d="res" style="align-self:flex-start">+ Reservierung morgen · Standarddauer</button>`}</div>`)}
    </div>
    <div class="df">${a.abgeschlossen ? '<button class="btn" data-d="auf">↺ Wieder öffnen</button>' : '<button class="btn ok" data-d="ab">✓ Abschließen</button>'}<span class="spacer"></span><button class="btn danger" data-d="weg" title="Aufgabe verwerfen (verschwindet überall)">Verwerfen</button></div>
    ${datalisten()}`;
  void vorschlaegeLaden(s);
  s.onchange = async ev => {
    const t = ev.target as HTMLInputElement;
    const f = t.dataset.f;
    if (!f) return;
    if (f === 'status') { pruefe(await body.statusSetzen({ aufgabeId: id, status: t.value || null })); return; }
    const wert = f === 'tags' ? t.value.split(/[,\s]+/).filter(Boolean) : (f === 'frist' || f === 'wiedervorlage') ? (t.value || null) : t.value;
    pruefe(await body.aufgabeAendern({ aufgabeId: id, aenderungen: { [f]: wert } }));
  };
  s.onclick = async ev => {
    const t = ev.target as HTMLElement;
    const leer = t.closest<HTMLElement>('[data-leer]');
    if (leer && !a.abgeschlossen) { pruefe(await body.aufgabeAendern({ aufgabeId: id, aenderungen: { [leer.dataset.leer!]: null } })); return; }
    const bk = t.closest<HTMLElement>('.bk-item[data-booking]');
    if (bk) { void buchungOeffnen(bk.dataset.booking!); return; }
    const d = t.closest<HTMLElement>('[data-d]')?.dataset.d;
    if (d === 'zu') schliessen();
    if (d === 'ab' && pruefe(await body.aufgabeAbschliessen({ aufgabeId: id }), 'Abgeschlossen')) void aufgabeOeffnen(id);
    if (d === 'auf' && pruefe(await body.aufgabeWiedereroeffnen({ aufgabeId: id }))) void aufgabeOeffnen(id);
    if (d === 'weg' && confirm(`„${a.titel}“ verwerfen? Die Aufgabe verschwindet aus allen Sichten.`) && pruefe(await body.aufgabeVerwerfen({ aufgabeId: id }), 'Verworfen')) schliessen();
    if (d === 'res') {
      const morgen = plusTage((await body.liste({})).heute, 1);
      if (pruefe(await body.buchungAnlegen({ aufgabeId: id, datum: morgen }), 'Reservierung für morgen angelegt')) void aufgabeOeffnen(id);
    }
  };
  s.classList.add('open');
}

export async function buchungOeffnen(id: string): Promise<void> {
  const b = await body.buchung({ buchungId: id });
  if (!b) { schliessen(); return; }
  aktuell = { art: 'buchung', id };
  const s = el();
  s.innerHTML = `<div class="dh"><input class="titel-input" data-f="titel" value="${esc(b.titel)}"><button data-d="zu" title="Schließen (Esc)">×</button></div>
    <div class="db">
      ${feld('Beschreibung', `<textarea data-f="beschreibung">${esc(b.beschreibung)}</textarea>`)}
      <div class="fld-grid">
        ${feld('Datum', `<input type="date" data-f="datum" value="${b.datum}">`)}
        ${feld('Uhrzeit', `<div class="inl"><input type="time" data-f="start" value="${b.start ?? ''}"><button data-leer="start" title="Uhrzeit entfernen → Reservierung">×</button></div>`)}
      </div>
      ${feld('Dauer', `<span class="dur"><button data-dur="-15">−</button><b>${dauerText(b.dauer)}</b><button data-dur="15">+</button></span><span class="durq">${[30, 45, 60, 90, 120, 180, 240].map(m => `<button data-dauer="${m}" class="${b.dauer === m ? 'on' : ''}">${dauerText(m).replace(' ', '')}</button>`).join('')}</span>`)}
      ${feld('Kapazität', `<label style="display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink)"><input type="checkbox" data-f="belegt" ${b.belegt ? 'checked' : ''}> belegt ${dauerText(b.dauer)} der Tageskapazität</label>`)}
      <div class="muted" style="font-size:12px">${buchungArt(b)} · ${b.start ? 'mit Uhrzeit' : 'ohne Uhrzeit – erscheint im Reservierungsband'}</div>
      ${b.aufgabeId
        ? feld('Gehört zu Aufgabe', `<a href="#" data-d="aufgabe" style="color:var(--own)">${esc(b.aufgabentitel)}</a>`)
        : '<div class="muted" style="line-height:1.5;font-size:12px">Freie Buchung ohne Aufgabe. Wird mehr daraus: „→ Aufgabe daraus machen“ – Titel und Beschreibung wandern mit, die Buchung bleibt und gehört dann zur Aufgabe. Oder die Buchung auf Liste/Board ziehen.</div>'}
      ${feld('Tagesauslastung', `<div>${dauerText(b.tag.belegt)} von ${dauerText(b.tag.kapazitaet)}${kapazitaetsBalken(b.tag, true)}</div>`)}
    </div>
    <div class="df">${b.aufgabeId ? '' : '<button class="btn primary" data-d="aufgabeMachen">→ Aufgabe daraus machen</button>'}<span class="spacer"></span><button class="btn danger" data-d="storno">Buchung löschen</button></div>`;
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
      if (pruefe(r, 'Aufgabe erstellt') && r.ok) void aufgabeOeffnen(r.ids!.aufgabeId!);
    }
    if (d === 'storno' && pruefe(await body.buchungStornieren({ buchungId: id }), 'Buchung gelöscht')) schliessen();
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

