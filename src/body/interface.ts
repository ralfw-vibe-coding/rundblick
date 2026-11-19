// Body interface: das Einzige, was ein Client kennt.
// Commands ändern Zustand und liefern nur einen CommandStatus (plus IDs neu angelegter Objekte).
// Queries ändern nichts und liefern Daten (DTOs). Über beiAenderung erfahren Clients, was sich geändert hat.
import type { AbgleichStand } from '../providers/abgleich/interface';
import type { AktualisierungsStand } from '../providers/aktualisierung/interface';
import type { KalenderZugriff } from '../schema/extern';
import type { Datum, Id, KategorieId, Minuten, Uhrzeit, Wiederholung, Wochentag } from '../schema/werte';
export type { Wiederholung };

export type CommandStatus = { ok: true; ids?: Record<string, Id> } | { ok: false; fehler: string[] };
export type Bereich = 'aufgaben' | 'board' | 'kalender' | 'einstellungen' | 'aktualisierung' | 'abgleich';

/** Selbst-Aktualisierung aus einem Ordner: laufender Build und Stand */
export type Aktualisierung = { laufend: { version: string; build: number; commit?: string } | null; stand: AktualisierungsStand };
export type { AktualisierungsStand, AbgleichStand };

// ---------- DTOs ----------
/** entspricht den Abschnitten der Liste: überfällig · heute · diese Woche (bis Sonntag) · später */
export type Dringlichkeit = 'ueberfaellig' | 'heute' | 'woche' | 'spaeter';
export type StatusInfo = { id: Id; name: string; kategorie: KategorieId };

export type AufgabeZeile = {
  id: Id; titel: string; tags: string[]; verantwortlich: string; ort: string;
  frist: Datum | null; dringlichkeit: Dringlichkeit | null;
  wiedervorlage: Datum | null; zurueckgestellt: boolean;
  status: StatusInfo | null; abgeschlossen: boolean; archiviert: boolean;
  buchungen: { reservierungen: number; termine: number; gebucht: Minuten };
  /** Anzahl der Bildanhänge */
  anhaenge: number;
  /** wiederkehrend ab Frist (Symbol hinter der Frist) */
  wiederholung: Wiederholung | null;
};

export type AnhangInfo = { id: Id; nr: number; name: string; typ: string; groesse: number };

export type ListenGruppe = { art: 'ueberfaellig' | 'heute' | 'woche' | 'spaeter' | 'ohne'; name: string; aufgaben: AufgabeZeile[] };
export type Aufgabenliste = {
  heute: Datum; offen: number;
  /** frisch erfasst, noch nicht gesehen – stehen zusätzlich in ihrer normalen Gruppe */
  neu: AufgabeZeile[];
  gruppen: ListenGruppe[];
  zurueckgestellt: AufgabeZeile[];
  abgeschlossen: AufgabeZeile[];
  /** archivierte Aufgaben – verborgen, nur auf Wunsch angezeigt */
  archiv: AufgabeZeile[];
};

export type Board = {
  heute: Datum;
  kategorien: { id: KategorieId; name: string; anzahl: number; spalten: { id: Id; name: string; karten: AufgabeZeile[] }[] }[];
};

export type BuchungDto = {
  id: Id; aufgabeId: Id | null; titel: string; beschreibung: string; aufgabentitel: string | null;
  datum: Datum; start: Uhrzeit | null; dauer: Minuten; belegt: boolean; abgeschlossen: boolean;
  /** gespiegelt in Google/iCloud (Zielkalender), sonst null */
  spiegel: { kalender: string; konto: string; farbe: string; ursprung: 'rundblick' | 'extern' } | null;
  /** Hinweis an der Buchung, z. B. nach externem Löschen */
  hinweis: string | null;
  /** wo die zugehörige Aufgabe steht: auf dem Board (hat Status) oder nur in der Aufgabenliste; null = freie Buchung */
  herkunft: 'board' | 'liste' | null;
};

export type ExternDto = {
  id: string; kalender: string; konto: string; farbe: string; titel: string;
  /** Minuten seit Mitternacht; null = ganztägig */
  start: number | null; ende: number | null; belegt: boolean; ort: string;
  notiz: string; datum: Datum;
  /** darf Rundblick ihn löschen (Kalender beschreibbar)? */
  loeschbar: boolean;
  /** Vorkommen einer Serie – gelöscht wird nur dieses */
  serie: boolean;
};

export type Auslastung = { belegt: Minuten; eigene: Minuten; extern: Minuten; nichtBelegend: Minuten; kapazitaet: Minuten };

