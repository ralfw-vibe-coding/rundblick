// Reine Entwicklungsfunktionen: aus Events wird Zustand. Genutzt von den Kontextmodellen der
// Commands und vom Bestand (Projektion für Queries).
import { checklistenpunkte } from '../basis/markdown';
import type { DomainEvent } from '../schema/events';
import { KATEGORIEN, type Datum, type Id, type KategorieId, type Minuten, type Uhrzeit } from '../schema/werte';

export type AufgabeZ = {
  id: Id; titel: string; beschreibung: string; ort: string; verantwortlich: string; tags: string[];
  frist: Datum | null; wiedervorlage: Datum | null; status: Id | null;
  abgeschlossen: boolean; verworfen: boolean; archiviert: boolean;
  /** Bildanhänge der Notiz, in Reihenfolge des Hinzufügens */
  anhaenge: AnhangZ[];
  /** Rang für die manuelle Reihenfolge (kleiner = weiter oben); neue Aufgaben kommen nach oben */
  rang: number;
  /** Zeitpunkt (ISO) des Abschließens – fürs Logbuch */
  abgeschlossenAm: string | null;
  /** explizit abgehakte Checklisten-Punkte der Notiz mit Zeitpunkt – fürs Logbuch */
  abgehakt: { text: string; zeit: string }[];
};

/** Notiz im Logbuch: nur Text (erste Zeile = Titel), Tags, Bilder und ein Tag */
export type NotizZ = {
  id: Id; text: string; tags: string[]; datum: Datum; anhaenge: AnhangZ[];
  /** Zeitpunkt (ISO) des Erfassens */
  erfasst: string;
  verworfen: boolean;
  /** Aufgabe, zu der die Notiz geworden ist */
  umgewandelt: Id | null;
};

/** Event mit Zeitpunkt (gespeicherte Events haben ihn; reine Domain-Events in Tests nicht) */
export type ZeitEvent = DomainEvent & { zeit?: string };

export type AnhangZ = { id: Id; name: string; typ: string; groesse: number };

export type BuchungZ = {
  id: Id; aufgabeId: Id | null; titel: string; beschreibung: string;
  datum: Datum; dauer: Minuten; start: Uhrzeit | null; belegt: boolean; storniert: boolean;
};

export type SpalteZ = { id: Id; name: string; kategorie: KategorieId; rang: number; entfernt: boolean };

export type PlanungZ = { kapazitaet: Minuten[]; standarddauer: Minuten };
export const PLANUNG_STANDARD: PlanungZ = { kapazitaet: [360, 360, 360, 360, 300, 0, 0], standarddauer: 60 };

const NEU = { abgeschlossen: false, verworfen: false, archiviert: false, rang: 0, abgeschlossenAm: null, abgehakt: [] } as const;

