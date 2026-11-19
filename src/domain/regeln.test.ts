// Ergänzende Domain-Tests: alle Ablehnungsfälle der Commands und alle Event-Arten der Projektion.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Aenderung, EventStore } from '../providers/eventstore/interface';
import { SpeicherEventStore } from '../providers/eventstore/speicher';
import type { EventTyp } from '../schema/events';
import { aufbauen } from './bestand';
import { entscheide } from './commands/basis';
import { Domain } from './domain';

let es: SpeicherEventStore;
let d: Domain;
let n = 0;
beforeEach(() => {
  es = new SpeicherEventStore('test', () => `e${++n}`, () => new Date('2026-11-16T10:00:00Z'));
  d = new Domain(es);
  d.standardspaltenEinrichten();
});
const neu = (): EventTyp[] => es.lesen().events.map(e => e.typ).filter(t => t !== 'StatusspalteAngelegt');
const nein = { ok: false };
const ja = { ok: true };
const erfasse = (id = 'a1') => d.aufgabeErfassen({ aufgabeId: id, felder: { titel: 'T' } });

describe('Aufgaben: Ablehnungen', () => {
  it('ungültige Frist/Wiedervorlage, doppelte ID, ungültige Buchung', () => {
    expect(d.aufgabeErfassen({ aufgabeId: 'x', felder: { titel: 'T', frist: '2026-13-01' } })).toMatchObject(nein);
    expect(d.aufgabeErfassen({ aufgabeId: 'x', felder: { titel: 'T', wiedervorlage: 'morgen' } })).toMatchObject(nein);
    erfasse();
    expect(erfasse()).toMatchObject({ ok: false, fehler: ['Aufgabe existiert bereits.'] });
    expect(d.aufgabeErfassen({ aufgabeId: 'y', felder: { titel: 'T' }, buchung: { buchungId: 'b', datum: 'x' } })).toMatchObject(nein);
  });

  it('ändern: unbekannt, verworfen, ungültige Werte', () => {
    expect(d.aufgabeAendern({ aufgabeId: 'fehlt', aenderungen: { titel: 'X' } })).toMatchObject({ fehler: ['Aufgabe unbekannt.'] });
    erfasse();
    expect(d.aufgabeAendern({ aufgabeId: 'a1', aenderungen: { titel: ' ' } })).toMatchObject(nein);
    d.aufgabeVerwerfen({ aufgabeId: 'a1' });
    expect(d.aufgabeAendern({ aufgabeId: 'a1', aenderungen: { titel: 'X' } })).toMatchObject({ fehler: ['Aufgabe wurde verworfen.'] });
  });

  it('ändern: jedes Feld erzeugt sein Event – auch Entfernen von Frist und Wiedervorlage', () => {
    d.aufgabeErfassen({ aufgabeId: 'a1', felder: { titel: 'T', frist: '2026-11-20', wiedervorlage: '2026-11-18' } });
    d.aufgabeAendern({ aufgabeId: 'a1', aenderungen: { beschreibung: 'B', ort: ' Hamburg ', verantwortlich: ' Ralf ', frist: null, wiedervorlage: null } });
    d.aufgabeAendern({ aufgabeId: 'a1', aenderungen: { wiedervorlage: '2026-12-01' } });
    expect(neu()).toEqual(['AufgabeErfasst', 'BeschreibungGeaendert', 'OrtGeaendert', 'VerantwortlicherGeaendert', 'FristEntfernt', 'WiedervorlageAufgehoben', 'WiedervorlageGesetzt']);
    expect(d.aufgabe('a1')).toMatchObject({ beschreibung: 'B', ort: 'Hamburg', verantwortlich: 'Ralf', frist: null, wiedervorlage: '2026-12-01' });
  });

  it('Status: unbekannte Aufgabe/Spalte, gleicher Status ohne Event', () => {
    expect(d.statusSetzen({ aufgabeId: 'fehlt', status: 'idee' })).toMatchObject(nein);
    erfasse();
    expect(d.statusSetzen({ aufgabeId: 'a1', status: 'gibtsnicht' })).toMatchObject(nein);
    d.statusSetzen({ aufgabeId: 'a1', status: 'idee' });
    d.statusSetzen({ aufgabeId: 'a1', status: 'idee' });
    d.statusSetzen({ aufgabeId: 'a1', status: null });
    expect(neu()).toEqual(['AufgabeErfasst', 'StatusGesetzt', 'StatusEntfernt']);
  });

  it('Abschließen/Wiederöffnen/Verwerfen: unbekannt, verworfen, ohne Wirkung', () => {
    for (const f of [d.aufgabeAbschliessen, d.aufgabeWiedereroeffnen, d.aufgabeVerwerfen]) expect(f({ aufgabeId: 'fehlt' })).toMatchObject(nein);
    erfasse();
    expect(d.aufgabeWiedereroeffnen({ aufgabeId: 'a1' })).toMatchObject(ja); // war offen → nichts
    d.aufgabeVerwerfen({ aufgabeId: 'a1' });
    expect(d.aufgabeVerwerfen({ aufgabeId: 'a1' })).toMatchObject(ja);
    expect(d.aufgabeAbschliessen({ aufgabeId: 'a1' })).toMatchObject(nein);
    expect(d.aufgabeWiedereroeffnen({ aufgabeId: 'a1' })).toMatchObject(nein);
    expect(d.statusSetzen({ aufgabeId: 'a1', status: 'idee' })).toMatchObject(nein);
    expect(neu()).toEqual(['AufgabeErfasst', 'AufgabeVerworfen']);
  });
});

