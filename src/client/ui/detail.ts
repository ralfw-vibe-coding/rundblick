// Detail-Schublade: Aufgabe oder Buchung ansehen und direkt bearbeiten.
// Jede Feldänderung wird sofort als Command an den Body geschickt.
// Kopf: [Abschließen-Kreis] Titel … [Archiv] [Mülleimer] [×]
import { wiederholungFelder, wiederholungLesen } from '../wiederholung';
import { dauerText, kurz, plusTage, uhrzeit, WT, wochentag } from '../../basis/datum';
import type { AufgabeDetails } from '../../body/interface';
import { body } from './body';
import { buchungArt, ICON, kapazitaetsBalken, muellKnopf, statusPunkt } from './bausteine';
import { esc, pruefe } from './dom';
import { uhrzeitFeld } from './uhrzeitfeld';
import { markieren } from './frisch';
import { kalenderWahlAnbinden, kalenderWahlHtml } from './kalenderwahl';
import { I } from './icons';
import { chipFeld } from './chipfeld';
import { notizFeld } from './notiz';
import { anhaengeHtml, bilderHinzufuegen, grossansicht, vorschauenLaden } from './anhaenge';

let schublade: HTMLDivElement | null = null;
let aktuell: { art: 'aufgabe' | 'buchung' | 'notiz'; id: string } | null = null;

function el(): HTMLDivElement {
  if (schublade) return schublade;
  schublade = document.createElement('div');
  schublade.className = 'drawer';
  document.body.appendChild(schublade);
  // Bilder per Drag & Drop oder aus der Zwischenablage an die geöffnete Aufgabe hängen
  const ziel = () => ((aktuell?.art === 'aufgabe' || aktuell?.art === 'notiz') && offen() && schublade!.querySelector('.anh-hinweis') ? aktuell.id : null);
  const art = () => (aktuell?.art === 'notiz' ? 'notiz' : 'aufgabe');
  const mitDateien = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  schublade.addEventListener('dragover', e => { if (mitDateien(e) && ziel()) { e.preventDefault(); schublade!.classList.add('bild-drop'); } });
  schublade.addEventListener('dragleave', e => { if (!schublade!.contains(e.relatedTarget as Node)) schublade!.classList.remove('bild-drop'); });
  schublade.addEventListener('drop', e => {
    schublade!.classList.remove('bild-drop');
    const id = ziel();
    if (!mitDateien(e) || !id) return;
    e.preventDefault(); e.stopPropagation();
    void bilderHinzufuegen(id, [...e.dataTransfer!.files], art());
  });
  document.addEventListener('paste', e => {
    const id = ziel();
    const dateien = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/'));
    if (!id || !dateien.length) return;
    e.preventDefault();
    void bilderHinzufuegen(id, dateien, art());
  });
  return schublade;
}

export function schliessen(): void { schublade?.classList.remove('open'); aktuell = null; auswahlMelden(); }
/** Die in der Schublade geöffnete Aufgabe – Sichten heben sie hervor und halten sie im Blick */
export function ausgewaehlt(): string | null { return aktuell?.art === 'aufgabe' && offen() ? aktuell.id : null; }
let gemeldet: string | null = null;
function auswahlMelden(): void { const a = ausgewaehlt(); if (a !== gemeldet) { gemeldet = a; dispatchEvent(new CustomEvent('rb-auswahl')); } }
export const offen = () => !!schublade?.classList.contains('open');
/** schließt die Schublade, falls sie gerade dieses Objekt zeigt (z. B. nach dem Verwerfen) */
export function schliessenWenn(id: string): void { if (aktuell?.id === id) schliessen(); }

/** Nach Änderungen: offene Schublade aktualisieren (ohne Fokus aus einem Feld zu reißen) */
export async function auffrischen(): Promise<void> {
  if (!aktuell || !offen()) return;
  // Wird gerade getippt, nur die Teile ohne Eingabefelder auffrischen (Bilder, Buchungen) – der Cursor bleibt, wo er ist
  if (schublade!.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement!.tagName)) {
    if (aktuell.art === 'aufgabe') await teileAuffrischen(aktuell.id);
    if (aktuell.art === 'notiz') await notizTeileAuffrischen(aktuell.id);
    return;
  }
  if (aktuell.art === 'aufgabe') await aufgabeOeffnen(aktuell.id);
  else if (aktuell.art === 'notiz') await notizOeffnen(aktuell.id);
  else await buchungOeffnen(aktuell.id);
}

