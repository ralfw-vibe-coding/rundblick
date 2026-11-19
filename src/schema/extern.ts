// Application state schema (kein Domain state): Daten aus externen Kalendern (EventKit).
import type { Datum, Minuten, Uhrzeit } from './werte';

export type KalenderInfo = {
  id: string;
  name: string;
  /** Konto, z. B. „iCloud“, „Google“, „Exchange“ */
  konto: string;
  /** Farbe als #rrggbb */
  farbe: string;
  /** darf Rundblick hier Einträge anlegen (Spiegelung)? */
  schreibbar?: boolean;
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
  /** Kennung beim Anbieter (geräteübergreifend gleich) – Grundlage der Spiegelung */
  uid?: string;
  notiz?: string;
  /** letzte Änderung beim Anbieter (ISO) – für „jüngere Änderung gewinnt“ */
  geaendert?: string | null;
  /** Vorkommen einer Terminserie */
  serie?: boolean;
};

/** Inhalt eines gespiegelten Termins */
export type TerminDaten = { titel: string; notiz: string; datum: Datum; start: Uhrzeit; dauer: Minuten };

/** Gerätebezogene Einstellung je externem Kalender */
export type KalenderEinstellung = { sichtbar: boolean; belegt: boolean };

export type KalenderZugriff = 'erlaubt' | 'verweigert' | 'unbestimmt' | 'nichtVerfuegbar';
