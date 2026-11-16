// Grundlegende Werttypen, die alle Schichten teilen (reine Typen, keine Logik).

export type Id = string;
/** Kalenderdatum im Format YYYY-MM-DD (lokale Zeit) */
export type Datum = string;
/** Uhrzeit im Format HH:MM */
export type Uhrzeit = string;
export type Minuten = number;

export type KategorieId = 'nichtBegonnen' | 'begonnen' | 'beendet';
export const KATEGORIEN: readonly { id: KategorieId; name: string }[] = [
  { id: 'nichtBegonnen', name: 'Nicht begonnen' },
  { id: 'begonnen', name: 'Begonnen' },
  { id: 'beendet', name: 'Beendet' },
];

/** 1 = Montag … 7 = Sonntag */
export type Wochentag = 1 | 2 | 3 | 4 | 5 | 6 | 7;
