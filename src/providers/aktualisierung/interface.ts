// Provider: Selbst-Aktualisierung aus einem Ordner (z. B. Dropbox oder dist/ des Repos).
// Ohne Server, ohne Notarisierung: ZIPs mit signierten Builds; die App prüft Build-Nummer und Signatur.

export type BuildInfo = { version: string; build: number; commit?: string; arch?: string };
export type UpdateAngebot = { version: string; build: number; commit?: string; datei: string };

export type AktualisierungsStand =
  | { stand: 'nichtVerfuegbar' }                                                   // Entwicklung (ohne Build-Angaben)
  | { stand: 'aus' }                                                               // kein Ordner gewählt
  | { stand: 'aktuell'; ordner: string; geprueft: string }
  | { stand: 'verfuegbar'; ordner: string; geprueft: string; angebot: UpdateAngebot }
  | { stand: 'installiert'; ordner: string; angebot: UpdateAngebot }              // läuft gerade
  | { stand: 'fehler'; ordner: string; meldung: string };

export interface Aktualisierer {
  /** laufender Build (null in der Entwicklung) */
  laufend(): BuildInfo | null;
  stand(): AktualisierungsStand;
  /** Systemdialog zur Ordnerwahl; danach wird geprüft */
  ordnerWaehlen(): Promise<AktualisierungsStand>;
  ordnerEntfernen(): AktualisierungsStand;
  pruefen(): Promise<AktualisierungsStand>;
  /** entpackt, prüft Signatur und tauscht die App aus (beendet die App) */
  installieren(): Promise<AktualisierungsStand>;
  beiAenderung(cb: (s: AktualisierungsStand) => void): () => void;
}
