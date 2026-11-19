// Abgleich mit der Ablage (Phone App: Dropbox-API). Am Desktop übernimmt das der Dropbox-Client des
// Systems – dort gibt es diesen Provider nicht („nicht verfügbar“).

export type AbgleichStand = {
  verfuegbar: boolean;
  /** mit einem Dropbox-Konto verbunden */
  verbunden: boolean;
  konto: string | null;
  /** Gerätename = eigene Event-Datei */
  geraet: string;
  online: boolean;
  /** läuft gerade */
  laeuft: boolean;
  /** eigene Änderungen (Events, Bilder), die noch nicht in der Ablage liegen */
  wartend: number;
  /** letzter erfolgreicher Abgleich (ISO) */
  zuletzt: string | null;
  fehler: string | null;
  /** Browser-Speicher dauerhaft (iOS löscht sonst ggf. Daten); null = unbekannt */
  speicherDauerhaft: boolean | null;
};

export interface Abgleich {
  stand(): AbgleichStand;
  /** jetzt abgleichen (Fehler stehen danach im Stand) */
  abgleichen(): Promise<void>;
  /** Anmeldung bei Dropbox beginnen (verlässt ggf. die Seite) */
  verbinden(): Promise<void>;
  trennen(): Promise<void>;
  beiAenderung(cb: () => void): () => void;
}
