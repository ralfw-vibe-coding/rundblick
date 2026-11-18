import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { aktualisierer, anforderungAus, angebotAus, bundleVon, keinAktualisierer, neuestesAngebot, TAUSCH, type Werkzeuge } from './aktualisierer';
import type { AktualisierungsStand } from './interface';

const EXE = '/Applications/Rundblick.app/Contents/MacOS/Rundblick';
const STAGING = '/Applications/.Rundblick Update';
const build = (b: number, extra: Record<string, unknown> = {}) => JSON.stringify({ version: '0.1.0', build: b, commit: 'abc', arch: 'arm64', ...extra });

/** Attrappen: ZIPs als Map Dateiname → build.json-Inhalt (null = kein Rundblick-ZIP) */
function attrappe(zips: Record<string, string | null>, o: {
  ordnerWahl?: string; unlesbar?: boolean; dittoFehler?: boolean; neuBuild?: string | null; signaturUngueltig?: boolean; andereSignatur?: boolean; keineAnforderung?: boolean; xattrFehler?: boolean;
} = {}) {
  const dateien: Record<string, string> = {};
  const log: string[] = [];
  const w: Werkzeuge = {
    auflisten: ordner => { if (o.unlesbar) throw new Error('EACCES'); log.push(`ls ${ordner}`); return [...Object.keys(zips), 'notiz.txt']; },
    ausfuehren: async (befehl, args) => {
      log.push(`${befehl} ${args.join(' ')}`);
      if (befehl === 'unzip') { const z = zips[args[1]!.split('/').at(-1)!]; if (!z) throw new Error('nicht gefunden'); return { stdout: z, stderr: '' }; }
      if (befehl === 'ditto') { if (o.dittoFehler) throw new Error('Permission denied'); return { stdout: '', stderr: '' }; }
      if (befehl === 'codesign' && args[0] === '--verify' && args[1] === '--deep') { if (o.signaturUngueltig) throw new Error('invalid signature'); return { stdout: '', stderr: '' }; }
      if (befehl === 'codesign' && args[0] === '-d') return { stdout: o.keineAnforderung ? '' : 'designated => identifier "de.ralfw.rundblick" and certificate root = H"abc"\n', stderr: 'Executable=…' };
      if (befehl === 'codesign' && args[1] === '-R') { if (o.andereSignatur) throw new Error('code failed to satisfy specified code requirement(s)'); return { stdout: '', stderr: '' }; }
      if (befehl === 'xattr' && o.xattrFehler) throw new Error('kein Attribut');
      return { stdout: '', stderr: '' };
    },
    lesen: d => (d.endsWith('build.json') ? (o.neuBuild === undefined ? build(150) : o.neuBuild) : dateien[d] ?? null),
    schreiben: (d, inhalt) => { dateien[d] = inhalt; },
    entfernen: p => { log.push(`rm ${p}`); },
    abkoppeln: (skript, args) => { log.push(`tausch ${args.slice(1).join(' | ')}`); expect(skript).toBe(TAUSCH); },
    beenden: () => { log.push('beenden'); },
    jetzt: () => new Date('2026-11-18T12:00:00Z'),
    ordnerWaehlen: async () => o.ordnerWahl,
  };
  return { w, log, dateien };
}
const neu = (w: Werkzeuge, laufend: number | null = 140) =>
  aktualisierer({ werkzeuge: w, exe: EXE, laufend: laufend === null ? null : { version: '0.1.0', build: laufend }, arch: 'arm64', einstellungsDatei: '/u/update.json' });

describe('reine Funktionen', () => {
  it('Bundle aus der ausführbaren Datei', () => expect(bundleVon(EXE)).toBe('/Applications/Rundblick.app'));
  it('Angebot nur bei gültigen Build-Angaben und passendem Chip', () => {
    expect(angebotAus('a.zip', build(5), 'arm64')).toEqual({ version: '0.1.0', build: 5, commit: 'abc', datei: 'a.zip' });
    expect(angebotAus('a.zip', build(5, { arch: 'x64' }), 'arm64')).toBeNull();
    expect(angebotAus('a.zip', JSON.stringify({ version: '1', build: 7 }), 'arm64')).toEqual({ version: '1', build: 7, datei: 'a.zip' });
    expect(angebotAus('a.zip', '{kaputt', 'arm64')).toBeNull();
    expect(angebotAus('a.zip', JSON.stringify({ version: '1' }), 'arm64')).toBeNull();
  });
  it('neuestes Angebot größer als der laufende Build', () => {
    const a = (b: number) => ({ version: '1', build: b, datei: `${b}.zip` });
    expect(neuestesAngebot([a(3), a(9), a(5)], 4)!.build).toBe(9);
    expect(neuestesAngebot([a(3), a(4)], 4)).toBeNull();
  });
  it('Anforderung aus der codesign-Ausgabe', () => {
    expect(anforderungAus('designated => identifier "x" and anchor H"1"\n')).toBe('identifier "x" and anchor H"1"');
    expect(anforderungAus('nichts')).toBeNull();
  });
});

