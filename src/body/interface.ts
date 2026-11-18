// Body interface: das Einzige, was ein Client kennt.
// Commands ändern Zustand und liefern nur einen CommandStatus (plus IDs neu angelegter Objekte).
// Queries ändern nichts und liefern Daten (DTOs). Über beiAenderung erfahren Clients, was sich geändert hat.
import type { KalenderZugriff } from '../schema/extern';
import type { Datum, Id, KategorieId, Minuten, Uhrzeit, Wochentag } from '../schema/werte';

export type CommandStatus = { ok: true; ids?: Record<string, Id> } | { ok: false; fehler: string[] };
export type Bereich = 'aufgaben' | 'board' | 'kalender' | 'einstellungen';

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
};

export type AnhangInfo = { id: Id; nr: number; name: string; typ: string; groesse: number };

export type ListenGruppe = { art: 'ueberfaellig' | 'heute' | 'woche' | 'spaeter' | 'ohne'; name: string; aufgaben: AufgabeZeile[] };
export type Aufgabenliste = {
  heute: Datum; offen: number;
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
};

export type ExternDto = {
  id: string; kalender: string; konto: string; farbe: string; titel: string;
  /** Minuten seit Mitternacht; null = ganztägig */
  start: number | null; ende: number | null; belegt: boolean; ort: string;
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

export type KalenderEintrag = { id: string; name: string; konto: string; farbe: string; sichtbar: boolean; belegt: boolean };

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

  // ---- Queries
  liste(q: { filter?: string }): Promise<Aufgabenliste>;
  board(): Promise<Board>;
  zeitraum(q: { von: Datum; bis: Datum }): Promise<Zeitraum>;
  aufgabe(q: { aufgabeId: Id }): Promise<AufgabeDetails | null>;
  buchung(q: { buchungId: Id }): Promise<BuchungDetails | null>;
  einstellungen(): Promise<EinstellungenDto>;
  erfassungVorschau(q: { text: string }): Promise<ErfassungVorschau>;
  vorschlaege(q: { art: 'tag' | 'person' | 'ort'; praefix: string }): Promise<string[]>;
  layout(): Promise<Layout>;
  heute(): Promise<{ datum: Datum; minute: number }>;
  /** Bild als data:-URL (null, wenn unbekannt oder die Datei noch nicht synchronisiert ist) */
  anhang(q: { anhangId: Id }): Promise<{ name: string; typ: string; url: string } | null>;

  // ---- Benachrichtigung
  beiAenderung(cb: (bereiche: Bereich[]) => void): () => void;
}

/** Namen aller Methoden außer der Benachrichtigung – für die IPC-Brücke */
export type BodyMethode = Exclude<keyof Body, 'beiAenderung'>;
export const BODY_METHODEN: readonly BodyMethode[] = [
  'aufgabeErfassen', 'schnellErfassen', 'aufgabeAendern', 'statusSetzen', 'aufgabeAbschliessen', 'aufgabeWiedereroeffnen', 'aufgabeVerwerfen', 'aufgabeArchivieren', 'aufgabeAusArchivHolen', 'anhangHinzufuegen', 'anhangEntfernen', 'aufgabeVerschieben',
  'buchungAnlegen', 'buchungEintragen', 'buchungAendern', 'buchungStornieren', 'aufgabeAusBuchung',
  'spalteAnlegen', 'spalteUmbenennen', 'kategorieUmbenennen', 'spaltenSortieren', 'spalteEntfernen', 'tageskapazitaetFestlegen', 'standarddauerFestlegen', 'tageszeitFestlegen',
  'kalenderEinstellen', 'kalenderZugriffAnfragen', 'synchronisieren', 'layoutSpeichern',
  'liste', 'board', 'zeitraum', 'aufgabe', 'buchung', 'einstellungen', 'erfassungVorschau', 'vorschlaege', 'layout', 'heute', 'anhang',
];
