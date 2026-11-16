// KalenderCache im Speicher, optional mit JSON-Datei, damit nach dem Start sofort Termine da sind.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExternerTermin, KalenderInfo } from '../../schema/extern';
import type { Datum } from '../../schema/werte';
import type { KalenderCache } from './interface';

type Inhalt = { kalender: KalenderInfo[]; termine: ExternerTermin[]; zuletzt: string | null; von: Datum | null; bis: Datum | null };

export function kalenderCache(datei?: string): KalenderCache {
  let inhalt: Inhalt = { kalender: [], termine: [], zuletzt: null, von: null, bis: null };
  if (datei && existsSync(datei)) { try { inhalt = JSON.parse(readFileSync(datei, 'utf8')) as Inhalt; } catch { /* neu aufbauen */ } }
  return {
    kalender: () => inhalt.kalender,
    termine: (von, bis) => inhalt.termine.filter(t => t.datum >= von && t.datum <= bis),
    ersetzen: (von, bis, kalender, termine) => {
      const behalten = inhalt.termine.filter(t => t.datum < von || t.datum > bis);
      inhalt = {
        kalender, termine: [...behalten, ...termine], zuletzt: new Date().toISOString(),
        von: inhalt.von && inhalt.von < von ? inhalt.von : von, bis: inhalt.bis && inhalt.bis > bis ? inhalt.bis : bis,
      };
      if (datei) { mkdirSync(dirname(datei), { recursive: true }); writeFileSync(datei, JSON.stringify(inhalt)); }
    },
    stand: () => ({ zuletzt: inhalt.zuletzt, von: inhalt.von, bis: inhalt.bis }),
  };
}
