// Application state schema (kein Domain state): Daten aus externen Kalendern (EventKit).
import type { Datum, Minuten, Uhrzeit } from './werte';

export type KalenderInfo = {
  id: string;
  name: string;
  /** Konto, z. B. „iCloud“, „Google“, „Exchange“ */
  konto: string;
  /** Farbe als #rrggbb */
  farbe: string;
};

export type ExternerTermin = {
  id: string;
  kalenderId: string;
  titel: string;
  datum: Datum;
  /** null = ganztägig */
  start: Uhrzeit | null;
  dauer: Minuten;
  ort: string;
};

/** Gerätebezogene Einstellung je externem Kalender */
export type KalenderEinstellung = { sichtbar: boolean; belegt: boolean };

export type KalenderZugriff = 'erlaubt' | 'verweigert' | 'unbestimmt' | 'nichtVerfuegbar';
