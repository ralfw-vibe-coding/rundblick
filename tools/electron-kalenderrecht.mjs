// Ergänzt die Info.plist der Entwicklungs-Electron-App um die Begründungstexte für den
// Kalenderzugriff. Ohne sie verweigert macOS dem EventKit-Helfer (Kindprozess von Electron)
// den Zugriff. In der gepackten App kommt der Text über die Build-Konfiguration.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const plist = resolve('node_modules/electron/dist/Electron.app/Contents/Info.plist');
if (process.platform !== 'darwin' || !existsSync(plist)) process.exit(0);
const text = 'Rundblick zeigt Termine aus deinen Kalendern neben deinen Aufgaben.';
for (const key of ['NSCalendarsUsageDescription', 'NSCalendarsFullAccessUsageDescription']) {
  try { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${text}`, plist], { stdio: 'ignore' }); }
  catch { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${text}`, plist], { stdio: 'ignore' }); }
}
console.log('Electron.app: Kalender-Begründung eingetragen');
