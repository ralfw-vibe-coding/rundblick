// KalenderAblage im Dateisystem (Desktop): <datenordner>/kalender/<gerät>.json – liegt im Dropbox-Ordner, also sehen andere Geräte sie.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KalenderStand } from '../../schema/extern';
import type { KalenderAblage } from './interface';

export function dateiKalenderAblage(datenordner: string): KalenderAblage {
  const ordner = join(datenordner, 'kalender');
  return {
    async veroeffentlichen(s) {
      mkdirSync(ordner, { recursive: true });
      // erst in eine Hilfsdatei, dann umbenennen – Dropbox lädt nie eine halbe Datei hoch
      const datei = join(ordner, `${s.geraet}.json`), tmp = join(ordner, `.${s.geraet}.json.tmp`);
      writeFileSync(tmp, JSON.stringify(s));
      renameSync(tmp, datei);
    },
    async staende() {
      if (!existsSync(ordner)) return [];
      return readdirSync(ordner).filter(n => n.endsWith('.json') && !n.startsWith('.')).flatMap(n => {
        try { return [JSON.parse(readFileSync(join(ordner, n), 'utf8')) as KalenderStand]; } catch { return []; }
      });
    },
  };
}