const feld = (label: string, inhalt: string, extra = '') => `<div class="fld" ${extra}><label>${label}</label>${inhalt}</div>`;
const knopf = (d: string, icon: string, titel: string) => `<button class="kopfknopf" data-d="${d}" title="${esc(titel)}">${icon}</button>`;

export async function aufgabeOeffnen(id: string, fokus = false): Promise<void> {
  const [a, e, h] = await Promise.all([body.aufgabe({ aufgabeId: id }), body.einstellungen(), body.heute()]);
  if (!a) { schliessen(); return; }
  // Öffnen = gesehen: verlässt „Neu“ auf allen Geräten (ohne Wirkung, wenn sie nicht neu war)
  void body.aufgabeGesehen({ aufgabeId: id });
  aktuell = { art: 'aufgabe', id };
  const s = el();
  const gesperrt = a.abgeschlossen || a.archiviert;
  const zu = gesperrt ? 'disabled' : '';
  const morgen = plusTage(h.datum, 1);
  s.innerHTML = `
    <div class="dh">
      <button class="chk ${a.abgeschlossen ? 'an' : ''}" data-d="${a.abgeschlossen ? 'auf' : 'ab'}" title="${a.abgeschlossen ? 'Wieder öffnen' : 'Abschließen'}" ${a.archiviert ? 'disabled' : ''}>${a.abgeschlossen ? I.erledigt : I.offen}</button>
      <input class="titel-input" data-f="titel" value="${esc(a.titel)}" ${zu}>
      ${a.archiviert ? knopf('ausArchiv', ICON.ausArchiv, 'Aus dem Archiv holen') : knopf('archiv', ICON.archiv, 'Archivieren – verbergen, nicht löschen')}
      ${muellKnopf('verwerfen', 'Aufgabe verwerfen', id)}
      ${knopf('zu', ICON.zu, 'Schließen (Esc)')}
    </div>
    <div class="db aufgabe">
      ${a.archiviert ? '<div class="hinweis">Archiviert – überall verborgen. Zum Bearbeiten erst aus dem Archiv holen.</div>' : a.abgeschlossen ? `<div class="hinweis" style="background:#e9f7ee;color:#1f6b46">${I.erledigt} Abgeschlossen – zum Bearbeiten wieder öffnen (Kreis links oben).</div>` : ''}
      ${feld('Status', `<div class="statuschips">
        <button class="schip ${a.status ? '' : 'an'}" data-status="" ${zu}>ohne</button>
        ${e.spalten.map(sp => `<button class="schip ${a.status?.id === sp.id ? 'an' : ''}" data-status="${sp.id}" ${zu}>${statusPunkt(sp.id)}${esc(sp.name)}</button>`).join('')}
      </div>`)}
      <div class="fld-grid">
        ${feld('Frist', `<div class="inl"><input type="date" data-f="frist" value="${a.frist ?? ''}" ${zu}><button data-leer="frist" title="Frist entfernen">${I.x}</button></div>`)}
        ${feld('Wiederholung', wiederholungFelder(a.wiederholung, gesperrt, !a.frist), 'title="ab Frist – nach dem Abhaken springt die Frist auf den nächsten Termin"')}
        ${feld('Wiedervorlage', `<div class="inl"><input type="date" data-f="wiedervorlage" value="${a.wiedervorlage ?? ''}" ${zu}><button data-leer="wiedervorlage" title="Wiedervorlage aufheben">${I.x}</button></div>`)}
        ${feld('Verantwortlich', '<div data-chips="person"></div>')}
        ${feld('Ort', '<div data-chips="ort"></div>')}
      </div>
      ${feld('Tags', '<div data-chips="tag"></div>')}
      ${a.zurueckgestellt ? `<div class="muted hinweis-zeile">${I.wiedervorlage} Bis ${WT[wochentag(a.wiedervorlage!)]} ${kurz(a.wiedervorlage!)} zurückgestellt – bis dahin in der Liste eingeklappt.</div>` : ''}
      ${feld('Notiz', '<div data-notiz></div>', 'style="flex:1;display:flex;flex-direction:column;min-height:140px"')}
      ${a.anhangliste.length || !gesperrt ? anhaengeHtml(a.anhangliste, id, gesperrt) : ''}
      ${gesperrt ? '' : feld('Buchung hinzufügen', `<div class="buchen">
        <input type="date" data-b="datum" value="${morgen}" title="Datum">
        ${uhrzeitFeld('data-b="start"', null, 'Uhrzeit – leer lassen für eine Reservierung')}
        <select data-b="dauer" title="Dauer">${[15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480].map(m => `<option value="${m}" ${m === e.standarddauer ? 'selected' : ''}>${dauerText(m)}</option>`).join('')}</select>
        <button class="btn primary" data-d="buchen">Buchen</button></div>`)}
      ${feld(`Buchungen · gebucht ${dauerText(a.buchungen.gebucht)}`, `<div class="bk-list">${buchungsliste(a)}</div>`)}
    </div>
`;
  const aendern = async (x: Parameters<typeof body.aufgabeAendern>[0]['aenderungen']) => { pruefe(await body.aufgabeAendern({ aufgabeId: id, aenderungen: x })); };
  chipFeld(s.querySelector('[data-chips="person"]')!, { art: 'person', werte: a.verantwortlich ? [a.verantwortlich] : [], mehrfach: false, gesperrt, platzhalter: 'Name …', aendern: w => void aendern({ verantwortlich: w[0] ?? '' }) });
  chipFeld(s.querySelector('[data-chips="ort"]')!, { art: 'ort', werte: a.ort ? [a.ort] : [], mehrfach: false, gesperrt, platzhalter: 'Ort …', aendern: w => void aendern({ ort: w[0] ?? '' }) });
  chipFeld(s.querySelector('[data-chips="tag"]')!, { art: 'tag', werte: a.tags, mehrfach: true, gesperrt, platzhalter: 'Tag …  ↵', aendern: w => void aendern({ tags: w }) });
  notizFeld(s.querySelector('[data-notiz]')!, { text: a.beschreibung, gesperrt, fokus, speichern: t => aendern({ beschreibung: t }) });
  vorschauenLaden(s);
  s.onchange = async ev => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.wh) { if (pruefe(await body.aufgabeAendern({ aufgabeId: id, aenderungen: { wiederholung: wiederholungLesen(s) } }))) void aufgabeOeffnen(id); return; }
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
    const bild = t.closest<HTMLElement>('.anh-bild[data-anhang]');
    if (bild && !t.closest('.anh-x')) { grossansicht(bild.dataset.anhang!); return; }
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
  auswahlMelden();
}

