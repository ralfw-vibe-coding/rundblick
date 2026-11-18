// Packt Rundblick: bauen → Build-Angaben ins Bundle → signieren (HyperRec) → ZIP nach dist/.
// Das ZIP ist das Update-Paket: Liegt es im Update-Ordner einer installierten App, bietet sie es an.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const arch = process.arch;
const app = resolve(`dist/mac-${arch}/Rundblick.app`);

sh('npm', ['run', 'build:helfer']);
sh('npx', ['electron-vite', 'build']);
sh('npx', ['electron-builder', '--mac', '--dir', `--${arch}`]);

const build = Number(git('rev-list', '--count', 'HEAD'));
const commit = git('rev-parse', '--short', 'HEAD');
if (git('status', '--porcelain')) console.warn(`\n⚠︎  Uncommittete Änderungen: Build ${build} entspricht dem letzten Commit – vor dem Weitergeben committen, sonst steigt die Build-Nummer nicht.\n`);
const info = { name: 'Rundblick', version: pkg.version, build, commit, arch };
writeFileSync(join(app, 'Contents', 'Resources', 'build.json'), JSON.stringify(info, null, 2));

sh('sh', ['tools/signieren.sh', app]);

for (const f of readdirSync('dist')) if (/^Rundblick-.*\.zip$/.test(f)) rmSync(join('dist', f));
const zip = resolve(`dist/Rundblick-${pkg.version}-b${build}-${arch}.zip`);
sh('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
// Für andere Nutzer: ZIP in den geteilten Update-Ordner (dort liegen auch ZIPs anderer Apps –
// ersetzt werden nur ältere Rundblick-ZIPs). Abschalten mit RB_UPDATE_ORDNER=aus.
const geteilt = process.env.RB_UPDATE_ORDNER ?? '/Users/ralfw/Dropbox/02 AR Team/05 App Updates';
let kopie = '';
if (geteilt !== 'aus') {
  if (existsSync(geteilt)) {
    for (const f of readdirSync(geteilt)) if (/^Rundblick-.*\.zip$/.test(f)) rmSync(join(geteilt, f));
    kopie = join(geteilt, zip.split('/').at(-1));
    copyFileSync(zip, kopie);
  } else console.warn(`⚠︎  Update-Ordner fehlt: ${geteilt} – ZIP nicht weitergegeben`);
}
console.log(`\nRundblick ${pkg.version} · Build ${build} (${commit}) · ${arch}\n  App: ${app}\n  ZIP: ${zip}${kopie ? `\n  Geteilt: ${kopie}` : ''}`);
