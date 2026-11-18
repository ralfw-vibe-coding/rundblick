// Installiert die gebaute App nach /Applications (beendet eine laufende Rundblick-App vorher).
// Nur für die erste Installation nötig – danach aktualisiert sich die App selbst aus dem Update-Ordner.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const quelle = `dist/mac-${process.arch}/Rundblick.app`, ziel = '/Applications/Rundblick.app';
if (!existsSync(quelle)) { console.error(`${quelle} fehlt – zuerst npm run app`); process.exit(1); }
try { execFileSync('osascript', ['-e', 'quit app "Rundblick"']); } catch { /* lief nicht */ }
execFileSync('sleep', ['2']);
rmSync(ziel, { recursive: true, force: true });
execFileSync('ditto', [quelle, ziel], { stdio: 'inherit' });
execFileSync('codesign', ['--verify', '--deep', '--strict', ziel], { stdio: 'inherit' });
execFileSync('open', [ziel]);
console.log(`Installiert: ${ziel}`);