describe('Archiv', () => {
  it('archivieren und zurückholen; archivierte Aufgaben sind gesperrt', () => {
    for (const f of [d.aufgabeArchivieren, d.aufgabeAusArchivHolen]) expect(f({ aufgabeId: 'fehlt' })).toMatchObject(nein);
    erfasse();
    expect(d.aufgabeAusArchivHolen({ aufgabeId: 'a1' })).toMatchObject(ja); // nicht archiviert → nichts
    d.aufgabeArchivieren({ aufgabeId: 'a1' });
    d.aufgabeArchivieren({ aufgabeId: 'a1' });
    expect(d.aufgabe('a1')!.archiviert).toBe(true);
    expect(d.aufgabeAendern({ aufgabeId: 'a1', aenderungen: { titel: 'X' } })).toMatchObject({ fehler: [expect.stringContaining('archiviert')] });
    expect(d.aufgabeAbschliessen({ aufgabeId: 'a1' })).toMatchObject(nein);
    expect(d.aufgabeWiedereroeffnen({ aufgabeId: 'a1' })).toMatchObject(nein);
    expect(d.buchungAnlegen({ buchungId: 'b', aufgabeId: 'a1', datum: '2026-11-17' })).toMatchObject(nein);
    d.aufgabeAusArchivHolen({ aufgabeId: 'a1' });
    expect(neu()).toEqual(['AufgabeErfasst', 'AufgabeArchiviert', 'AufgabeAusArchivGeholt']);
    d.aufgabeVerwerfen({ aufgabeId: 'a1' });
    expect(d.aufgabeArchivieren({ aufgabeId: 'a1' })).toMatchObject(nein);
  });
});

describe('Manuelle Reihenfolge', () => {
  it('neue Aufgaben kommen nach oben; Einsortieren setzt den Rang', () => {
    erfasse('a1'); erfasse('a2');
    d.buchungEintragen({ buchungId: 'b', titel: 'B', datum: '2026-11-17' });
    d.aufgabeAusBuchung({ buchungId: 'b', aufgabeId: 'a3' });
    expect(['a1', 'a2', 'a3'].map(id => d.aufgabe(id)!.rang)).toEqual([-1, -2, -3]);
    expect(d.aufgabeEinsortieren({ aufgabeId: 'a1', rang: -2.5 })).toMatchObject(ja);
    expect(d.aufgabe('a1')!.rang).toBe(-2.5);
    expect(d.aufgabeEinsortieren({ aufgabeId: 'fehlt', rang: 1 })).toMatchObject(nein);
    expect(d.aufgabeEinsortieren({ aufgabeId: 'a1', rang: Infinity })).toMatchObject(nein);
  });
});

