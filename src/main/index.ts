// Composition Root: erzeugt Provider → Domain → Body → Clients und verdrahtet sie.
// Umgebungsvariablen: RB_DATEN (Datenordner), RB_KALENDER=beispiel (Beispiel-Kalender statt EventKit),
// RB_DEMO=1 (leeren Datenordner mit Beispieldaten füllen),
// RB_SCREENSHOT=datei.png (Fenster nach dem Laden abfotografieren und beenden; RB_JS: vorher ausführen).
import { existsSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { app, BrowserWindow, Menu, shell } from 'electron';
import { RundblickBody } from '../body/body';
import { ipcAnbinden } from '../client/adapter/ipc';
import { Domain } from '../domain/domain';
import { jsonEinstellungen } from '../providers/einstellungen/json';
import { JsonlEventStore } from '../providers/eventstore/jsonl';
import { ulidGenerator } from '../providers/ids/ulid';
import { kalenderCache } from '../providers/kalender/cache';
import { eventKitKalender } from '../providers/kalender/eventkit';
import { beispielKalender } from '../providers/kalender/fake';
import type { Kalenderquelle } from '../providers/kalender/interface';
import { systemUhr } from '../providers/uhr/system';
import { demoDatenAnlegen } from './demo';

app.setName('Rundblick');

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
  const body = new RundblickBody({ domain, uhr: systemUhr, ids: ulidGenerator, einstellungen, kalender, cache, info: { datenordner, geraet } });
  body.einrichten();
  if (process.env.RB_DEMO === '1' && store.lesen().events.length <= 7) await demoDatenAnlegen(body, systemUhr.heute());

  // ---- Clients
  const abbinden = ipcAnbinden(body);
  const win = fenster();
  win.on('focus', () => { void body.synchronisieren(); });

  // ---- Zeitgeber: Tageswechsel und gelegentliche Synchronisation
  let heute = systemUhr.heute();
  const takt = setInterval(() => {
    if (systemUhr.heute() !== heute) { heute = systemUhr.heute(); body.tageswechsel(); }
  }, 60_000);
  const sync = setInterval(() => { void body.synchronisieren(); }, 15 * 60_000);
  void body.synchronisieren();

  // Entwicklungshilfe: RB_SCREENSHOT=pfad.png [RB_JS=…] → Fenster abfotografieren und beenden
  if (process.env.RB_SCREENSHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.RB_JS) await win.webContents.executeJavaScript(process.env.RB_JS).catch(e => console.error(e));
      await new Promise(r => setTimeout(r, 900));
      const bild = await win.webContents.capturePage();
      writeFileSync(process.env.RB_SCREENSHOT!, bild.toPNG());
      app.quit();
    }, 1500));
  }

  app.on('before-quit', () => {
    clearInterval(takt); clearInterval(sync); beobachtungStoppen(); abbinden();
    if ('beenden' in kalender) (kalender as { beenden(): void }).beenden();
  });
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { role: 'appMenu' },
  { role: 'editMenu' },
  { label: 'Ansicht', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
  { role: 'windowMenu' },
]));

void app.whenReady().then(starte);
app.on('window-all-closed', () => app.quit());
