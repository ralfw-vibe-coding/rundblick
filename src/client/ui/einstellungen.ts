// Einstellungen in Reitern: Standards (Dauer, Tageszeit, Kapazität, Daten) · Board-Spalten · Externe Kalender · Aktualisierung (nur in der installierten App).
import { kalenderGruppen } from './kalenderwahl';
import { dauerText, WT } from '../../basis/datum';
import type { Aktualisierung, EinstellungenDto } from '../../body/interface';
import type { KategorieId, Wochentag } from '../../schema/werte';
import { body } from './body';
import { esc, pruefe } from './dom';
import { I } from './icons';
import { zweistufigRegistrieren } from './interaktion';
import { muellKnopf } from './bausteine';

let panel: HTMLDivElement | null = null;

type Reiter = 'standards' | 'board' | 'kalender' | 'aktualisierung';
const REITER: { id: Reiter; name: string; titel: string; icon: string }[] = [
  { id: 'standards', name: 'Standards', titel: 'Standarddauer, Tageszeit, Kapazität', icon: I.einstellungen },
  { id: 'board', name: 'Board', titel: 'Board-Spalten und Spaltengruppen', icon: I.board },
  { id: 'kalender', name: 'Kalender', titel: 'Externe Kalender (Google, iCloud)', icon: I.kalenderSync },
  { id: 'aktualisierung', name: 'Updates', titel: 'Automatische Aktualisierung', icon: I.aktualisierung },
];
/** zuletzt gewählter Reiter (pro Gerät im Browser-Speicher) */
let reiter: Reiter = (localStorage.getItem('rb-einstellungen-reiter') as Reiter) ?? 'standards';
if (!REITER.some(r => r.id === reiter)) reiter = 'standards';

// Spalte entfernen: zweistufig wie alle zerstörenden Aktionen (nur möglich, wenn die Spalte leer ist)
zweistufigRegistrieren('spalteEntfernen', async id => { pruefe(await body.spalteEntfernen({ statusId: id })); void einstellungenZeichnen(); });
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
    if (d.akt) {
      const f = { waehlen: body.aktualisierungOrdnerWaehlen, pruefen: body.aktualisierungPruefen, entfernen: body.aktualisierungOrdnerEntfernen, installieren: body.aktualisierungInstallieren }[d.akt];
      if (f) pruefe(await f.call(body));
      void einstellungenZeichnen();
      return;
    }
    if (d.reiter) { reiter = d.reiter as Reiter; localStorage.setItem('rb-einstellungen-reiter', reiter); void einstellungenZeichnen(); return; }
    if (d.std) pruefe(await body.standarddauerFestlegen({ minuten: Number(d.std) }));
    if (d.zugriff) pruefe(await body.kalenderZugriffAnfragen());
    if (d.sync) pruefe(await body.synchronisieren(), 'Kalender aktualisiert');
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
  const akt = await body.aktualisierung();
  const reiterListe = REITER.filter(r => r.id !== 'aktualisierung' || akt.stand.stand !== 'nichtVerfuegbar');
  if (!reiterListe.some(r => r.id === reiter)) reiter = 'standards';
  const kopf = `<div class="einst-kopf"><div class="seg einst-reiter">${reiterListe.map(r => `<button data-reiter="${r.id}" class="${r.id === reiter ? 'on' : ''}" title="${esc(r.titel)}">${r.icon}${r.name}</button>`).join('')}</div>
    <span class="spacer"></span><button class="btn einst-zu" data-zu="1" title="Schließen (Esc)">${I.x}</button></div>`;

  const standards = `
    <h4>Standarddauer neuer Buchungen</h4>
    <div class="durq">${[15, 30, 45, 60, 90, 120].map(m => `<button data-std="${m}" class="${e.standarddauer === m ? 'on' : ''}">${dauerText(m).replace(' ', '')}</button>`).join('')}</div>
    <h4>Tageszeit im Kalender</h4>
    <div class="tageszeit">von <select data-tz="von">${stunden(0, 22, e.tageszeit.von)}</select> bis <select data-tz="bis">${stunden(2, 24, e.tageszeit.bis)}</select> Uhr</div>
    <div class="muted" style="font-size:11px;margin-top:4px">Davor und danach nur, wenn dort Termine liegen, oder per Schalter in der Kalenderansicht.</div>
    <h4>Tageskapazität in Stunden</h4>
    <div class="kapgrid">${WT.map((w, i) => `<label>${w}<input type="number" min="0" max="24" step="0.5" data-wt="${i + 1}" value="${e.kapazitaet[i]! / 60}"></label>`).join('')}</div>
    <h4>Daten</h4>
    <div class="info">Ordner: ${esc(e.datenordner)}<br>Gerät: ${esc(e.geraet)} (eigene Event-Datei: events/${esc(e.geraet)}.jsonl)</div>`;

  const board = `
    <div class="muted" style="font-size:11px;margin-bottom:6px">Gruppennamen und Spalten umbenennen: einfach hineinklicken. Entfernen geht nur bei leeren Spalten.</div>
    ${e.kategorien.map(k => `<div class="kat-block" data-kat="${k.id}"><div class="kat-zeile"><input class="kat-name" value="${esc(k.name)}" data-kat-name="${k.id}" title="Name der Spaltengruppe"><button class="kat-plus" data-sp-neu="${k.id}" title="Neue Spalte in „${esc(k.name)}“">${I.plus}</button></div>
      ${e.spalten.filter(s => s.kategorie === k.id).map(s => `<div class="sp-zeile"><input value="${esc(s.name)}" data-sp-name="${esc(s.id)}"><button data-sp-hoch="${esc(s.id)}" title="nach links">${I.hoch}</button><button data-sp-runter="${esc(s.id)}" title="nach rechts">${I.runter}</button>${muellKnopf('spalteEntfernen', 'Spalte entfernen (nur wenn leer)', s.id)}</div>`).join('')}
      </div>`).join('')}`;

  const kalender = `
    <div class="zugriff"><span class="dot" style="background:${zugriff[0]}"></span>${zugriff[1]}<span class="spacer"></span>
      ${e.zugriff === 'erlaubt' ? `<button class="btn" data-sync="1">${I.aktualisieren} Aktualisieren</button>` : e.zugriff === 'nichtVerfuegbar' ? '' : '<button class="btn primary" data-zugriff="1">Zugriff anfragen</button>'}</div>
    <div class="muted" style="font-size:11px;margin-bottom:6px">Alle Kalender aus der macOS-Kalender-App (iCloud, Google …). Pro Kalender: einblenden und ob seine Termine Kapazität belegen.</div>
    ${e.kalender.length ? `<table><tr><th style="text-align:left">Kalender</th><th>sichtbar</th><th>belegt Kapazität</th></tr>
      ${kalenderGruppen(e.kalender).map(g => `<tr><td colspan="3" class="kal-gruppe">${esc(g.konto)}</td></tr>${g.kalender.map(k => `<tr><td><span class="legend"><i style="background:${k.farbe}"></i></span>${esc(k.name)}</td>
        <td class="c"><input type="checkbox" data-kal="${esc(k.id)}" data-f="sichtbar" ${k.sichtbar ? 'checked' : ''}></td>
        <td class="c"><input type="checkbox" data-kal="${esc(k.id)}" data-f="belegt" ${k.belegt ? 'checked' : ''}></td></tr>`).join('')}`).join('')}</table>` : '<div class="muted" style="font-size:12px">Keine Kalender.</div>'}
    ${e.letzteSynchronisation ? `<div class="info" style="margin-top:8px">zuletzt aktualisiert: ${new Date(e.letzteSynchronisation).toLocaleString('de-DE')}</div>` : ''}`;

  const aktualisierung = aktualisierungInhalt(akt);
  panel.innerHTML = `${kopf}<div class="einst-inhalt">${{ standards, board, kalender, aktualisierung }[reiter]}</div>`;
  if (aktiv?.wt) panel.querySelector<HTMLInputElement>(`[data-wt="${aktiv.wt}"]`)?.focus();
}

