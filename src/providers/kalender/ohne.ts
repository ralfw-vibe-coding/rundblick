// Ohne externe Kalender (Phone App, Version 1): Quelle „nicht verfügbar“ und ein leerer Zwischenspeicher.
import type { ExternerTermin, KalenderInfo } from '../../schema/extern';
import type { Datum } from '../../schema/werte';
import type { KalenderCache, Kalenderquelle } from './interface';

const NICHT = () => Promise.reject(new Error('Externe Kalender gibt es auf diesem Gerät nicht'));

export function ohneKalender(): Kalenderquelle {
  return {
    zugriff: async () => 'nichtVerfuegbar',
    kalender: async () => [],
    termine: async () => [],
    beiAenderung: () => () => {},
    terminAnlegen: NICHT, terminAendern: NICHT, terminLoeschen: NICHT, terminLesen: NICHT,
  };
}

/** Zwischenspeicher nur im Arbeitsspeicher */
export function speicherKalenderCache(): KalenderCache {
  let kalender: KalenderInfo[] = [];
  let termine: ExternerTermin[] = [];
  let zuletzt: string | null = null, von: Datum | null = null, bis: Datum | null = null;
  return {
    kalender: () => kalender,
    termine: (v, b) => termine.filter(t => t.datum >= v && t.datum <= b),
    ersetzen: (v, b, k, t) => {
      kalender = k;
      termine = [...termine.filter(x => x.datum < v || x.datum > b), ...t];
      zuletzt = new Date().toISOString();
      von = von && von < v ? von : v; bis = bis && bis > b ? bis : b;
    },
    stand: () => ({ zuletzt, von, bis }),
  };
}
