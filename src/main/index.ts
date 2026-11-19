// Composition Root: erzeugt Provider → Domain → Body → Clients und verdrahtet sie.
// Umgebungsvariablen: RB_DATEN (Datenordner), RB_KALENDER=beispiel (Beispiel-Kalender statt EventKit),
// RB_DEMO=1 (leeren Datenordner mit Beispieldaten füllen),
// RB_WEB=1 (Web-Client sofort starten, Port RB_WEB_PORT, Standard 4718),
// RB_SCREENSHOT=datei.png (Fenster nach dem Laden abfotografieren und beenden; RB_JS: vorher ausführen).
import { existsSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { RundblickBody } from '../body/body';
import { webAnbinden, type WebServer } from '../client/adapter/http';
import { ipcAnbinden } from '../client/adapter/ipc';
import { Domain } from '../domain/domain';
import { dateiAnhaenge } from '../providers/anhaenge/datei';
import { jsonEinstellungen } from '../providers/einstellungen/json';
import { zuNeueAnzahl } from '../providers/eventstore/format';
import { JsonlEventStore } from '../providers/eventstore/jsonl';
import { ulidGenerator } from '../providers/ids/ulid';
import { kalenderCache } from '../providers/kalender/cache';
import { eventKitKalender } from '../providers/kalender/eventkit';
import { beispielKalender } from '../providers/kalender/fake';
import type { Kalenderquelle } from '../providers/kalender/interface';
import { systemUhr } from '../providers/uhr/system';
import { aktualisiererErzeugen } from './aktualisierung';
import { demoDatenAnlegen } from './demo';

app.setName('Rundblick');
// RB_PROFIL=ordner: eigenes Profil (Layouts, Geräte-Einstellungen) – z. B. für Tests, ohne das echte Profil zu verändern
if (process.env.RB_PROFIL) app.setPath('userData', resolve(process.env.RB_PROFIL));

function datenordnerBestimmen(gespeichert: string | null): string {
  if (process.env.RB_DATEN) return resolve(process.env.RB_DATEN);
  if (gespeichert) return gespeichert;
  const dropbox = join(homedir(), 'Dropbox');
  if (existsSync(dropbox)) return join(dropbox, 'Apps', 'Rundblick');
  return join(app.getPath('userData'), 'daten');
}

function helferPfad(): string {
  return app.isPackaged ? join(process.resourcesPath, 'rb-kalender') : join(app.getAppPath(), 'helfer', 'bin', 'rb-kalender');
}

function fenster(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 900, minHeight: 600, title: 'Rundblick',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 16 }, backgroundColor: '#f4f3f0',
    webPreferences: { preload: join(import.meta.dirname, '../preload/preload.mjs'), contextIsolation: true, sandbox: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return win;
}

async function starte(): Promise<void> {
  // ---- Provider
  const geraetDatei = join(app.getPath('userData'), 'geraet.json');
  const einstellungen = jsonEinstellungen(geraetDatei);
  let geraet = einstellungen.lesen<string | null>('geraet', null);
  if (!geraet) { geraet = `mac-${hostname().split('.')[0]!.toLowerCase()}`; einstellungen.schreiben('geraet', geraet); }
  const datenordner = datenordnerBestimmen(einstellungen.lesen<string | null>('datenordner', null));
  if (!process.env.RB_DATEN) einstellungen.schreiben('datenordner', datenordner);

  const store = new JsonlEventStore(datenordner, geraet, ulidGenerator.neu, () => systemUhr.jetzt());
  const beobachtungStoppen = store.beobachten();
  const kalender: Kalenderquelle = process.env.RB_KALENDER === 'beispiel' ? beispielKalender() : eventKitKalender(helferPfad());
  const cache = kalenderCache(join(app.getPath('userData'), process.env.RB_KALENDER === 'beispiel' ? 'kalendercache-beispiel.json' : 'kalendercache.json'));

  // ---- Domain & Body
  const domain = new Domain(store);
  const aktualisierer = aktualisiererErzeugen();
  const body = new RundblickBody({ domain, uhr: systemUhr, ids: ulidGenerator, einstellungen, kalender, cache, anhaenge: dateiAnhaenge(datenordner), info: { datenordner, geraet }, aktualisierer, zuNeueEvents: zuNeueAnzahl });
  body.einrichten();
  if (process.env.RB_DEMO === '1' && store.lesen().events.length <= 7) await demoDatenAnlegen(body, systemUhr.heute());

  // ---- Clients
  const abbinden = ipcAnbinden(body);
  const win = fenster();

  // Zweiter Client: dieselbe Oberfläche im Browser (z. B. Chrome mit Feedback-Extension)
  let web: WebServer | null = null;
  const imBrowserOeffnen = async () => {
    try {
      web ??= await webAnbinden(body, join(import.meta.dirname, '../renderer'), Number(process.env.RB_WEB_PORT ?? 4718));
      void shell.openExternal(web.url);
    } catch (e) { dialog.showErrorBox('Rundblick im Browser', `Web-Server konnte nicht starten: ${(e as Error).message}`); }
  };
  menueSetzen(imBrowserOeffnen);
  if (process.env.RB_WEB === '1') web = await webAnbinden(body, join(import.meta.dirname, '../renderer'), Number(process.env.RB_WEB_PORT ?? 4718));
  win.on('focus', () => { void body.synchronisieren(); });

  // ---- Zeitgeber: Tageswechsel und gelegentliche Synchronisation
  let heute = systemUhr.heute();
  const takt = setInterval(() => {
    if (systemUhr.heute() !== heute) { heute = systemUhr.heute(); body.tageswechsel(); }
  }, 60_000);
  // Externe Kalender (EventKit): beim Start, beim Fokussieren des Fensters, bei Änderungsmeldung von macOS
  // und zusätzlich alle 5 Minuten
  const sync = setInterval(() => { void body.synchronisieren(); }, 5 * 60_000);
  // Selbst-Aktualisierung: beim Start und alle 30 Minuten im Update-Ordner nachsehen
  void body.aktualisierungPruefen();
  const updateTakt = setInterval(() => { void body.aktualisierungPruefen(); }, 30 * 60_000);
  void body.synchronisieren();

  // Entwicklungshilfe: RB_SCREENSHOT=pfad.png [RB_JS=…] → Fenster abfotografieren und beenden
  if (process.env.RB_SCREENSHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.RB_JS) console.log('RB_JS →', JSON.stringify(await win.webContents.executeJavaScript(process.env.RB_JS).catch(e => String(e))));
      await new Promise(r => setTimeout(r, 900));
      const bild = await win.webContents.capturePage();
      writeFileSync(process.env.RB_SCREENSHOT!, bild.toPNG());
      app.quit();
    }, 1500));
  }

  app.on('before-quit', () => {
    clearInterval(takt); clearInterval(sync); clearInterval(updateTakt); beobachtungStoppen(); abbinden(); web?.stoppen();
    if ('beenden' in kalender) (kalender as { beenden(): void }).beenden();
  });
}

function menueSetzen(imBrowserOeffnen: () => void): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'Ansicht', submenu: [
      { label: 'Im Browser öffnen (für Feedback)', accelerator: 'CmdOrCtrl+Shift+B', click: imBrowserOeffnen },
      { type: 'separator' },
      { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ]));
}
menueSetzen(() => {});

void app.whenReady().then(starte);
app.on('window-all-closed', () => app.quit());