async function teileAuffrischen(id: string): Promise<void> {
  const a = await body.aufgabe({ aufgabeId: id });
  if (!a || aktuell?.id !== id || !schublade) return;
  const gesperrt = a.abgeschlossen || a.archiviert;
  const anh = schublade.querySelector('.anhaenge');
  if (anh) { anh.outerHTML = anhaengeHtml(a.anhangliste, id, gesperrt); vorschauenLaden(schublade); }
  const bl = schublade.querySelector('.bk-list');
  if (bl) bl.innerHTML = buchungsliste(a);
}

function buchungsliste(a: AufgabeDetails): string {
  return a.buchungsliste.map(b => `<div class="bk-item" data-booking="${b.id}"><span class="k ${b.start ? 'term' : 'res'}">${buchungArt(b)}</span><span class="tt">${WT[wochentag(b.datum)]} ${kurz(b.datum)}${b.start ? ' · ' + b.start : ''}${b.titel !== a.titel ? ` <span class="muted">· ${esc(b.titel)}</span>` : ''}</span><span class="muted">${dauerText(b.dauer)}${b.belegt ? '' : ' (frei)'}</span></div>`).join('')
    || '<div class="muted" style="font-size:12px">Noch keine Buchung. Oben buchen oder die Aufgabe in den Kalender ziehen.</div>';
}