export function aufgabeEntwickeln(z: AufgabeZ | null, e: ZeitEvent): AufgabeZ | null {
  switch (e.typ) {
    case 'AufgabeErfasst': return { ...e.daten, ...NEU, id: e.daten.aufgabeId, tags: [...e.daten.tags], anhaenge: [], abgehakt: [] };
    case 'AufgabeAusBuchungErstellt': return {
      ...NEU, id: e.daten.aufgabeId, titel: e.daten.titel, beschreibung: e.daten.beschreibung, ort: '', verantwortlich: '', tags: [],
      frist: null, wiedervorlage: null, status: e.daten.status, anhaenge: [], abgehakt: [],
    };
    case 'AufgabeAusNotizErstellt': return {
      ...NEU, id: e.daten.aufgabeId, titel: e.daten.titel, beschreibung: e.daten.beschreibung, ort: '', verantwortlich: '', tags: [...e.daten.tags],
      frist: null, wiedervorlage: null, status: null, anhaenge: e.daten.anhaenge.map(a => ({ ...a })), abgehakt: [],
    };
  }
  if (!z) return z;
  switch (e.typ) {
    case 'AufgabeUmbenannt': return { ...z, titel: e.daten.titel };
    case 'BeschreibungGeaendert': return { ...z, beschreibung: e.daten.beschreibung, abgehakt: abgehaktFortschreiben(z, e.daten.beschreibung, e.zeit) };
    case 'OrtGeaendert': return { ...z, ort: e.daten.ort };
    case 'VerantwortlicherGeaendert': return { ...z, verantwortlich: e.daten.verantwortlich };
    case 'AufgabeGetaggt': return z.tags.includes(e.daten.tag) ? z : { ...z, tags: [...z.tags, e.daten.tag] };
    case 'TagEntfernt': return { ...z, tags: z.tags.filter(t => t !== e.daten.tag) };
    case 'FristGesetzt': return { ...z, frist: e.daten.frist };
    case 'FristEntfernt': return { ...z, frist: null };
    case 'WiedervorlageGesetzt': return { ...z, wiedervorlage: e.daten.datum };
    case 'WiedervorlageAufgehoben': return { ...z, wiedervorlage: null };
    case 'StatusGesetzt': return { ...z, status: e.daten.status };
    case 'StatusEntfernt': return { ...z, status: null };
    case 'AufgabeAbgeschlossen': return { ...z, abgeschlossen: true, abgeschlossenAm: e.zeit ?? null };
    case 'AufgabeWiedereroeffnet': return { ...z, abgeschlossen: false, abgeschlossenAm: null };
    case 'AufgabeVerworfen': return { ...z, verworfen: true };
    case 'AufgabeArchiviert': return { ...z, archiviert: true };
    case 'AufgabeAusArchivGeholt': return { ...z, archiviert: false };
    case 'AnhangHinzugefuegt': return { ...z, anhaenge: [...z.anhaenge, { id: e.daten.anhangId, name: e.daten.name, typ: e.daten.typ, groesse: e.daten.groesse }] };
    case 'AufgabeEinsortiert': return { ...z, rang: e.daten.rang };
    case 'AnhangEntfernt': return { ...z, anhaenge: z.anhaenge.filter(x => x.id !== e.daten.anhangId) };
    default: return z;
  }
}

/** Neu abgehakte Punkte bekommen den Zeitpunkt des Events; wieder geöffnete oder entfernte fallen heraus */
function abgehaktFortschreiben(z: AufgabeZ, neu: string, zeit: string | undefined): { text: string; zeit: string }[] {
  const vorher = new Set(checklistenpunkte(z.beschreibung).filter(p => p.erledigt).map(p => p.text));
  const jetzt = checklistenpunkte(neu).filter(p => p.erledigt).map(p => p.text);
  const bleiben = z.abgehakt.filter(a => jetzt.includes(a.text));
  const dazu = zeit ? jetzt.filter(t => !vorher.has(t) && !bleiben.some(a => a.text === t)).map(text => ({ text, zeit })) : [];
  return [...bleiben, ...dazu];
}

export function notizEntwickeln(z: NotizZ | null, e: ZeitEvent): NotizZ | null {
  if (e.typ === 'NotizErfasst') return { id: e.daten.notizId, text: e.daten.text, tags: [...e.daten.tags], datum: e.daten.datum, anhaenge: [], erfasst: e.zeit ?? '', verworfen: false, umgewandelt: null };
  if (!z) return z;
  switch (e.typ) {
    case 'NotizTextGeaendert': return { ...z, text: e.daten.text };
    case 'NotizGetaggt': return z.tags.includes(e.daten.tag) ? z : { ...z, tags: [...z.tags, e.daten.tag] };
    case 'NotizTagEntfernt': return { ...z, tags: z.tags.filter(t => t !== e.daten.tag) };
    case 'NotizDatumGeaendert': return { ...z, datum: e.daten.datum };
    case 'NotizAnhangHinzugefuegt': return { ...z, anhaenge: [...z.anhaenge, { id: e.daten.anhangId, name: e.daten.name, typ: e.daten.typ, groesse: e.daten.groesse }] };
    case 'NotizAnhangEntfernt': return { ...z, anhaenge: z.anhaenge.filter(a => a.id !== e.daten.anhangId) };
    case 'NotizVerworfen': return { ...z, verworfen: true };
    case 'AufgabeAusNotizErstellt': return { ...z, umgewandelt: e.daten.aufgabeId };
    default: return z;
  }
}