const stunden = (von: number, bis: number, gewaehlt: number) =>
  Array.from({ length: bis - von + 1 }, (_, i) => von + i).map(h => `<option value="${h}" ${h === gewaehlt ? 'selected' : ''}>${String(h).padStart(2, '0')}</option>`).join('');

function aktualisierungInhalt(a: Aktualisierung): string {
  const l = a.laufend, s = a.stand;
  if (!l || s.stand === 'nichtVerfuegbar') return '<div class="muted">Entwicklungsversion – keine automatische Aktualisierung.</div>';
  const uhr = (iso: string) => (iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr' : '');
  const ordner = 'ordner' in s ? s.ordner : '';
  const status =
    s.stand === 'aus' ? '<div class="muted">Wähle einen Ordner, in dem neue Versionen als ZIP liegen – z. B. einen geteilten Dropbox-Ordner oder <code>dist/</code> des Repos. Rundblick sieht beim Start und alle 30 Minuten nach.</div>'
    : s.stand === 'aktuell' ? `<div class="akt-status ok">${I.haken}Auf dem neuesten Stand${s.geprueft ? ` · geprüft ${uhr(s.geprueft)}` : ''}</div>`
    : s.stand === 'verfuegbar' ? `<div class="akt-status neu">${I.aktualisierung}<span>Build ${s.angebot.build} ist da${s.angebot.commit ? ` <span class="muted">(${esc(s.angebot.commit)})</span>` : ''}</span><span class="spacer"></span><button class="btn primary" data-akt="installieren">Jetzt aktualisieren</button></div>
        <div class="muted" style="font-size:11px">Rundblick beendet sich, tauscht sich aus und startet neu.</div>`
    : s.stand === 'installiert' ? `<div class="akt-status neu">${I.aktualisierung}Aktualisiere auf Build ${s.angebot.build} … Rundblick startet gleich neu.</div>`
    : `<div class="akt-status fehler">${I.warnung}${esc(s.meldung)}</div>`;
  return `
    <h4>Diese App</h4>
    <div>Rundblick ${esc(l.version)} · Build ${l.build}${l.commit ? ` <span class="muted">(${esc(l.commit)})</span>` : ''}</div>
    <h4>Update-Ordner</h4>
    <div class="akt-ordner">${ordner ? esc(ordner) : '<span class="muted">noch keiner gewählt</span>'}</div>
    <div class="akt-knoepfe"><button class="btn" data-akt="waehlen">${I.ordner} Ordner wählen …</button>${ordner ? `<button class="btn" data-akt="pruefen">${I.aktualisieren} Jetzt prüfen</button><button class="btn" data-akt="entfernen">Ordner entfernen</button>` : ''}</div>
    <h4>Stand</h4>
    ${status}`;
}