describe('Prüfen', () => {
  it('ohne Build-Angaben (Entwicklung) nicht verfügbar – alle Aktionen ohne Wirkung', async () => {
    const { w, log } = attrappe({});
    const u = neu(w, null);
    expect(u.stand()).toEqual({ stand: 'nichtVerfuegbar' });
    expect(u.laufend()).toBeNull();
    await u.pruefen(); await u.ordnerWaehlen(); u.ordnerEntfernen(); await u.installieren();
    expect(log).toEqual([]);
    expect(await keinAktualisierer.pruefen()).toEqual({ stand: 'nichtVerfuegbar' });
  });

  it('ohne Ordner: aus; Ordner wählen speichert lokal und prüft gleich', async () => {
    const { w, dateien } = attrappe({ 'neu.zip': build(150), 'alt.zip': build(120), 'fremd.zip': null }, { ordnerWahl: '/Dropbox/Rundblick' });
    const u = neu(w);
    expect(u.stand()).toEqual({ stand: 'aus' });
    expect(await u.pruefen()).toEqual({ stand: 'aus' });
    const gemeldet: AktualisierungsStand[] = [];
    const ab = u.beiAenderung(s => gemeldet.push(s));
    const s = await u.ordnerWaehlen();
    expect(s).toMatchObject({ stand: 'verfuegbar', ordner: '/Dropbox/Rundblick', angebot: { build: 150, datei: '/Dropbox/Rundblick/neu.zip' } });
    expect(JSON.parse(dateien['/u/update.json']!)).toEqual({ ordner: '/Dropbox/Rundblick' });
    expect(gemeldet.map(g => g.stand)).toEqual(['aktuell', 'verfuegbar']);
    ab();
    expect(u.ordnerEntfernen()).toEqual({ stand: 'aus' });
    expect(gemeldet).toHaveLength(2);
  });

  it('Ordnerwahl abgebrochen ändert nichts; gespeicherter Ordner wird beim Start übernommen', async () => {
    const { w, dateien } = attrappe({ 'x.zip': build(130) });
    expect(await neu(w).ordnerWaehlen()).toEqual({ stand: 'aus' });
    dateien['/u/update.json'] = JSON.stringify({ ordner: '/o' });
    const u = neu(w);
    expect(u.stand()).toMatchObject({ stand: 'aktuell', ordner: '/o' });
    expect(await u.pruefen()).toEqual({ stand: 'aktuell', ordner: '/o', geprueft: '2026-11-18T12:00:00.000Z' });
  });

  it('nicht lesbarer Ordner und kaputte Einstellungsdatei', async () => {
    const { w, dateien } = attrappe({}, { unlesbar: true });
    dateien['/u/update.json'] = JSON.stringify({ ordner: '/weg' });
    expect(await neu(w).pruefen()).toEqual({ stand: 'fehler', ordner: '/weg', meldung: 'Ordner nicht lesbar: EACCES' });
    dateien['/u/update.json'] = '{kaputt';
    expect(neu(w).stand()).toEqual({ stand: 'aus' });
  });
});