describe('Anhänge', () => {
  it('nur Bilder bis 25 MB, nur an offenen Aufgaben; Entfernen wirkt einmal', () => {
    expect(d.anhangHinzufuegen({ aufgabeId: 'fehlt', anhangId: 'x', name: 'a.png', typ: 'image/png', groesse: 10 })).toMatchObject(nein);
    erfasse();
    expect(d.anhangHinzufuegen({ aufgabeId: 'a1', anhangId: 'x', name: 'a.pdf', typ: 'application/pdf', groesse: 10 })).toMatchObject(nein);
    expect(d.anhangHinzufuegen({ aufgabeId: 'a1', anhangId: 'x', name: 'a.png', typ: 'image/png', groesse: 26 * 1024 * 1024 })).toMatchObject(nein);
    expect(d.anhangHinzufuegen({ aufgabeId: 'a1', anhangId: 'x1', name: ' ', typ: 'image/png', groesse: 10 })).toMatchObject(ja);
    d.anhangHinzufuegen({ aufgabeId: 'a1', anhangId: 'x1', name: 'doppelt', typ: 'image/png', groesse: 10 });
    d.anhangHinzufuegen({ aufgabeId: 'a1', anhangId: 'x2', name: 'b.jpg', typ: 'image/jpeg', groesse: 20 });
    expect(d.aufgabe('a1')!.anhaenge.map(a => [a.id, a.name])).toEqual([['x1', 'Bild'], ['x2', 'b.jpg']]);
    d.anhangEntfernen({ aufgabeId: 'a1', anhangId: 'x1' });
    d.anhangEntfernen({ aufgabeId: 'a1', anhangId: 'x1' });
    expect(neu()).toEqual(['AufgabeErfasst', 'AnhangHinzugefuegt', 'AnhangHinzugefuegt', 'AnhangEntfernt']);
    d.aufgabeAbschliessen({ aufgabeId: 'a1' });
    expect(d.anhangEntfernen({ aufgabeId: 'a1', anhangId: 'x2' })).toMatchObject(nein);
  });
});

describe('Buchungen: Ablehnungen und Änderungen', () => {
  it('anlegen: unbekannte/verworfene Aufgabe, doppelte Buchung, eigener Titel', () => {
    expect(d.buchungAnlegen({ buchungId: 'b1', aufgabeId: 'fehlt', datum: '2026-11-17' })).toMatchObject(nein);
    erfasse();
    expect(d.buchungAnlegen({ buchungId: 'b1', aufgabeId: 'a1', datum: '2026-11-17', titel: 'Teil 1' })).toMatchObject(ja);
    expect(d.buchung('b1')!.titel).toBe('Teil 1');
    expect(d.buchungAnlegen({ buchungId: 'b1', aufgabeId: 'a1', datum: '2026-11-17' })).toMatchObject({ fehler: ['Buchung existiert bereits.'] });
    d.aufgabeVerwerfen({ aufgabeId: 'a1' });
    expect(d.buchungAnlegen({ buchungId: 'b2', aufgabeId: 'a1', datum: '2026-11-17' })).toMatchObject(nein);
  });

  it('eintragen: ohne Titel, doppelte ID, ungültiges Datum', () => {
    expect(d.buchungEintragen({ buchungId: 'b1', titel: '', datum: '2026-11-17' })).toMatchObject(nein);
    d.buchungEintragen({ buchungId: 'b1', titel: 'X', datum: '2026-11-17' });
    expect(d.buchungEintragen({ buchungId: 'b1', titel: 'X', datum: '2026-11-17' })).toMatchObject(nein);
    expect(d.buchungEintragen({ buchungId: 'b2', titel: 'X', datum: '17.11.' })).toMatchObject(nein);
  });

  it('ändern: Titel, Beschreibung, Belegung, Dauer; Ablehnung leerer Titel und ungültige Dauer', () => {
    d.buchungEintragen({ buchungId: 'b1', titel: 'X', datum: '2026-11-17' });
    expect(d.buchungAendern({ buchungId: 'b1', aenderungen: { titel: '' } })).toMatchObject(nein);
    expect(d.buchungAendern({ buchungId: 'b1', aenderungen: { dauer: -5 } })).toMatchObject(nein);
    d.buchungAendern({ buchungId: 'b1', aenderungen: { titel: 'Y', beschreibung: 'Z', belegt: false, dauer: 30, start: '09:00' } });
    d.buchungAendern({ buchungId: 'b1', aenderungen: { titel: 'Y' } });
    expect(neu()).toEqual(['BuchungAngelegt', 'BuchungUmbenannt', 'BuchungsbeschreibungGeaendert', 'BuchungsbelegungGeaendert', 'BuchungVerschoben', 'BuchungsdauerGeaendert']);
    expect(d.buchung('b1')).toMatchObject({ titel: 'Y', beschreibung: 'Z', belegt: false, dauer: 30, start: '09:00' });
  });

  it('Buchungen einer Aufgabe tragen auch deren Tag; Stornieren wirkt einmal', () => {
    erfasse();
    d.buchungAnlegen({ buchungId: 'b1', aufgabeId: 'a1', datum: '2026-11-18' });
    d.buchungAnlegen({ buchungId: 'b0', aufgabeId: 'a1', datum: '2026-11-17', start: '09:00' });
    expect(d.buchungenDerAufgabe('a1').map(b => b.id)).toEqual(['b0', 'b1']);
    d.buchungAendern({ buchungId: 'b1', aenderungen: { titel: 'Neu' } });
    expect(es.lesen({ tags: ['aufgabe:a1'] }).events.at(-1)!.typ).toBe('BuchungUmbenannt');
    expect(d.buchungStornieren({ buchungId: 'fehlt' })).toMatchObject(nein);
    d.buchungStornieren({ buchungId: 'b1' });
    d.buchungStornieren({ buchungId: 'b1' });
    expect(neu().filter(t => t === 'BuchungStorniert')).toHaveLength(1);
    expect(es.lesen({ tags: ['aufgabe:a1'] }).events.at(-1)!.typ).toBe('BuchungStorniert');
    expect(d.buchung('b1')).toBeNull();
    expect(d.buchungen('2026-11-17', '2026-11-17').map(b => b.id)).toEqual(['b0']);
  });

  it('Aufgabe aus Buchung: unbekannt, doppelte Aufgaben-ID, unbekannte Spalte', () => {
    expect(d.aufgabeAusBuchung({ buchungId: 'fehlt', aufgabeId: 'n' })).toMatchObject(nein);
    erfasse();
    d.buchungEintragen({ buchungId: 'b1', titel: 'X', datum: '2026-11-17' });
    expect(d.aufgabeAusBuchung({ buchungId: 'b1', aufgabeId: 'a1' })).toMatchObject({ fehler: ['Aufgabe existiert bereits.'] });
    expect(d.aufgabeAusBuchung({ buchungId: 'b1', aufgabeId: 'n', status: 'gibtsnicht' })).toMatchObject(nein);
  });
});

