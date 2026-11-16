// Einstieg der Oberfläche: Raster, Schnellerfassung, Einstellungen und Tastatur verdrahten.
import { body } from './body';
import { auffrischen, offen as schubladeOffen, schliessen as schubladeSchliessen } from './detail';
import { $, tippt } from './dom';
import { einstellungenOffen, einstellungenSchliessen, einstellungenUmschalten, einstellungenZeichnen } from './einstellungen';
import { interaktionAnbinden } from './interaktion';
import { Raster } from './raster';
import { schnellerfassungAnbinden } from './schnellerfassung';

const raster = new Raster($('#area'), $('#ws'));
const erfassung = schnellerfassungAnbinden($('#qc'));
interaktionAnbinden();
$('#einstBtn').onclick = () => void einstellungenUmschalten();
document.addEventListener('mousedown', e => {
  if (einstellungenOffen() && !(e.target as HTMLElement).closest('.einst, #einstBtn')) einstellungenSchliessen();
});

body.beiAenderung(bereiche => {
  raster.aktualisieren(bereiche);
  void auffrischen();
  if (bereiche.includes('einstellungen') || bereiche.includes('kalender')) void einstellungenZeichnen();
});

document.addEventListener('keydown', e => {
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
