// Einstellungen: externe Kalender (sichtbar / belegt Kapazität), Standarddauer, Tageskapazität, Board-Spalten.
import { dauerText, WT } from '../../basis/datum';
import type { EinstellungenDto } from '../../body/interface';
import type { KategorieId, Wochentag } from '../../schema/werte';
import { body } from './body';
import { esc, pruefe } from './dom';
import { I } from './icons';

let panel: HTMLDivElement | null = null;
export const einstellungenOffen = () => !!panel;
export function einstellungenSchliessen(): void { panel?.remove(); panel = null; }

export async function einstellungenUmschalten(): Promise<void> {
  if (panel) { einstellungenSchliessen(); return; }
  panel = document.createElement('div');
  panel.className = 'einst';
  document.body.appendChild(panel);
  await einstellungenZeichnen();
  panel.addEventListener('change', async e => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.kal) pruefe(await body.kalenderEinstellen({ kalenderId: t.dataset.kal, [t.dataset.f!]: t.checked }));
    if (t.dataset.tz) {
      const von = Number(panel!.querySelector<HTMLSelectElement>('[data-tz="von"]')!.value), bis = Number(panel!.querySelector<HTMLSelectElement>('[data-tz="bis"]')!.value);
      pruefe(await body.tageszeitFestlegen({ von, bis }));
    }
    if (t.dataset.wt) pruefe(await body.tageskapazitaetFestlegen({ wochentag: Number(t.dataset.wt) as Wochentag, minuten: Math.round(Number(t.value.replace(',', '.')) * 60) }));
    if (t.dataset.spName) pruefe(await body.spalteUmbenennen({ statusId: t.dataset.spName, name: t.value }));
    if (t.dataset.katName) pruefe(await body.kategorieUmbenennen({ kategorie: t.dataset.katName as KategorieId, name: t.value }));
    void einstellungenZeichnen();
  });
  panel.addEventListener('click', async e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    const d = t.dataset;
    if (d.std) pruefe(await body.standarddauerFestlegen({ minuten: Number(d.std) }));
    if (d.zugriff) pruefe(await body.kalenderZugriffAnfragen());
    if (d.sync) pruefe(await body.synchronisieren(), 'Kalender aktualisiert');
    if (d.spWeg) pruefe(await body.spalteEntfernen({ statusId: d.spWeg }));
    if (d.spNeu) { neueSpalteZeile(d.spNeu as KategorieId); return; }
    if (d.spHoch || d.spRunter) {
      const e2 = await body.einstellungen();
      const id = (d.spHoch ?? d.spRunter)!;
      const kat = e2.spalten.find(s => s.id === id)!.kategorie;
      const ids = e2.spalten.filter(s => s.kategorie === kat).map(s => s.id);
      const i = ids.indexOf(id), j = d.spHoch ? i - 1 : i + 1;
      if (j >= 0 && j < ids.length) { [ids[i], ids[j]] = [ids[j]!, ids[i]!]; pruefe(await body.spaltenSortieren({ kategorie: kat, reihenfolge: ids })); }
    }
    if (d.zu) { einstellungenSchliessen(); return; }
    void einstellungenZeichnen();
  });
}

/** „+“ hinter dem Gruppennamen: leere Zeile mit Cursor; ↵ legt die Spalte an, Esc oder leer verlassen verwirft */
function neueSpalteZeile(kat: KategorieId): void {
  const block = panel!.querySelector<HTMLElement>(`.kat-block[data-kat="${kat}"]`)!;
  let zeile = block.querySelector<HTMLElement>('.sp-zeile.neu');
  if (!zeile) {
    zeile = document.createElement('div');
    zeile.className = 'sp-zeile neu';
    zeile.innerHTML = '<input placeholder="Name der neuen Spalte">';
    block.appendChild(zeile);
    const inp = zeile.querySelector('input')!;
    let fertig = false;
    const weg = () => { fertig = true; zeile!.remove(); };
    inp.addEventListener('keydown', async ev => {
      if (ev.key === 'Escape') { ev.stopPropagation(); weg(); }
      if (ev.key !== 'Enter') return;
      const name = inp.value.trim();
      if (!name) { weg(); return; }
      fertig = true;
      if (pruefe(await body.spalteAnlegen({ name, kategorie: kat }))) void einstellungenZeichnen();
    });
    inp.addEventListener('blur', () => { if (!fertig && !inp.value.trim()) weg(); });
  }
  zeile.querySelector('input')!.focus();
}

