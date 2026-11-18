// Echte Werkzeuge für die Selbst-Aktualisierung (Node + Electron) – die Logik steckt im Provider.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, dialog } from 'electron';
import { aktualisierer, type Werkzeuge } from '../providers/aktualisierung/aktualisierer';
import type { Aktualisierer, BuildInfo } from '../providers/aktualisierung/interface';

export function echteWerkzeuge(): Werkzeuge {
  return {
    auflisten: ordner => readdirSync(ordner),
    ausfuehren: (befehl, args) => new Promise((ok, nein) => {
      execFile(befehl, args, { maxBuffer: 16 * 1024 * 1024 }, (fehler, stdout, stderr) => {
        if (fehler) nein(new Error(String(stderr || fehler.message).trim()));
        else ok({ stdout: String(stdout), stderr: String(stderr) });
      });
    }),
    lesen: datei => (existsSync(datei) ? readFileSync(datei, 'utf8') : null),
    schreiben: (datei, inhalt) => { mkdirSync(dirname(datei), { recursive: true }); writeFileSync(datei, inhalt); },
    entfernen: pfad => rmSync(pfad, { recursive: true, force: true }),
    abkoppeln: (skript, args) => { spawn('/bin/sh', ['-c', skript, 'rundblick-update', ...args], { detached: true, stdio: 'ignore' }).unref(); },
    beenden: () => app.quit(),
    jetzt: () => new Date(),
    ordnerWaehlen: async () => (await dialog.showOpenDialog({ title: 'Update-Ordner für Rundblick wählen', buttonLabel: 'Als Update-Ordner verwenden', properties: ['openDirectory'] })).filePaths[0],
  };
}

/** Build-Angaben der laufenden App (vom Packskript in Contents/Resources/build.json geschrieben); null in der Entwicklung */
export function laufenderBuild(): BuildInfo | null {
  if (!app.isPackaged) return null;
  const datei = join(process.resourcesPath, 'build.json');
  try { return existsSync(datei) ? JSON.parse(readFileSync(datei, 'utf8')) as BuildInfo : null; } catch { return null; }
}

/** Updater erzeugen – erst nach app.setName (userData hängt am Namen) */
export function aktualisiererErzeugen(): Aktualisierer | undefined {
  const laufend = laufenderBuild();
  if (!laufend) return undefined;
  return aktualisierer({
    werkzeuge: echteWerkzeuge(), exe: app.getPath('exe'), laufend, arch: process.arch,
    einstellungsDatei: join(app.getPath('userData'), 'update.json'),
  });
}