export type Tag = {
  datum: Datum;
  termine: (BuchungDto & { s: number; e: number })[];
  reservierungen: BuchungDto[];
  extern: ExternDto[];
  fristen: { aufgabeId: Id; titel: string; dringlichkeit: Dringlichkeit }[];
  wiedervorlagen: { aufgabeId: Id; titel: string }[];
  auslastung: Auslastung;
};

export type Zeitraum = { heute: Datum; jetzt: number; tage: Tag[] };

export type AufgabeDetails = AufgabeZeile & {
  beschreibung: string;
  buchungsliste: BuchungDto[];
  anhangliste: AnhangInfo[];
};

export type BuchungDetails = BuchungDto & { tag: Auslastung };

// ---------- Logbuch ----------
/** Ein Eintrag im Logbuch: abgeschlossene Aufgabe, abgehakter Checklisten-Punkt oder Notiz */
export type LogEintrag =
  | { art: 'aufgabe'; aufgabeId: Id; titel: string; tags: string[]; uhrzeit: Uhrzeit; archiviert: boolean }
  | { art: 'punkt'; aufgabeId: Id; aufgabentitel: string; text: string; uhrzeit: Uhrzeit }
  | { art: 'notiz'; notizId: Id; titel: string; vorschau: string; tags: string[]; bilder: number; uhrzeit: Uhrzeit | null };
export type LogbuchTag = { datum: Datum; eintraege: LogEintrag[] };
/** Tage mit Einträgen, neuester zuerst; `weiter` = ältester noch nicht gelieferter Tag (fürs Nachladen) */
export type Logbuch = { heute: Datum; tage: LogbuchTag[]; weiter: Datum | null };
export type NotizDetails = { id: Id; text: string; tags: string[]; datum: Datum; erfasst: string; anhangliste: AnhangInfo[] };

export type KalenderEintrag = { id: string; name: string; konto: string; farbe: string; sichtbar: boolean; belegt: boolean; schreibbar: boolean };

export type EinstellungenDto = {
  /** die drei Spaltengruppen in fester Reihenfolge mit ihren (ggf. umbenannten) Namen */
  kategorien: { id: KategorieId; name: string }[];
  spalten: StatusInfo[];
  kapazitaet: Minuten[];
  standarddauer: Minuten;
  /** im Kalender sichtbare Tageszeit (volle Stunden, pro Gerät); davor/danach nur bei Terminen oder auf Wunsch */
  tageszeit: { von: number; bis: number };
  kalender: KalenderEintrag[];
  zugriff: KalenderZugriff;
  letzteSynchronisation: string | null;
  datenordner: string;
  geraet: string;
};

export type ErfassungVorschau = {
  titel: string; tags: string[]; verantwortlich: string; ort: string;
  frist: Datum | null; wiedervorlage: Datum | null; status: StatusInfo | null;
  buchung: { datum: Datum; start: Uhrzeit | null; dauer: Minuten } | null;
  nurBuchung: boolean; fehler: string[];
};

/** UI-Zustand (pro Gerät): Arbeitsbereiche des Rasters – für den Body ein undurchsichtiger Wert */
export type Layout = { arbeitsbereiche: unknown[]; aktiv: number } | null;

export type AufgabeEingabe = {
  titel: string; beschreibung?: string; ort?: string; verantwortlich?: string; tags?: string[];
  frist?: Datum | null; wiedervorlage?: Datum | null; status?: Id | null;
  buchung?: { datum: Datum; start?: Uhrzeit | null; dauer?: Minuten };
  /** steht unter „Neu“, bis sie gesehen wird (Standard: ja – frisch Erfasstes; Import: nein) */
  neu?: boolean;
  /** wiederkehrend ab Frist (nur mit Frist); null = Wiederholung beenden */
  wiederholung?: Wiederholung | null;
};

