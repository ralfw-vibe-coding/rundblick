// Einstieg der Oberfläche: Raster, Schnellerfassung, Einstellungen und Tastatur verdrahten.
import { body } from './body';
import { auffrischen, offen as schubladeOffen, schliessen as schubladeSchliessen, schliessenWenn as schubladeSchliessenWenn } from './detail';
import { $, pruefe, tippt, toast } from './dom';
import { einstellungenOffen, einstellungenSchliessen, einstellungenUmschalten, einstellungenZeichnen } from './einstellungen';
import { interaktionAnbinden, zweistufigAnbinden } from './interaktion';
import { I } from './icons';
import { Raster } from './raster';
import { ausgewaehlteVerschieben } from './sichten/liste';
import { schnellerfassungAnbinden } from './schnellerfassung';
import { uhrzeitfelderAnbinden } from './uhrzeitfeld';

const raster = new Raster($('#area'), $('#ws'));
const erfassung = schnellerfassungAnbinden($('#qc'));
interaktionAnbinden();
uhrzeitfelderAnbinden();
$('#einstBtn').innerHTML = I.einstellungen;

// Kalender manuell aktualisieren: Symbol dreht sich, solange geladen wird; Tooltip zeigt den letzten Stand
const syncBtn = $('#syncBtn');
syncBtn.innerHTML = I.kalenderSync;
const syncTitel = async () => {
  const z = (await body.einstellungen()).letzteSynchronisation;
  syncBtn.title = `Kalender aktualisieren${z ? ` · zuletzt ${new Date(z).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : ''}`;
};
void syncTitel();
syncBtn.onclick = async () => {
  if (syncBtn.classList.contains('dreht')) return;
  syncBtn.classList.add('dreht');
  const [r] = await Promise.all([body.synchronisieren(), new Promise(ok => setTimeout(ok, 700))]);
  syncBtn.classList.remove('dreht');
  pruefe(r);
  void syncTitel();
};
$('#einstBtn').onclick = () => void einstellungenUmschalten();
document.addEventListener('mousedown', e => {
  if (einstellungenOffen() && !(e.target as HTMLElement).closest('.einst, #einstBtn')) einstellungenSchliessen();
});

body.beiAenderung(bereiche => {
  raster.aktualisieren(bereiche);
  void auffrischen();
  if (bereiche.includes('einstellungen') || bereiche.includes('kalender')) { void einstellungenZeichnen(); void syncTitel(); }
  if (bereiche.includes('aktualisierung')) { void einstellungenZeichnen(); void updateMarke(); }
});

// Dateien, die nicht auf einem Ziel landen, dürfen das Fenster nicht verlassen (Electron würde sie öffnen)
const mitDateien = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
addEventListener('dragover', e => { if (mitDateien(e)) e.preventDefault(); });
addEventListener('drop', e => { if (mitDateien(e)) e.preventDefault(); });

addEventListener('rb-frisch', () => raster.aktualisieren(['aufgaben', 'board']));
addEventListener('rb-auswahl', () => raster.aktualisieren(['aufgaben', 'board']));
zweistufigAnbinden((act, id) => { if (act === 'verwerfen' || act === 'stornieren' || act === 'notizVerwerfen') schubladeSchliessenWenn(id); });

document.addEventListener('keydown', e => {
  const imFeld = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? '');
  if (e.altKey && !imFeld && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); void ausgewaehlteVerschieben(e.key === 'ArrowUp' ? -1 : 1); return; }
  if (tippt(e)) return;
  if (/^[1-9]$/.test(e.key)) raster.wechseln(Number(e.key) - 1);
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); erfassung.focus(); }
  else if (e.key === 'Escape') {
    if (schubladeOffen()) schubladeSchliessen();
    else if (einstellungenOffen()) einstellungenSchliessen();
    else raster.maximiertAufheben();
  }
});

void raster.laden();

// Update-Knopf rechts neben dem Zahnrad: hervorgehoben, wenn ein neuer Build bereitliegt.
// Klick: kein Ordner → Ordner wählen; neuer Build da → aktualisieren; sonst jetzt prüfen (und ggf. gleich aktualisieren).
const updBtn = $('#updBtn');
updBtn.innerHTML = I.appUpdate;
async function updateMarke(): Promise<void> {
  const a = await body.aktualisierung();
  const s = a.stand;
  updBtn.hidden = s.stand === 'nichtVerfuegbar';
  updBtn.classList.toggle('hat-update', s.stand === 'verfuegbar');
  updBtn.classList.toggle('dreht', s.stand === 'installiert');
  const ich = a.laufend ? `Build ${a.laufend.build}` : '';
  updBtn.title = s.stand === 'verfuegbar' ? `Build ${s.angebot.build} ist da – klicken zum Aktualisieren (läuft: ${ich})`
    : s.stand === 'installiert' ? `Aktualisiere auf Build ${s.angebot.build} …`
    : s.stand === 'aus' ? `Kein Update-Ordner gewählt – klicken zum Wählen (läuft: ${ich})`
    : s.stand === 'fehler' ? `Update: ${s.meldung}`
    : `Nach Updates suchen (läuft: ${ich}${s.stand === 'aktuell' && s.geprueft ? `, geprüft ${new Date(s.geprueft).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : ''})`;
}
updBtn.onclick = async () => {
  if (updBtn.classList.contains('dreht')) return;
  updBtn.classList.add('dreht');
  try {
    let a = await body.aktualisierung();
    if (a.stand.stand === 'aus') { pruefe(await body.aktualisierungOrdnerWaehlen()); a = await body.aktualisierung(); if (a.stand.stand === 'aus') return; }
    if (a.stand.stand !== 'verfuegbar') {
      if (!pruefe(await body.aktualisierungPruefen())) return;
      a = await body.aktualisierung();
    }
    if (a.stand.stand === 'verfuegbar') { toast(`Aktualisiere auf Build ${a.stand.angebot.build} … Rundblick startet gleich neu.`); pruefe(await body.aktualisierungInstallieren()); }
    else if (a.stand.stand === 'aktuell') toast(`Rundblick ist aktuell (Build ${a.laufend?.build ?? '?'})`);
  } finally {
    updBtn.classList.remove('dreht');
    void updateMarke();
  }
};
void updateMarke();

// Schema-Schutz: ein anderes Gerät schreibt Events eines neueren Schemas → diese App ist veraltet
const veraltet = document.createElement('div');
veraltet.className = 'veraltet'; veraltet.hidden = true;
veraltet.innerHTML = `${I.appUpdate}<span>Ein anderes Gerät nutzt eine neuere Rundblick-Version. Bitte aktualisieren – sonst fehlen hier Änderungen.</span>`;
veraltet.onclick = () => updBtn.click();
document.body.append(veraltet);
const datenstandPruefen = async () => { veraltet.hidden = (await body.datenstand()).zuNeu === 0; };
void datenstandPruefen();
setInterval(() => void datenstandPruefen(), 30_000);
