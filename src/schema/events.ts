// Application state schema: die Events des Domain state.
// Events werden nie umgeschrieben. Ändert sich ein Format, wird beim Lesen hochgerechnet (Upcaster).
import type { Datum, Id, KategorieId, Minuten, Uhrzeit, Wiederholung, Wochentag } from './werte';

export const SCHEMA_VERSION = 2;

/**
 * Schema-Version je Event-Typ: Jedes Event trägt die Version, die man mindestens kennen muss, um es richtig zu verstehen.
 * Ältere Apps überspringen nur diese Events (und melden „bitte aktualisieren“), alles andere lesen sie weiter.
 * 2: Wiederholungen (eine ältere App würde nach dem Weiterspringen die alte Frist zeigen).
 */
const AB_VERSION: Partial<Record<string, number>> = {
  WiederholungGesetzt: 2, WiederholungAufgehoben: 2, WiederholungErledigt: 2,
  KalenderauftragErteilt: 2, KalenderauftragErledigt: 2,
};
export const schemaVon = (typ: string): number => AB_VERSION[typ] ?? 1;

type E<T extends string, D> = { typ: T; daten: D };

export type DomainEvent =
  // ---- Aufgaben
  | E<'AufgabeErfasst', {
      aufgabeId: Id; titel: string; beschreibung: string; ort: string; verantwortlich: string;
      tags: string[]; frist: Datum | null; wiedervorlage: Datum | null; status: Id | null;
      /** frisch erfasst → steht unter „Neu“, bis sie gesehen wird; fehlt das Feld (ältere Events), gilt sie als gesehen */
      neu?: boolean;
    }>
  | E<'AufgabeGesehen', { aufgabeId: Id }>
  /** Wiederholung ab der aktuellen Frist (Anker); Frist ändern verschiebt den Anker */
  | E<'WiederholungGesetzt', { aufgabeId: Id; wiederholung: Wiederholung }>
  | E<'WiederholungAufgehoben', { aufgabeId: Id }>
  /** wiederkehrende Aufgabe abgehakt: fürs Logbuch erledigt, Frist springt auf den nächsten Termin (nach heute) */
  | E<'WiederholungErledigt', { aufgabeId: Id; naechsteFrist: Datum }>
  | E<'AufgabeUmbenannt', { aufgabeId: Id; titel: string }>
  | E<'BeschreibungGeaendert', { aufgabeId: Id; beschreibung: string }>
  | E<'OrtGeaendert', { aufgabeId: Id; ort: string }>
  | E<'VerantwortlicherGeaendert', { aufgabeId: Id; verantwortlich: string }>
  | E<'AufgabeGetaggt', { aufgabeId: Id; tag: string }>
  | E<'TagEntfernt', { aufgabeId: Id; tag: string }>
  | E<'FristGesetzt', { aufgabeId: Id; frist: Datum }>
  | E<'FristEntfernt', { aufgabeId: Id }>
  | E<'WiedervorlageGesetzt', { aufgabeId: Id; datum: Datum }>
  | E<'WiedervorlageAufgehoben', { aufgabeId: Id }>
  | E<'StatusGesetzt', { aufgabeId: Id; status: Id }>
  | E<'StatusEntfernt', { aufgabeId: Id }>
  | E<'AufgabeAbgeschlossen', { aufgabeId: Id }>
  | E<'AufgabeWiedereroeffnet', { aufgabeId: Id }>
  | E<'AufgabeVerworfen', { aufgabeId: Id }>
  | E<'AufgabeArchiviert', { aufgabeId: Id }>
  | E<'AnhangHinzugefuegt', { aufgabeId: Id; anhangId: Id; name: string; typ: string; groesse: number }>
  | E<'AnhangEntfernt', { aufgabeId: Id; anhangId: Id }>
  /** manuelle Priorisierung: kleinerer Rang = weiter oben */
  | E<'AufgabeEinsortiert', { aufgabeId: Id; rang: number }>
  | E<'AufgabeAusArchivGeholt', { aufgabeId: Id }>
  // ---- Buchungen (ohne aufgabeId = freie Buchung; ohne start = Reservierung)
  | E<'BuchungAngelegt', {
      buchungId: Id; aufgabeId: Id | null; titel: string; beschreibung: string;
      datum: Datum; dauer: Minuten; start: Uhrzeit | null; belegt: boolean;
    }>
  | E<'BuchungUmbenannt', { buchungId: Id; titel: string }>
  | E<'BuchungsbeschreibungGeaendert', { buchungId: Id; beschreibung: string }>
  | E<'BuchungsbelegungGeaendert', { buchungId: Id; belegt: boolean }>
  | E<'BuchungVerschoben', { buchungId: Id; datum: Datum; start: Uhrzeit | null }>
  | E<'BuchungsdauerGeaendert', { buchungId: Id; dauer: Minuten }>
  | E<'BuchungStorniert', { buchungId: Id }>
  // ---- Spiegelung in Google/iCloud (nur Termine): Verknüpfung über die UID beim Anbieter, „stand“ = Fingerabdruck beim letzten Abgleich
  // ursprung: 'rundblick' = von Rundblick angelegt (wird beim Löschen der Buchung mitgelöscht), 'extern' = war zuerst extern da (bleibt).
  // Fehlt die Angabe (ältere Events), gilt 'rundblick'.
  | E<'BuchungVerknuepft', { buchungId: Id; kalenderId: string; kalender: string; konto: string; farbe: string; externeUid: string; stand: string; ursprung?: 'rundblick' | 'extern' }>
  | E<'BuchungAbgeglichen', { buchungId: Id; stand: string }>
  | E<'VerknuepfungGeloest', { buchungId: Id; grund: 'manuell' | 'externGeloescht' }>
  | E<'AufgabeAusBuchungErstellt', { aufgabeId: Id; buchungId: Id; titel: string; beschreibung: string; status: Id | null }>
  // ---- Kalender-Aufträge: ein Gerät ohne direkten Kalenderzugang (Phone, Kalender aus der Ablage) bittet ein Gerät
  // mit Zugang (Mac), einen externen Termin anzulegen (Spiegeln), zu verschieben oder zu löschen.
  | E<'KalenderauftragErteilt', {
      auftragId: Id; art: 'spiegeln' | 'verschieben' | 'loeschen';
      /** spiegeln: die Buchung; loeschen einer gespiegelten Buchung: auch */
      buchungId?: Id;
      /** Zielkalender (spiegeln) bzw. Kalender des Termins – Kennung ist gerätebezogen, Name + Konto helfen beim Wiederfinden */
      kalender: { id: string; name: string; konto: string };
      /** verschieben/loeschen: welches Vorkommen */
      termin?: { terminId: string; uid?: string; titel: string; datum: Datum; start: Uhrzeit | null; dauer: Minuten };
      /** verschieben: wohin */
      ziel?: { datum: Datum; start: Uhrzeit; dauer: Minuten };
    }>
  | E<'KalenderauftragErledigt', { auftragId: Id; ok: boolean; meldung: string; geraet: string }>
  // ---- Notizen (Logbuch): nur Text, Tags, Bilder und ein Tag; quasi schon erledigt
  | E<'NotizErfasst', { notizId: Id; text: string; tags: string[]; datum: Datum }>
  | E<'NotizTextGeaendert', { notizId: Id; text: string }>
  | E<'NotizGetaggt', { notizId: Id; tag: string }>
  | E<'NotizTagEntfernt', { notizId: Id; tag: string }>
  | E<'NotizDatumGeaendert', { notizId: Id; datum: Datum }>
  | E<'NotizAnhangHinzugefuegt', { notizId: Id; anhangId: Id; name: string; typ: string; groesse: number }>
  | E<'NotizAnhangEntfernt', { notizId: Id; anhangId: Id }>
  | E<'NotizVerworfen', { notizId: Id }>
  /** aus einer Notiz wird eine Aufgabe; die Notiz verschwindet aus dem Logbuch */
  | E<'AufgabeAusNotizErstellt', { aufgabeId: Id; notizId: Id; titel: string; beschreibung: string; tags: string[]; anhaenge: { id: Id; name: string; typ: string; groesse: number }[] }>
  // ---- Board
  | E<'StatusspalteAngelegt', { statusId: Id; name: string; kategorie: KategorieId }>
  | E<'StatusspalteUmbenannt', { statusId: Id; name: string }>
  | E<'KategorieUmbenannt', { kategorie: KategorieId; name: string }>
  | E<'StatusspaltenSortiert', { kategorie: KategorieId; reihenfolge: Id[] }>
  | E<'StatusspalteEntfernt', { statusId: Id }>
  // ---- Planung
  | E<'TageskapazitaetFestgelegt', { wochentag: Wochentag; minuten: Minuten }>
  | E<'StandarddauerFestgelegt', { minuten: Minuten }>;

export type EventTyp = DomainEvent['typ'];
export type EventDaten<T extends EventTyp> = Extract<DomainEvent, { typ: T }>['daten'];

/** Ein Event, wie die Domain es anhängen möchte */
export type NeuesEvent = DomainEvent & { tags: string[] };

export type EventMeta = {
  schema: number;
  /** Gerät, das das Event geschrieben hat */
  geraet: string;
  /** Hybrid Logical Clock: geräteübergreifend sortierbar */
  hlc: string;
};

/** Ein gespeichertes Event (eine Zeile in der JSONL-Datei, plus Position im Speicher) */
export type GespeichertesEvent = NeuesEvent & {
  id: Id;
  zeit: string;
  meta: EventMeta;
  /** laufende Nummer im gelesenen Strom dieses Prozesses; wird nicht gespeichert */
  position: number;
};

// Tag-Konventionen
export const tag = {
  aufgabe: (id: Id) => `aufgabe:${id}`,
  buchung: (id: Id) => `buchung:${id}`,
  notiz: (id: Id) => `notiz:${id}`,
  spalten: 'spalten',
  planung: 'planung',
  kalenderauftraege: 'kalenderauftraege',
} as const;