export async function buchungOeffnen(id: string): Promise<void> {
  const [b, e] = await Promise.all([body.buchung({ buchungId: id }), body.einstellungen()]);
  if (!b) { schliessen(); return; }
  // nur beschreibbare Kalender, die in den Einstellungen sichtbar geschaltet sind
  const ziele = e.kalender.filter(k => k.schreibbar && k.sichtbar);
  aktuell = { art: 'buchung', id };
  const s = el();
  s.innerHTML = `<div class="dh"><input class="titel-input" data-f="titel" value="${esc(b.titel)}">${muellKnopf('stornieren', 'Buchung löschen', id)}${knopf('zu', ICON.zu, 'Schließen (Esc)')}</div>
    <div class="db">
      <div class="fld-grid">
        ${feld('Datum', `<input type="date" data-f="datum" value="${b.datum}">`)}
        ${feld('Uhrzeit', `<div class="inl">${uhrzeitFeld('data-f="start"', b.start)}<button data-leer="start" title="Uhrzeit entfernen → Reservierung">${I.x}</button></div>`)}
      </div>
      ${feld('Dauer', `<span class="dur"><button data-dur="-15">${I.minus}</button><b>${dauerText(b.dauer)}</b><button data-dur="15">${I.plus}</button></span><span class="durq">${[30, 45, 60, 90, 120, 180, 240].map(m => `<button data-dauer="${m}" class="${b.dauer === m ? 'on' : ''}">${dauerText(m).replace(' ', '')}</button>`).join('')}</span>`)}
      ${feld('Kapazität', `<label style="display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink)"><input type="checkbox" data-f="belegt" ${b.belegt ? 'checked' : ''}> belegt ${dauerText(b.dauer)} der Tageskapazität</label>`)}
      <div class="muted" style="font-size:12px">${buchungArt(b)} · ${b.start ? 'mit Uhrzeit' : 'ohne Uhrzeit – erscheint im Reservierungsband'}</div>
      ${b.hinweis ? `<div class="hinweis-zeile">${I.warnung}<span>${esc(b.hinweis)}</span></div>` : ''}
      ${feld('Google / iCloud', b.spiegel
        ? `<div class="spiegel-zeile"><span class="lk" style="--kf:${b.spiegel.farbe}">${I.spiegel}</span><span>${b.spiegel.ursprung === 'extern' ? 'Übernommen aus' : 'Gespiegelt in'} <b>${esc(b.spiegel.kalender)}</b>${b.spiegel.konto ? ` · ${esc(b.spiegel.konto)}` : ''}</span><button class="btn" data-d="loesen" title="Spiegelung beenden – Buchung und externer Eintrag bleiben">${I.spiegelLoesen} Verknüpfung lösen</button></div>
           <div class="muted" style="font-size:11px;margin-top:4px">${b.spiegel.ursprung === 'extern'
             ? `Der Termin war zuerst in ${esc(b.spiegel.kalender)}: Beim Löschen der Buchung bleibt er dort erhalten.`
             : `Beim Löschen der Buchung wird auch der Eintrag in ${esc(b.spiegel.kalender)} gelöscht.`}</div>`
        : !b.start
          ? '<div class="muted" style="font-size:12px">Nur Termine (mit Uhrzeit) lassen sich in Google/iCloud spiegeln.</div>'
          : ziele.length
            ? `<div class="spiegel-zeile">${kalenderWahlHtml(ziele)}<button class="btn" data-d="spiegeln" title="Termin im gewählten Kalender anlegen und synchron halten">${I.spiegel} Spiegeln</button></div>`
            : '<div class="muted" style="font-size:12px">Kein sichtbarer, beschreibbarer Kalender – in den Einstellungen einen Kalender sichtbar schalten (bzw. Kalenderzugriff prüfen).</div>')}
      ${b.aufgabeId
        ? feld('Gehört zu Aufgabe', `<a href="#" data-d="aufgabe" style="color:var(--own)">${esc(b.aufgabentitel)}</a>`)
        : '<div class="muted" style="line-height:1.5;font-size:12px">Freie Buchung ohne Aufgabe. Wird mehr daraus: „→ Aufgabe daraus machen“ – Titel und Notiz wandern mit, die Buchung bleibt und gehört dann zur Aufgabe. Oder die Buchung auf Liste/Board ziehen.</div>'}
      ${feld('Notiz', '<div data-notiz></div>')}
      ${feld('Tagesauslastung', `<div>${dauerText(b.tag.belegt)} von ${dauerText(b.tag.kapazitaet)}${kapazitaetsBalken(b.tag, true)}</div>`)}
    </div>
    ${b.aufgabeId ? '' : '<div class="df"><button class="btn primary" data-d="aufgabeMachen">→ Aufgabe daraus machen</button></div>'}`;
  kalenderWahlAnbinden(s);
  const aendern = async (x: Parameters<typeof body.buchungAendern>[0]) => { if (pruefe(await body.buchungAendern(x))) void buchungOeffnen(id); };
  notizFeld(s.querySelector('[data-notiz]')!, { text: b.beschreibung, gesperrt: false, fokus: false, speichern: async t => { pruefe(await body.buchungAendern({ buchungId: id, beschreibung: t })); } });
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
    if (d === 'spiegeln') {
      const ziel = s.querySelector<HTMLElement>('[data-kwahl]')!.dataset.wert!;
      if (pruefe(await body.buchungSpiegeln({ buchungId: id, kalenderId: ziel }), 'Gespiegelt')) void buchungOeffnen(id);
    }
    if (d === 'loesen' && pruefe(await body.verknuepfungLoesen({ buchungId: id }), 'Verknüpfung gelöst')) void buchungOeffnen(id);
    if (d === 'aufgabe') { ev.preventDefault(); void aufgabeOeffnen(b.aufgabeId!); }
    if (d === 'aufgabeMachen') {
      const r = await body.aufgabeAusBuchung({ buchungId: id });
      if (pruefe(r, 'Aufgabe erstellt') && r.ok) { markieren(r.ids!.aufgabeId!); void aufgabeOeffnen(r.ids!.aufgabeId!); }
    }
  };
  s.classList.add('open');
  auswahlMelden();
}

