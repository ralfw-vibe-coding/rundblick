// Zugang zur Dropbox (App-Ordner „Apps/Rundblick“) für die Phone App – ohne Server, direkt aus dem Browser.
// Anmeldung per OAuth 2 mit PKCE (nur öffentlicher App-Key, kein Secret), Refresh-Token auf dem Gerät.

export type DropboxToken = { zugriff: string; erneuern: string; ablauf: number };
export type DropboxEintrag = { pfad: string; name: string; rev: string; groesse: number };

/** Netzwerk nicht erreichbar (offline, Zeitüberschreitung) */
export class DropboxOffline extends Error {}
/** Anmeldung fehlt oder ist abgelaufen/widerrufen – neu verbinden */
export class DropboxAnmeldung extends Error {}

export interface Dropbox {
  angemeldet(): boolean;
  /** Startet die Anmeldung: liefert die URL der Dropbox-Anmeldeseite (Verifier wird gemerkt) */
  anmeldeUrl(): Promise<string>;
  /** Rückkehr von der Anmeldeseite: Code gegen Token tauschen */
  anmeldungAbschliessen(code: string): Promise<void>;
  abmelden(): Promise<void>;
  konto(): Promise<{ name: string }>;

  /** Ordnerinhalt (nicht rekursiv); mit Cursor nur Änderungen seither */
  auflisten(ordner: string, cursor: string | null): Promise<{ eintraege: DropboxEintrag[]; cursor: string; mehr: boolean }>;
  /** Datei ab Byte `ab` laden; null = gibt es nicht */
  laden(pfad: string, ab?: number): Promise<{ daten: Uint8Array; rev: string } | null>;
  /** Datei schreiben: rev null = neu anlegen (Konflikt, falls schon da), sonst nur, wenn die Revision noch stimmt */
  hochladen(pfad: string, daten: Uint8Array, rev: string | null, ueberschreiben?: boolean): Promise<{ ok: true; rev: string } | { ok: false; konflikt: true }>;
  loeschen(pfad: string): Promise<void>;
  /** Longpoll: wartet bis zu `sekunden` auf Änderungen nach dem Cursor */
  warten(cursor: string, sekunden?: number): Promise<{ aenderungen: boolean; pause: number }>;
}