export interface Body {
  // ---- Commands: Aufgaben
  aufgabeErfassen(c: AufgabeEingabe): Promise<CommandStatus>;
  schnellErfassen(c: { text: string }): Promise<CommandStatus>;
  aufgabeAendern(c: { aufgabeId: Id; aenderungen: Partial<Omit<AufgabeEingabe, 'status' | 'buchung'>> }): Promise<CommandStatus>;
  statusSetzen(c: { aufgabeId: Id; status: Id | null }): Promise<CommandStatus>;
  aufgabeAbschliessen(c: { aufgabeId: Id }): Promise<CommandStatus>;
  aufgabeWiedereroeffnen(c: { aufgabeId: Id }): Promise<CommandStatus>;
  aufgabeVerwerfen(c: { aufgabeId: Id }): Promise<CommandStatus>;
  aufgabeArchivieren(c: { aufgabeId: Id }): Promise<CommandStatus>;
  /** neue Aufgabe gesehen (geöffnet oder weggewischt) → verlässt „Neu“ auf allen Geräten */
  aufgabeGesehen(c: { aufgabeId: Id }): Promise<CommandStatus>;
  aufgabeAusArchivHolen(c: { aufgabeId: Id }): Promise<CommandStatus>;
  /** Bild an die Notiz hängen; daten = Base64 */
  anhangHinzufuegen(c: { aufgabeId: Id; name: string; typ: string; daten: string }): Promise<CommandStatus>;
  anhangEntfernen(c: { aufgabeId: Id; anhangId: Id }): Promise<CommandStatus>;
  /** Manuell priorisieren: Aufgabe zwischen zwei Nachbarn einsortieren (oben/unten = Nachbar-IDs oder null am Rand) */
  aufgabeVerschieben(c: { aufgabeId: Id; oben: Id | null; unten: Id | null }): Promise<CommandStatus>;
  // ---- Commands: Buchungen
  buchungAnlegen(c: { aufgabeId: Id; datum: Datum; start?: Uhrzeit | null; dauer?: Minuten }): Promise<CommandStatus>;
  buchungEintragen(c: { titel: string; beschreibung?: string; datum: Datum; start?: Uhrzeit | null; dauer?: Minuten }): Promise<CommandStatus>;
  buchungAendern(c: { buchungId: Id; titel?: string; beschreibung?: string; belegt?: boolean; datum?: Datum; start?: Uhrzeit | null; dauer?: Minuten }): Promise<CommandStatus>;
  buchungStornieren(c: { buchungId: Id }): Promise<CommandStatus>;
  aufgabeAusBuchung(c: { buchungId: Id; status?: Id | null }): Promise<CommandStatus>;
  /** Termin in Google/iCloud spiegeln (Zwei-Wege-Sync) */
  buchungSpiegeln(c: { buchungId: Id; kalenderId: string }): Promise<CommandStatus>;
  /** Spiegelung beenden – Buchung und externer Eintrag bleiben bestehen */
  verknuepfungLoesen(c: { buchungId: Id }): Promise<CommandStatus>;
  /** externen Termin von Hand zu einer Aufgabe machen; die Buchung bleibt mit dem Termin verknüpft */
  aufgabeAusExtern(c: { externId: string }): Promise<CommandStatus>;
  /** externen Termin in Google/iCloud löschen (bei Serien nur dieses Vorkommen) */
  externLoeschen(c: { externId: string }): Promise<CommandStatus>;
  // ---- Commands: Board & Planung
  spalteAnlegen(c: { name: string; kategorie: KategorieId }): Promise<CommandStatus>;
  spalteUmbenennen(c: { statusId: Id; name: string }): Promise<CommandStatus>;
  kategorieUmbenennen(c: { kategorie: KategorieId; name: string }): Promise<CommandStatus>;
  spaltenSortieren(c: { kategorie: KategorieId; reihenfolge: Id[] }): Promise<CommandStatus>;
  spalteEntfernen(c: { statusId: Id }): Promise<CommandStatus>;
  tageskapazitaetFestlegen(c: { wochentag: Wochentag; minuten: Minuten }): Promise<CommandStatus>;
  standarddauerFestlegen(c: { minuten: Minuten }): Promise<CommandStatus>;
  tageszeitFestlegen(c: { von: number; bis: number }): Promise<CommandStatus>;
  // ---- Commands: externe Kalender & Gerät
  kalenderEinstellen(c: { kalenderId: string; sichtbar?: boolean; belegt?: boolean }): Promise<CommandStatus>;
  kalenderZugriffAnfragen(): Promise<CommandStatus>;
  synchronisieren(): Promise<CommandStatus>;
  layoutSpeichern(c: { layout: Layout }): Promise<CommandStatus>;

  // ---- Commands: Notizen (Logbuch)
  /** Ohne `tags` werden #tags aus dem Text übernommen (und dort entfernt); ohne `datum` gilt heute */
  notizErfassen(c: { text: string; tags?: string[]; datum?: Datum }): Promise<CommandStatus>;
  notizAendern(c: { notizId: Id; text?: string; tags?: string[]; datum?: Datum }): Promise<CommandStatus>;
  notizVerwerfen(c: { notizId: Id }): Promise<CommandStatus>;
  notizAnhangHinzufuegen(c: { notizId: Id; name: string; typ: string; daten: string }): Promise<CommandStatus>;
  notizAnhangEntfernen(c: { notizId: Id; anhangId: Id }): Promise<CommandStatus>;
  /** Aus der Notiz wird eine Aufgabe (erste Zeile = Titel); liefert die aufgabeId */
  aufgabeAusNotiz(c: { notizId: Id }): Promise<CommandStatus>;