// ---------- Externer Termin (Google/iCloud) ----------
// Nur lesen; von Hand lässt sich daraus eine Aufgabe machen (die Buchung bleibt mit dem Termin verknüpft).
// Löschen (zweistufig) entfernt ihn im Google-/iCloud-Kalender – bei Serien nur dieses Vorkommen.
export async function externOeffnen(externId: string, datum: string): Promise<void> {
  const z = await body.zeitraum({ von: datum, bis: datum });
  const x = z.tage[0]?.extern.find(e => e.id === externId);
  if (!x) { schliessen(); return; }
  aktuell = null;
  const s = el();
  const zeit = x.start === null ? 'ganztägig' : `${uhrzeit(x.start)}–${uhrzeit(x.ende!)}`;
  s.innerHTML = `<div class="dh"><span class="lk gross" style="--kf:${x.farbe}" title="${esc(x.kalender)}">${I.tag}</span><div class="titel-input" style="flex:1">${esc(x.titel)}</div>${x.loeschbar ? muellKnopf('externLoeschen', x.serie ? `Nur diesen Termin der Serie in „${x.kalender}“ löschen` : `Termin in „${x.kalender}“ löschen`, externId) : ''}${knopf('zu', ICON.zu, 'Schließen (Esc)')}</div>
    <div class="db">
      <div class="fld-grid">
        ${feld('Wann', `<div>${WT[wochentag(x.datum)]} ${kurz(x.datum)} · ${zeit}</div>`)}
        ${feld('Kalender', `<div><span class="sdot" style="background:${x.farbe}"></span> ${esc(x.kalender)}${x.konto ? ` · ${esc(x.konto)}` : ''}</div>`)}
      </div>
      ${x.ort ? feld('Ort', `<div>${esc(x.ort)}</div>`) : ''}
      ${x.notiz ? feld('Notiz', `<div style="white-space:pre-wrap">${esc(x.notiz)}</div>`) : ''}
      <div class="muted" style="font-size:12px;line-height:1.5">Externer Termin – bearbeitet wird er in der Kalender-App${x.loeschbar ? `; der Mülleimer löscht ihn dort${x.serie ? ' (nur diesen Termin der Serie)' : ''}` : ' (Kalender ist schreibgeschützt)'}. ${x.start === null ? 'Ganztägige Termine lassen sich nicht übernehmen.' : 'Wird eine Aufgabe daraus, bleibt ihre Buchung mit diesem Termin verknüpft (Änderungen gehen in beide Richtungen).'}</div>
    </div>
    ${x.start === null ? '' : `<div class="df"><button class="btn primary" data-d="ausExtern">${I.zurAufgabe} Aufgabe daraus machen</button></div>`}`;
  s.onchange = null;
  s.onclick = async ev => {
    const d = (ev.target as HTMLElement).closest<HTMLElement>('[data-d]')?.dataset.d;
    if (d === 'zu') schliessen();
    if (d === 'ausExtern') {
      const r = await body.aufgabeAusExtern({ externId });
      if (pruefe(r, 'Aufgabe erstellt') && r.ok) { markieren(r.ids!.aufgabeId!); void aufgabeOeffnen(r.ids!.aufgabeId!); }
    }
  };
  s.classList.add('open');
}

