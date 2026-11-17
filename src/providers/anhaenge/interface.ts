// Ablage für Dateianhänge (Bilder an Notizen). Die Dateien liegen neben den Events im Datenordner.
export interface Anhangspeicher {
  speichern(id: string, daten: Uint8Array): void;
  /** null, wenn die Datei (noch) fehlt – z. B. weil Dropbox sie noch nicht synchronisiert hat */
  lesen(id: string): Uint8Array | null;
  entfernen(id: string): void;
}