  // ---- Queries
  /** ohneStatus: Aufgaben mit Board-Status ausblenden (Aufgabenliste); ohne den Schalter alle (z. B. Fristen im Kalender) */
  liste(q: { filter?: string; ohneStatus?: boolean }): Promise<Aufgabenliste>;
  /** Warnungen zum Datenstand – z. B. Events, die diese App nicht deuten kann, weil ein anderes Gerät neuer ist */
  datenstand(): Promise<{ zuNeu: number }>;
  board(): Promise<Board>;
  zeitraum(q: { von: Datum; bis: Datum }): Promise<Zeitraum>;
  aufgabe(q: { aufgabeId: Id }): Promise<AufgabeDetails | null>;
  buchung(q: { buchungId: Id }): Promise<BuchungDetails | null>;
  einstellungen(): Promise<EinstellungenDto>;
  erfassungVorschau(q: { text: string }): Promise<ErfassungVorschau>;
  vorschlaege(q: { art: 'tag' | 'person' | 'ort'; praefix: string }): Promise<string[]>;
  layout(): Promise<Layout>;
  heute(): Promise<{ datum: Datum; minute: number }>;
  /** Logbuch ab `bis` (Standard: heute bzw. spätester Eintrag) rückwärts, höchstens `tage` Tage mit Einträgen */
  logbuch(q: { bis?: Datum | null; tage?: number; filter?: string }): Promise<Logbuch>;
  notiz(q: { notizId: Id }): Promise<NotizDetails | null>;
  /** Bild als data:-URL (null, wenn unbekannt oder die Datei noch nicht synchronisiert ist) */
  anhang(q: { anhangId: Id }): Promise<{ name: string; typ: string; url: string } | null>;

  // ---- Benachrichtigung
  // ---- Selbst-Aktualisierung (Gerät)
  aktualisierung(): Promise<Aktualisierung>;
  aktualisierungOrdnerWaehlen(): Promise<CommandStatus>;
  aktualisierungOrdnerEntfernen(): Promise<CommandStatus>;
  aktualisierungPruefen(): Promise<CommandStatus>;
  aktualisierungInstallieren(): Promise<CommandStatus>;

  // ---- Abgleich mit der Dropbox (Phone App; am Desktop „nicht verfügbar“)
  abgleich(): Promise<AbgleichStand>;
  abgleichen(): Promise<CommandStatus>;
  abgleichVerbinden(): Promise<CommandStatus>;
  abgleichTrennen(): Promise<CommandStatus>;

  beiAenderung(cb: (bereiche: Bereich[]) => void): () => void;
}

/** Namen aller Methoden außer der Benachrichtigung – für die IPC-Brücke */
export type BodyMethode = Exclude<keyof Body, 'beiAenderung'>;
export const BODY_METHODEN: readonly BodyMethode[] = [
  'abgleich', 'abgleichen', 'abgleichVerbinden', 'abgleichTrennen',
  'aktualisierung', 'aktualisierungOrdnerWaehlen', 'aktualisierungOrdnerEntfernen', 'aktualisierungPruefen', 'aktualisierungInstallieren',
  'aufgabeErfassen', 'schnellErfassen', 'aufgabeAendern', 'statusSetzen', 'aufgabeAbschliessen', 'aufgabeWiedereroeffnen', 'aufgabeVerwerfen', 'aufgabeArchivieren', 'aufgabeGesehen', 'aufgabeAusArchivHolen', 'anhangHinzufuegen', 'anhangEntfernen', 'aufgabeVerschieben',
  'buchungAnlegen', 'buchungEintragen', 'buchungAendern', 'buchungStornieren', 'aufgabeAusBuchung', 'buchungSpiegeln', 'verknuepfungLoesen', 'aufgabeAusExtern', 'externLoeschen',
  'spalteAnlegen', 'spalteUmbenennen', 'kategorieUmbenennen', 'spaltenSortieren', 'spalteEntfernen', 'tageskapazitaetFestlegen', 'standarddauerFestlegen', 'tageszeitFestlegen',
  'kalenderEinstellen', 'kalenderZugriffAnfragen', 'synchronisieren', 'layoutSpeichern',
  'notizErfassen', 'notizAendern', 'notizVerwerfen', 'notizAnhangHinzufuegen', 'notizAnhangEntfernen', 'aufgabeAusNotiz', 'logbuch', 'notiz',
  'liste', 'datenstand', 'board', 'zeitraum', 'aufgabe', 'buchung', 'einstellungen', 'erfassungVorschau', 'vorschlaege', 'layout', 'heute', 'anhang',
];