export function buchungEntwickeln(z: BuchungZ | null, e: DomainEvent): BuchungZ | null {
  if (e.typ === 'BuchungAngelegt') return { ...e.daten, id: e.daten.buchungId, storniert: false };
  if (!z) return z;
  switch (e.typ) {
    case 'BuchungUmbenannt': return { ...z, titel: e.daten.titel };
    case 'BuchungsbeschreibungGeaendert': return { ...z, beschreibung: e.daten.beschreibung };
    case 'BuchungsbelegungGeaendert': return { ...z, belegt: e.daten.belegt };
    case 'BuchungVerschoben': return { ...z, datum: e.daten.datum, start: e.daten.start };
    case 'BuchungsdauerGeaendert': return { ...z, dauer: e.daten.dauer };
    case 'BuchungStorniert': return { ...z, storniert: true };
    case 'AufgabeAusBuchungErstellt': return { ...z, aufgabeId: e.daten.aufgabeId };
    default: return z;
  }
}

export function spaltenEntwickeln(m: Map<Id, SpalteZ>, e: DomainEvent): Map<Id, SpalteZ> {
  switch (e.typ) {
    case 'StatusspalteAngelegt': {
      const rang = Math.max(-1, ...[...m.values()].filter(s => s.kategorie === e.daten.kategorie).map(s => s.rang)) + 1;
      m.set(e.daten.statusId, { id: e.daten.statusId, name: e.daten.name, kategorie: e.daten.kategorie, rang, entfernt: false });
      break;
    }
    case 'StatusspalteUmbenannt': { const s = m.get(e.daten.statusId); if (s) m.set(s.id, { ...s, name: e.daten.name }); break; }
    case 'StatusspaltenSortiert': e.daten.reihenfolge.forEach((id, i) => { const s = m.get(id); if (s) m.set(id, { ...s, rang: i }); }); break;
    case 'StatusspalteEntfernt': { const s = m.get(e.daten.statusId); if (s) m.set(s.id, { ...s, entfernt: true }); break; }
  }
  return m;
}

export function planungEntwickeln(p: PlanungZ, e: DomainEvent): PlanungZ {
  if (e.typ === 'TageskapazitaetFestgelegt') {
    const k = [...p.kapazitaet]; k[e.daten.wochentag - 1] = e.daten.minuten;
    return { ...p, kapazitaet: k };
  }
  if (e.typ === 'StandarddauerFestgelegt') return { ...p, standarddauer: e.daten.minuten };
  return p;
}

/** Anzeigenamen der drei festen Kategorien; Standard aus dem Schema, umbenennbar */
export type KategorienamenZ = Record<KategorieId, string>;
export function kategorienStandard(): KategorienamenZ {
  return Object.fromEntries(KATEGORIEN.map(k => [k.id, k.name])) as KategorienamenZ;
}
export function kategorienEntwickeln(n: KategorienamenZ, e: DomainEvent): KategorienamenZ {
  return e.typ === 'KategorieUmbenannt' ? { ...n, [e.daten.kategorie]: e.daten.name } : n;
}

/** Aktive Spalten, sortiert nach Kategorie und Rang */
export function aktiveSpalten(m: Map<Id, SpalteZ>): SpalteZ[] {
  const reihe: KategorieId[] = ['nichtBegonnen', 'begonnen', 'beendet'];
  return [...m.values()].filter(s => !s.entfernt).sort((a, b) => reihe.indexOf(a.kategorie) - reihe.indexOf(b.kategorie) || a.rang - b.rang);
}