describe('Board und Planung: Ablehnungen', () => {
  it('Spalte anlegen/umbenennen/sortieren/entfernen', () => {
    expect(d.spalteAnlegen({ statusId: 's', name: '', kategorie: 'begonnen' })).toMatchObject(nein);
    expect(d.spalteAnlegen({ statusId: 's', name: 'X', kategorie: 'quatsch' as never })).toMatchObject(nein);
    expect(d.spalteAnlegen({ statusId: 'idee', name: 'X', kategorie: 'begonnen' })).toMatchObject(nein);
    expect(d.spalteUmbenennen({ statusId: 'fehlt', name: 'X' })).toMatchObject(nein);
    expect(d.spalteUmbenennen({ statusId: 'idee', name: ' ' })).toMatchObject(nein);
    expect(d.spalteUmbenennen({ statusId: 'idee', name: 'Idee' })).toMatchObject(ja);
    expect(d.spalteUmbenennen({ statusId: 'idee', name: 'Einfall' })).toMatchObject(ja);
    expect(d.spalten()[0]!.name).toBe('Einfall');
    expect(d.spaltenSortieren({ kategorie: 'beendet', reihenfolge: ['erledigt', 'abgebrochen'] })).toMatchObject(ja);
    expect(d.spalteEntfernen({ statusId: 'fehlt' })).toMatchObject(nein);
    expect(neu()).toEqual(['StatusspalteUmbenannt']);
  });

  it('Spaltengruppen umbenennen: Standardnamen, neuer Name, Ablehnungen, ohne Wirkung', () => {
    expect(d.kategorien().map(k => k.name)).toEqual(['Nicht begonnen', 'Begonnen', 'Beendet']);
    expect(d.kategorieUmbenennen({ kategorie: 'nichtBegonnen', name: ' Vorrat ' })).toMatchObject(ja);
    expect(d.kategorieUmbenennen({ kategorie: 'nichtBegonnen', name: 'Vorrat' })).toMatchObject(ja);
    expect(d.kategorieUmbenennen({ kategorie: 'quatsch' as never, name: 'X' })).toMatchObject(nein);
    expect(d.kategorieUmbenennen({ kategorie: 'begonnen', name: '  ' })).toMatchObject(nein);
    expect(d.kategorien()).toEqual([{ id: 'nichtBegonnen', name: 'Vorrat' }, { id: 'begonnen', name: 'Begonnen' }, { id: 'beendet', name: 'Beendet' }]);
    expect(neu()).toEqual(['KategorieUmbenannt']);
  });

  it('Kapazität und Standarddauer: Grenzen und ohne Wirkung', () => {
    expect(d.tageskapazitaetFestlegen({ wochentag: 1, minuten: 25 * 60 })).toMatchObject(nein);
    expect(d.tageskapazitaetFestlegen({ wochentag: 1, minuten: 360 })).toMatchObject(ja);
    expect(d.standarddauerFestlegen({ minuten: 1 })).toMatchObject(nein);
    expect(d.standarddauerFestlegen({ minuten: 60 })).toMatchObject(ja);
    expect(neu()).toEqual([]);
  });
});

