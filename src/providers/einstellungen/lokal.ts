// Geräte-Einstellungen im Browser (localStorage o. ä.), als JSON je Schlüssel unter einem Präfix.
import type { Einstellungen } from './interface';

export type SchluesselSpeicher = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export function lokaleEinstellungen(speicher: SchluesselSpeicher, praefix = 'rundblick.'): Einstellungen {
  return {
    lesen<T>(schluessel: string, standard: T): T {
      const roh = speicher.getItem(praefix + schluessel);
      if (roh === null) return standard;
      try { return JSON.parse(roh) as T; } catch { return standard; }
    },
    schreiben(schluessel, wert) { speicher.setItem(praefix + schluessel, JSON.stringify(wert)); },
  };
}