describe('Installieren', () => {
  const bereit = async (zips: Record<string, string | null>, o: Parameters<typeof attrappe>[1] = {}) => {
    const a = attrappe(zips, { ordnerWahl: '/o', ...o });
    const u = neu(a.w);
    await u.ordnerWaehlen();
    return { ...a, u };
  };

  it('ohne Angebot passiert nichts', async () => {
    const { u, log } = await bereit({ 'x.zip': build(100) });
    const vorher = log.length;
    expect(await u.installieren()).toMatchObject({ stand: 'aktuell' });
    expect(log.length).toBe(vorher);
  });

  it('entpackt neben die App, prüft Build und Signatur, entfernt Quarantäne, tauscht und beendet', async () => {
    const { u, log } = await bereit({ 'neu.zip': build(150) }, { xattrFehler: true });
    await u.installieren();
    expect(u.stand()).toMatchObject({ stand: 'installiert', angebot: { build: 150 } });
    const ab = log.slice(log.indexOf(`rm ${STAGING}`));
    expect(ab).toEqual([
      `rm ${STAGING}`,
      `ditto -x -k /o/neu.zip ${STAGING}`,
      `codesign --verify --deep --strict ${STAGING}/Rundblick.app`,
      'codesign -d -r- /Applications/Rundblick.app',
      `codesign --verify -R =identifier "de.ralfw.rundblick" and certificate root = H"abc" ${STAGING}/Rundblick.app`,
      `xattr -dr com.apple.quarantine ${STAGING}/Rundblick.app`,
      `tausch /Applications/Rundblick.app | ${STAGING}/Rundblick.app | ${STAGING}/vorher.app | ${STAGING}`,
      'beenden',
    ]);
  });

  it.each([
    [{ dittoFehler: true }, 'Kein Platz für das Update neben der App: Permission denied'],
    [{ neuBuild: build(120) }, 'neu.zip enthält keine neuere Rundblick.app'],
    [{ neuBuild: null }, 'neu.zip enthält keine neuere Rundblick.app'],
    [{ signaturUngueltig: true }, 'Signatur der neuen App ungültig: invalid signature'],
    [{ keineAnforderung: true }, 'Signatur der installierten App nicht lesbar'],
    [{ andereSignatur: true }, 'Die neue App ist anders signiert als die installierte: code failed to satisfy specified code requirement(s)'],
  ])('bricht ab, räumt auf und nennt den Schritt: %o', async (o, meldung) => {
    const { u, log } = await bereit({ 'neu.zip': build(150) }, o);
    expect(await u.installieren()).toEqual({ stand: 'fehler', ordner: '/o', meldung });
    expect(log.at(-1)).toBe(`rm ${STAGING}`);
    expect(log.some(l => l.startsWith('tausch') || l === 'beenden')).toBe(false);
  });

  it('während der Installation wird nicht erneut geprüft', async () => {
    const { u } = await bereit({ 'neu.zip': build(150) });
    await u.installieren();
    expect(await u.pruefen()).toMatchObject({ stand: 'installiert' });
  });
});

describe('Tausch-Skript (echt mit sh)', () => {
  const ordner = mkdtempSync(join(tmpdir(), 'rb-tausch-'));
  afterAll(() => rmSync(ordner, { recursive: true, force: true }));

  function aufbauen(mitNeu: boolean) {
    const o = mkdtempSync(join(ordner, 'f-'));
    const alt = join(o, 'Rundblick.app'), staging = join(o, '.Rundblick Update'), neuApp = join(staging, 'Rundblick.app');
    mkdirSync(alt); writeFileSync(join(alt, 'v'), 'alt');
    mkdirSync(staging);
    if (mitNeu) { mkdirSync(neuApp); writeFileSync(join(neuApp, 'v'), 'neu'); }
    // eigenes „open“ vorne im PATH, das nur protokolliert
    const bin = join(o, 'bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'open'), `#!/bin/sh\necho "$1" >> "${join(o, 'geoeffnet.log')}"\n`); chmodSync(join(bin, 'open'), 0o755);
    return { o, alt, staging, neuApp, bin };
  }
  const lauf = async (x: ReturnType<typeof aufbauen>) => {
    // „App“ = sleep 1; das Skript muss warten, bis der Prozess weg ist
    const app = spawn('sleep', ['1']);
    const start = Date.now(), pid = String(app.pid);
    // asynchron starten, damit Node den beendeten „App“-Prozess abräumen kann (sonst bleibt er als Zombie „lebendig“)
    const sh = spawn('/bin/sh', ['-c', TAUSCH, 'app-update', pid, x.alt, x.neuApp, join(x.staging, 'vorher.app'), x.staging], { env: { ...process.env, PATH: `${x.bin}:${process.env.PATH}` } });
    const status = await new Promise<number | null>(ok => sh.on('exit', ok));
    return { r: { status }, dauer: Date.now() - start };
  };

  it('wartet auf das Ende der App, tauscht, räumt auf und öffnet die neue', async () => {
    const x = aufbauen(true);
    const { r, dauer } = await lauf(x);
    expect(r.status).toBe(0);
    expect(dauer).toBeGreaterThan(900);
    expect(readFileSync(join(x.alt, 'v'), 'utf8')).toBe('neu');
    expect(existsSync(x.staging)).toBe(false);
    expect(readFileSync(join(x.o, 'geoeffnet.log'), 'utf8').trim()).toBe(x.alt);
  });

  it('fehlt die neue App, kommt die alte zurück und wird geöffnet', async () => {
    const x = aufbauen(false);
    await lauf(x);
    expect(readFileSync(join(x.alt, 'v'), 'utf8')).toBe('alt');
    expect(existsSync(x.staging)).toBe(false);
    expect(readFileSync(join(x.o, 'geoeffnet.log'), 'utf8').trim()).toBe(x.alt);
  });
});
