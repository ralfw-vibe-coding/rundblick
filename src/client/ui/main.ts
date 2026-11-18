// Einstieg der Oberfläche: Raster, Schnellerfassung, Einstellungen und Tastatur verdrahten.
import { body } from './body';
import { auffrischen, offen as schubladeOffen, schliessen as schubladeSchliessen, schliessenWenn as schubladeSchliessenWenn } from './detail';
import { $, pruefe, tippt } from './dom';
import { einstellungenOffen, einstellungenSchliessen, einstellungenUmschalten, einstellungenZeichnen } from './einstellungen';
import { interaktionAnbinden, zweistufigAnbinden } from './interaktion';
import { I } from './icons';
import { Raster } from './raster';
import { ausgewaehlteVerschieben } from './sichten/liste';
import { schnellerfassungAnbinden } from './schnellerfassung';

const raster = new Raster($('#area'), $('#ws'));
const erfassung = schnellerfassungAnbinden($('#qc'));
interaktionAnbinden();
$('#einstBtn').innerHTML = I.einstellungen;

// Kalender manuell aktualisieren: Symbol dreht sich, solange geladen wird; Tooltip zeigt den letzten Stand
const syncBtn = $('#syncBtn');
syncBtn.innerHTML = I.zuruecksetzen;
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
});

// Dateien, die nicht auf einem Ziel landen, dürfen das Fenster nicht verlassen (Electron würde sie öffnen)
const mitDateien = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
addEventListener('dragover', e => { if (mitDateien(e)) e.preventDefault(); });
addEventListener('drop', e => { if (mitDateien(e)) e.preventDefault(); });

addEventListener('rb-frisch', () => raster.aktualisieren(['aufgaben', 'board']));
addEventListener('rb-auswahl', () => raster.aktualisieren(['aufgaben', 'board']));
zweistufigAnbinden((act, id) => { if (act === 'verwerfen' || act === 'stornieren') schubladeSchliessenWenn(id); });

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
