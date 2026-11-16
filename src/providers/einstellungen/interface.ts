// Gerätebezogene Einstellungen (lokal, nicht in der Dropbox): Layouts, Kalender-Auswahl, Datenordner …
export interface Einstellungen {
  lesen<T>(schluessel: string, standard: T): T;
  schreiben(schluessel: string, wert: unknown): void;
}