// ---------- Notiz (Logbuch) ----------
// Kopf: [Notiz-Symbol] Titel (= erste Zeile) … [→ Aufgabe] [Mülleimer] [×]
// Darunter: Datum · Tags · Notiz (Markdown, füllt den Rest) · Bilder
/** Die in der Schublade geöffnete Notiz – das Logbuch hebt sie hervor */
export function ausgewaehlteNotiz(): string | null { return aktuell?.art === 'notiz' && offen() ? aktuell.id : null; }

export async function notizOeffnen(id: string, fokus = false): Promise<void> {
  const n = await body.notiz({ notizId: id });
  if (!n) { schliessen(); return; }
  aktuell = { art: 'notiz', id };
  const s = el();
  const titel = n.text.split('\n').map(z => z.trim()).find(Boolean)?.replace(/^#+\s*/, '') ?? '';
  s.innerHTML = `
    <div class="dh">
      <span class="notiz-symbol" title="Notiz im Logbuch">${I.notiz}</span>
      <div class="titel-anzeige" title="Titel = erste Zeile der Notiz">${esc(titel)}</div>
      ${knopf('zurAufgabe', I.zurAufgabe, 'Aufgabe daraus machen – Text, Tags und Bilder wandern mit')}
      ${muellKnopf('notizVerwerfen', 'Notiz löschen', id)}
      ${knopf('zu', ICON.zu, 'Schließen (Esc)')}
    </div>
    <div class="db notizschublade">
      <div class="fld-grid">
        ${feld('Tag im Logbuch', `<input type="date" data-f="datum" value="${n.datum}">`)}
        ${feld('Erfasst', `<div class="muted" style="padding-top:6px">${n.erfasst ? new Date(n.erfasst).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–'}</div>`)}
      </div>
      ${feld('Tags', '<div data-chips="tag"></div>')}
      ${feld('Notiz', '<div data-notiz></div>', 'style="flex:1;display:flex;flex-direction:column;min-height:180px"')}
      ${anhaengeHtml(n.anhangliste, id, false, 'notiz')}
    </div>`;
  chipFeld(s.querySelector('[data-chips="tag"]')!, { art: 'tag', werte: n.tags, mehrfach: true, gesperrt: false, platzhalter: 'Tag …  ↵', aendern: async w => { pruefe(await body.notizAendern({ notizId: id, tags: w })); } });
  notizFeld(s.querySelector('[data-notiz]')!, { text: n.text, gesperrt: false, fokus, speichern: async t => { if (pruefe(await body.notizAendern({ notizId: id, text: t })) && aktuell?.id === id) titelSetzen(t); } });
  vorschauenLaden(s);
  s.onchange = async ev => {
    const t = ev.target as HTMLInputElement;
    if (t.dataset.f === 'datum' && t.value) pruefe(await body.notizAendern({ notizId: id, datum: t.value }));
  };
  s.onclick = async ev => {
    const t = ev.target as HTMLElement;
    const bild = t.closest<HTMLElement>('.anh-bild[data-anhang]');
    if (bild && !t.closest('.anh-x')) { grossansicht(bild.dataset.anhang!); return; }
    const d = t.closest<HTMLElement>('[data-d]')?.dataset.d;
    if (d === 'zu') schliessen();
    if (d === 'zurAufgabe') {
      const r = await body.aufgabeAusNotiz({ notizId: id });
      if (pruefe(r, 'Aufgabe aus der Notiz erstellt') && r.ok) { markieren(r.ids!.aufgabeId!); void aufgabeOeffnen(r.ids!.aufgabeId!); }
    }
  };
  s.classList.add('open');
  auswahlMelden();
  dispatchEvent(new CustomEvent('rb-auswahl'));
}

function titelSetzen(text: string): void {
  const t = schublade?.querySelector('.titel-anzeige');
  if (t) t.textContent = text.split('\n').map(z => z.trim()).find(Boolean)?.replace(/^#+\s*/, '') ?? '';
}

async function notizTeileAuffrischen(id: string): Promise<void> {
  const n = await body.notiz({ notizId: id });
  if (!n || aktuell?.id !== id || !schublade) return;
  const anh = schublade.querySelector('.anhaenge');
  if (anh) { anh.outerHTML = anhaengeHtml(n.anhangliste, id, false, 'notiz'); vorschauenLaden(schublade); }
}