export async function einstellungenZeichnen(): Promise<void> {
  if (!panel) return;
  const e: EinstellungenDto = await body.einstellungen();
  const zugriff = { erlaubt: ['#16a34a', 'Zugriff erlaubt'], verweigert: ['#d92d20', 'Zugriff verweigert – Systemeinstellungen › Datenschutz › Kalender'], unbestimmt: ['#d97706', 'Noch nicht freigegeben'], nichtVerfuegbar: ['#9ca3af', 'Kalender-Helfer fehlt (npm run build:helfer)'] }[e.zugriff];
  const aktiv = panel.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset : null;
  panel.innerHTML = `<div style="display:flex;align-items:center"><h4 style="margin:0">Externe Kalender <span style="text-transform:none;letter-spacing:0">(macOS / EventKit)</span></h4><span class="spacer"></span><button class="btn" data-zu="1" style="padding:2px 6px">${I.x}</button></div>
    <div class="zugriff" style="margin-top:8px"><span class="dot" style="background:${zugriff[0]}"></span>${zugriff[1]}<span class="spacer"></span>
      ${e.zugriff === 'erlaubt' ? `<button class="btn" data-sync="1">${I.aktualisieren} Aktualisieren</button>` : e.zugriff === 'nichtVerfuegbar' ? '' : '<button class="btn primary" data-zugriff="1">Zugriff anfragen</button>'}</div>
    ${e.kalender.length ? `<table><tr><th style="text-align:left">Kalender</th><th>sichtbar</th><th>belegt Kapazität</th></tr>
      ${e.kalender.map(k => `<tr><td><span class="legend"><i style="background:${k.farbe}"></i></span>${esc(k.name)} <span class="muted">· ${esc(k.konto)}</span></td>
        <td class="c"><input type="checkbox" data-kal="${esc(k.id)}" data-f="sichtbar" ${k.sichtbar ? 'checked' : ''}></td>
        <td class="c"><input type="checkbox" data-kal="${esc(k.id)}" data-f="belegt" ${k.belegt ? 'checked' : ''}></td></tr>`).join('')}</table>` : '<div class="muted" style="font-size:12px">Keine Kalender.</div>'}
    ${e.letzteSynchronisation ? `<div class="info">zuletzt aktualisiert: ${new Date(e.letzteSynchronisation).toLocaleString('de-DE')}</div>` : ''}
    <h4>Standarddauer neuer Buchungen</h4>
    <div class="durq">${[15, 30, 45, 60, 90, 120].map(m => `<button data-std="${m}" class="${e.standarddauer === m ? 'on' : ''}">${dauerText(m).replace(' ', '')}</button>`).join('')}</div>
    <h4>Tageszeit im Kalender</h4>
    <div class="tageszeit">von <select data-tz="von">${stunden(0, 22, e.tageszeit.von)}</select> bis <select data-tz="bis">${stunden(2, 24, e.tageszeit.bis)}</select> Uhr
      <span class="muted" style="font-size:11px">· davor/danach nur bei Terminen oder per Schalter in der Ansicht</span></div>
    <h4>Tageskapazität (Stunden)</h4>
    <div class="kapgrid">${WT.map((w, i) => `<label>${w}<input type="number" min="0" max="24" step="0.5" data-wt="${i + 1}" value="${e.kapazitaet[i]! / 60}"></label>`).join('')}</div>
    <h4>Board-Spalten</h4>
    ${e.kategorien.map(k => `<div class="kat-block" data-kat="${k.id}"><div class="kat-zeile"><input class="kat-name" value="${esc(k.name)}" data-kat-name="${k.id}" title="Name der Spaltengruppe"><button class="kat-plus" data-sp-neu="${k.id}" title="Neue Spalte in „${esc(k.name)}“">${I.plus}</button></div>
      ${e.spalten.filter(s => s.kategorie === k.id).map(s => `<div class="sp-zeile"><input value="${esc(s.name)}" data-sp-name="${esc(s.id)}"><button data-sp-hoch="${esc(s.id)}" title="nach links">${I.hoch}</button><button data-sp-runter="${esc(s.id)}" title="nach rechts">${I.runter}</button><button data-sp-weg="${esc(s.id)}" title="Spalte entfernen (nur wenn leer)">${I.x}</button></div>`).join('')}
      </div>`).join('')}
    <h4>Daten</h4>
    <div class="info">Ordner: ${esc(e.datenordner)}<br>Gerät: ${esc(e.geraet)} (eigene Event-Datei: events/${esc(e.geraet)}.jsonl)</div>`;
  if (aktiv?.wt) panel.querySelector<HTMLInputElement>(`[data-wt="${aktiv.wt}"]`)?.focus();
}

const stunden = (von: number, bis: number, gewaehlt: number) =>
  Array.from({ length: bis - von + 1 }, (_, i) => von + i).map(h => `<option value="${h}" ${h === gewaehlt ? 'selected' : ''}>${String(h).padStart(2, '0')}</option>`).join('');