describe('Projektion und Ablauf', () => {
  it('ignoriert Events zu Unbekanntem und unbekannte Spalten', () => {
    const b = aufbauen([
      { typ: 'AufgabeUmbenannt', daten: { aufgabeId: 'x', titel: 'T' } },
      { typ: 'BuchungStorniert', daten: { buchungId: 'y' } },
      { typ: 'StatusspalteUmbenannt', daten: { statusId: 'z', name: 'N' } },
      { typ: 'StatusspaltenSortiert', daten: { kategorie: 'begonnen', reihenfolge: ['z'] } },
      { typ: 'StatusspalteEntfernt', daten: { statusId: 'z' } },
    ]);
    expect([b.aufgaben.size, b.buchungen.size, b.spalten.size]).toEqual([0, 0, 0]);
  });

  it('Tag doppelt taggen ändert nichts', () => {
    const b = aufbauen([
      { typ: 'AufgabeErfasst', daten: { aufgabeId: 'a', titel: 'T', beschreibung: '', ort: '', verantwortlich: '', tags: ['x'], frist: null, wiedervorlage: null, status: null } },
      { typ: 'AufgabeGetaggt', daten: { aufgabeId: 'a', tag: 'x' } },
    ]);
    expect(b.aufgaben.get('a')!.tags).toEqual(['x']);
  });

  it('nach dreimaligem Konflikt gibt der Command auf', () => {
    const immerKonflikt: EventStore = { lesen: () => ({ events: [], position: 0 }), anhaengen: () => ({ ok: false, konflikt: true }), abonnieren: () => () => {} };
    expect(entscheide(immerKonflikt, {}, () => 0, m => m, () => [{ typ: 'FristEntfernt', tags: [], daten: { aufgabeId: 'a' } }])).toMatchObject(nein);
  });

  it('baut die Projektion neu auf, wenn fremde Events eintreffen, und meldet Änderungen', () => {
    let melden: ((a: Aenderung) => void) | null = null;
    const events = es.lesen().events;
    const fremd: EventStore = { lesen: () => ({ events, position: events.length }), anhaengen: () => ({ ok: true, events: [] }), abonnieren: cb => { melden = cb; return () => {} } };
    const d2 = new Domain(fremd);
    let gemeldet = 0;
    const ab = d2.beiAenderung(() => gemeldet++);
    events.push({ ...events[0]!, typ: 'StatusspalteAngelegt', daten: { statusId: 'neu', name: 'Neu', kategorie: 'begonnen' }, id: 'f1', position: 99 } as never);
    melden!({ events: [], fremd: true });
    expect(d2.spalten().some(s => s.id === 'neu')).toBe(true);
    ab();
    melden!({ events: [], fremd: true });
    expect(gemeldet).toBe(1);
  });

  it('verworfene Aufgabe und stornierte Buchung sind per ID nicht abrufbar', () => {
    expect(d.aufgabe('fehlt')).toBeNull();
    expect(d.buchung('fehlt')).toBeNull();
  });
});

describe('Neu und gesehen', () => {
  it('AufgabeErfasst ohne neu-Feld (ältere Events) gilt als gesehen; mit neu: true bis AufgabeGesehen', () => {
    d.aufgabeErfassen({ aufgabeId: 'alt', felder: { titel: 'Alt' } });
    d.aufgabeErfassen({ aufgabeId: 'neu', felder: { titel: 'Neu', neu: true } });
    expect([d.aufgabe('alt')!.neu, d.aufgabe('neu')!.neu]).toEqual([false, true]);
    expect(d.aufgabeGesehen({ aufgabeId: 'neu' })).toEqual({ ok: true });
    expect(d.aufgabe('neu')!.neu).toBe(false);
    expect(neu().filter(t => t === 'AufgabeGesehen')).toHaveLength(1);
    expect(d.aufgabeGesehen({ aufgabeId: 'neu' })).toEqual({ ok: true });
    expect(neu().filter(t => t === 'AufgabeGesehen')).toHaveLength(1);
    expect(d.aufgabeGesehen({ aufgabeId: 'fehlt' })).toMatchObject({ ok: false });
  });
});
