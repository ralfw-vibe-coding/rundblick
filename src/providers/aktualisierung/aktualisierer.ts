// Selbst-Aktualisierung nach dem Rezept „macOS-App aktualisiert sich aus einem Ordner“.
// Alle Wirkungen (Dateisystem, Prozesse, Beenden) kommen als Werkzeuge herein – die Logik ist so testbar.
import { basename, dirname, join } from 'node:path';
import type { AktualisierungsStand, Aktualisierer, BuildInfo, UpdateAngebot } from './interface';

export const APP_NAME = 'Rundblick';
export const BUILD_DATEI = 'Contents/Resources/build.json';

export type Werkzeuge = {
  /** Dateinamen in einem Ordner (wirft, wenn nicht lesbar) */
  auflisten(ordner: string): string[];
  /** Befehl ausführen; liefert stdout, wirft bei Fehler mit stderr als Meldung */
  ausfuehren(befehl: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
  lesen(datei: string): string | null;
  schreiben(datei: string, inhalt: string): void;
  entfernen(pfad: string): void;
  /** Skript abgekoppelt starten (läuft weiter, wenn die App endet) */
  abkoppeln(skript: string, args: string[]): void;
  beenden(): void;
  jetzt(): Date;
  /** Systemdialog; undefined = abgebrochen */
  ordnerWaehlen(): Promise<string | undefined>;
};

export type AktualisiererKonfig = {
  werkzeuge: Werkzeuge;
  /** Pfad der ausführbaren Datei (…/Rundblick.app/Contents/MacOS/Rundblick) */
  exe: string;
  /** Angaben des laufenden Builds; null = Entwicklung → nicht verfügbar */
  laufend: BuildInfo | null;
  arch: string;
  /** lokale Datei für den gewählten Ordner (pro Mac) */
  einstellungsDatei: string;
};

// ---------- reine Funktionen ----------

/** …/X.app/Contents/MacOS/x → …/X.app */
export function bundleVon(exe: string): string { return dirname(dirname(dirname(exe))); }

export function angebotAus(datei: string, json: string, arch: string): UpdateAngebot | null {
  try {
    const b = JSON.parse(json) as Partial<BuildInfo>;
    if (typeof b.build !== 'number' || typeof b.version !== 'string') return null;
    if (b.arch && b.arch !== arch) return null;
    return { version: b.version, build: b.build, ...(b.commit ? { commit: b.commit } : {}), datei };
  } catch { return null; }
}

export function neuestesAngebot(angebote: UpdateAngebot[], laufenderBuild: number): UpdateAngebot | null {
  return angebote.filter(a => a.build > laufenderBuild).sort((a, b) => b.build - a.build)[0] ?? null;
}

/** Aus `codesign -d -r-` (stdout): „designated => …“ → Anforderungstext */
export function anforderungAus(ausgabe: string): string | null {
  const m = ausgabe.match(/designated\s*=>\s*(.+)/);
  return m ? m[1]!.trim() : null;
}

/** Tausch-Skript: $1 PID, $2 installiertes Bundle, $3 neues Bundle, $4 Ablage für das alte, $5 Staging-Ordner */
export const TAUSCH = `while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
if mv "$2" "$4"; then if mv "$3" "$2"; then :; else mv "$4" "$2"; fi; fi
rm -rf "$5"
open "$2"`;

// ---------- Updater ----------

export function aktualisierer(k: AktualisiererKonfig): Aktualisierer {
  const w = k.werkzeuge;
  const abos = new Set<(s: AktualisierungsStand) => void>();
  const ordnerLesen = (): string | null => {
    try { return (JSON.parse(w.lesen(k.einstellungsDatei) ?? '{}') as { ordner?: string }).ordner ?? null; } catch { return null; }
  };
  let stand: AktualisierungsStand = !k.laufend ? { stand: 'nichtVerfuegbar' } : ordnerLesen() ? { stand: 'aktuell', ordner: ordnerLesen()!, geprueft: '' } : { stand: 'aus' };
  const setzen = (s: AktualisierungsStand) => { stand = s; abos.forEach(cb => cb(s)); return s; };
  const fehler = (ordner: string, meldung: string) => setzen({ stand: 'fehler', ordner, meldung });

  async function pruefen(): Promise<AktualisierungsStand> {
    if (!k.laufend) return stand;
    const ordner = ordnerLesen();
    if (!ordner) return setzen({ stand: 'aus' });
    if (stand.stand === 'installiert') return stand;
    let dateien: string[];
    try { dateien = w.auflisten(ordner).filter(d => d.toLowerCase().endsWith('.zip')); }
    catch (e) { return fehler(ordner, `Ordner nicht lesbar: ${(e as Error).message}`); }
    const angebote: UpdateAngebot[] = [];
    for (const d of dateien) {
      try {
        const { stdout } = await w.ausfuehren('unzip', ['-p', join(ordner, d), `${APP_NAME}.app/${BUILD_DATEI}`]);
        const a = angebotAus(join(ordner, d), stdout, k.arch);
        if (a) angebote.push(a);
      } catch { /* anderes ZIP – übergehen */ }
    }
    const geprueft = w.jetzt().toISOString();
    const angebot = neuestesAngebot(angebote, k.laufend.build);
    return setzen(angebot ? { stand: 'verfuegbar', ordner, geprueft, angebot } : { stand: 'aktuell', ordner, geprueft });
  }

  async function installieren(): Promise<AktualisierungsStand> {
    if (stand.stand !== 'verfuegbar' || !k.laufend) return stand;
    const { ordner, angebot } = stand;
    setzen({ stand: 'installiert', ordner, angebot });
    const bundle = bundleVon(k.exe);
    const staging = join(dirname(bundle), `.${APP_NAME} Update`);
    const neu = join(staging, `${APP_NAME}.app`);
    try { w.entfernen(staging); await w.ausfuehren('ditto', ['-x', '-k', angebot.datei, staging]); }
    catch (e) { w.entfernen(staging); return fehler(ordner, `Kein Platz für das Update neben der App: ${(e as Error).message}`); }
    try {
      const b = angebotAus(angebot.datei, w.lesen(join(neu, BUILD_DATEI)) ?? '', k.arch);
      if (!b || b.build <= k.laufend.build) throw new Error(`${basename(angebot.datei)} enthält keine neuere ${APP_NAME}.app`);
      try { await w.ausfuehren('codesign', ['--verify', '--deep', '--strict', neu]); }
      catch (e) { throw new Error(`Signatur der neuen App ungültig: ${(e as Error).message}`); }
      const anf = anforderungAus((await w.ausfuehren('codesign', ['-d', '-r-', bundle])).stdout);
      if (!anf) throw new Error('Signatur der installierten App nicht lesbar');
      try { await w.ausfuehren('codesign', ['--verify', '-R', `=${anf}`, neu]); }
      catch (e) { throw new Error(`Die neue App ist anders signiert als die installierte: ${(e as Error).message}`); }
    } catch (e) {
      w.entfernen(staging);
      return fehler(ordner, (e as Error).message);
    }
    try { await w.ausfuehren('xattr', ['-dr', 'com.apple.quarantine', neu]); } catch { /* egal */ }
    w.abkoppeln(TAUSCH, [String(process.pid), bundle, neu, join(staging, 'vorher.app'), staging]);
    w.beenden();
    return stand;
  }

  return {
    laufend: () => k.laufend,
    stand: () => stand,
    async ordnerWaehlen() {
      if (!k.laufend) return stand;
      const o = await w.ordnerWaehlen();
      if (!o) return stand;
      w.schreiben(k.einstellungsDatei, JSON.stringify({ ordner: o }));
      setzen({ stand: 'aktuell', ordner: o, geprueft: '' });
      return pruefen();
    },
    ordnerEntfernen() {
      if (!k.laufend) return stand;
      w.schreiben(k.einstellungsDatei, JSON.stringify({}));
      return setzen({ stand: 'aus' });
    },
    pruefen,
    installieren,
    beiAenderung: cb => { abos.add(cb); return () => { abos.delete(cb); }; },
  };
}

/** Für Entwicklung und Tests: immer „nicht verfügbar“ */
export const keinAktualisierer: Aktualisierer = {
  laufend: () => null, stand: () => ({ stand: 'nichtVerfuegbar' }),
  ordnerWaehlen: async () => ({ stand: 'nichtVerfuegbar' }), ordnerEntfernen: () => ({ stand: 'nichtVerfuegbar' }),
  pruefen: async () => ({ stand: 'nichtVerfuegbar' }), installieren: async () => ({ stand: 'nichtVerfuegbar' }),
  beiAenderung: () => () => {},
};
