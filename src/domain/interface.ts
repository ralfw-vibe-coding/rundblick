// Domain interface: Entscheidungen über Commands und Lesezugriff auf den eigenen Zustand.
// IDs und Zeit kommen als Parameter (vom Body); die Domain kennt nur den Event Store.
import type { Datum, Id, KategorieId, Minuten, Uhrzeit, Wochentag } from '../schema/werte';
import type { AufgabeAenderungen, AufgabeFelder } from './commands/aufgaben';
import type { Ergebnis } from './commands/basis';
import type { BuchungAenderungen, VerknuepfungEingabe } from './commands/buchungen';
import type { NotizAenderungen } from './commands/notizen';
import type { AnhangZ, AufgabeZ, BuchungZ, NotizZ, PlanungZ, SpalteZ } from './zustand';

export type { NotizAenderungen, NotizZ };
export type { VerknuepfungEingabe };
export type { AufgabeAenderungen, AufgabeFelder, BuchungAenderungen, Ergebnis, AnhangZ, AufgabeZ, BuchungZ, PlanungZ, SpalteZ };

export interface DomainInterface {
  // ---- Commands
  aufgabeErfassen(c: { aufgabeId: Id; felder: AufgabeFelder; buchung?: { buchungId: Id; datum: Datum; start?: Uhrzeit | null; dauer?: Minuten } }): Ergebnis;
  aufgabeAendern(c: { aufgabeId: Id; aenderungen: AufgabeAenderungen }): Ergebnis;
  statusSetzen(c: { aufgabeId: Id; status: Id | null }): Ergebnis;
  /** heute: nötig, damit wiederkehrende Aufgaben auf den nächsten Termin nach heute springen */
  aufgabeAbschliessen(c: { aufgabeId: Id; heute?: Datum }): Ergebnis;
  aufgabeWiedereroeffnen(c: { aufgabeId: Id }): Ergebnis;
  aufgabeVerwerfen(c: { aufgabeId: Id }): Ergebnis;
  aufgabeArchivieren(c: { aufgabeId: Id }): Ergebnis;
  aufgabeGesehen(c: { aufgabeId: Id }): Ergebnis;
  aufgabeAusArchivHolen(c: { aufgabeId: Id }): Ergebnis;
  anhangHinzufuegen(c: { aufgabeId: Id; anhangId: Id; name: string; typ: string; groesse: number }): Ergebnis;
  anhangEntfernen(c: { aufgabeId: Id; anhangId: Id }): Ergebnis;
  aufgabeEinsortieren(c: { aufgabeId: Id; rang: number }): Ergebnis;
  buchungAnlegen(c: { buchungId: Id; aufgabeId: Id; datum: Datum; start?: Uhrzeit | null; dauer?: Minuten; titel?: string }): Ergebnis;
  buchungEintragen(c: { buchungId: Id; titel: string; beschreibung?: string; datum: Datum; start?: Uhrzeit | null; dauer?: Minuten; belegt?: boolean }): Ergebnis;
  buchungAendern(c: { buchungId: Id; aenderungen: BuchungAenderungen }): Ergebnis;
  buchungStornieren(c: { buchungId: Id }): Ergebnis;
  buchungVerknuepfen(c: VerknuepfungEingabe): Ergebnis;
  buchungAbgleichen(c: { buchungId: Id; stand: string }): Ergebnis;
  verknuepfungLoesen(c: { buchungId: Id; grund: 'manuell' | 'externGeloescht' }): Ergebnis;
  aufgabeAusBuchung(c: { buchungId: Id; aufgabeId: Id; status?: Id | null }): Ergebnis;
  standardspaltenEinrichten(): Ergebnis;
  spalteAnlegen(c: { statusId: Id; name: string; kategorie: KategorieId }): Ergebnis;
  spalteUmbenennen(c: { statusId: Id; name: string }): Ergebnis;
  kategorieUmbenennen(c: { kategorie: KategorieId; name: string }): Ergebnis;
  spaltenSortieren(c: { kategorie: KategorieId; reihenfolge: Id[] }): Ergebnis;
  spalteEntfernen(c: { statusId: Id }): Ergebnis;
  tageskapazitaetFestlegen(c: { wochentag: Wochentag; minuten: Minuten }): Ergebnis;
  standarddauerFestlegen(c: { minuten: Minuten }): Ergebnis;
  // ---- Commands: Notizen (Logbuch)
  notizErfassen(c: { notizId: Id; text: string; tags?: string[]; datum: Datum }): Ergebnis;
  notizAendern(c: { notizId: Id; aenderungen: NotizAenderungen }): Ergebnis;
  notizVerwerfen(c: { notizId: Id }): Ergebnis;
  notizAnhangHinzufuegen(c: { notizId: Id; anhangId: Id; name: string; typ: string; groesse: number }): Ergebnis;
  notizAnhangEntfernen(c: { notizId: Id; anhangId: Id }): Ergebnis;
  aufgabeAusNotiz(c: { notizId: Id; aufgabeId: Id }): Ergebnis;

  // ---- Queries (aus der Projektion im Speicher)
  /** alle nicht verworfenen Aufgaben (auch archivierte), in Erfassungsreihenfolge */
  aufgaben(): AufgabeZ[];
  aufgabe(id: Id): AufgabeZ | null;
  /** nicht stornierte Buchungen, optional auf einen Datumsbereich begrenzt */
  buchungen(von?: Datum, bis?: Datum): BuchungZ[];
  buchung(id: Id): BuchungZ | null;
  buchungenDerAufgabe(aufgabeId: Id): BuchungZ[];
  /** aktive Spalten, sortiert nach Kategorie und Rang */
  spalten(): SpalteZ[];
  /** die drei Kategorien in fester Reihenfolge mit ihren (ggf. umbenannten) Namen */
  kategorien(): { id: KategorieId; name: string }[];
  planung(): PlanungZ;
  /** Notizen, die im Logbuch stehen (nicht verworfen, nicht zur Aufgabe geworden) */
  notizen(): NotizZ[];
  notiz(id: Id): NotizZ | null;

  /** meldet jede Änderung des Domain state (auch Events anderer Geräte) */
  beiAenderung(cb: () => void): () => void;
}
