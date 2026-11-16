// Domain-Tests im Stil Given (Events) · When (Command) · Then (Events/Fehler).
import { beforeEach, describe, expect, it } from 'vitest';
import { SpeicherEventStore } from '../providers/eventstore/speicher';
import type { EventTyp } from '../schema/events';
import { Domain } from './domain';

let es: SpeicherEventStore;
let d: Domain;
let n = 0;
beforeEach(() => {
  es = new SpeicherEventStore('test', () => `e${++n}`, () => new Date('2026-11-16T10:00:00Z'));
  d = new Domain(es);
  d.standardspaltenEinrichten();
});
const typen = (): EventTyp[] => es.lesen().events.map(e => e.typ).filter(t => t !== 'StatusspalteAngelegt');
const erfasse = (id = 'a1', titel = 'Angebot schreiben') => d.aufgabeErfassen({ aufgabeId: id, felder: { titel } });

describe('Aufgaben', () => {
  it('erfasst eine Aufgabe mit Titel', () => {
    expect(erfasse()).toEqual({ ok: true });
    expect(d.aufgabe('a1')).toMatchObject({ titel: 'Angebot schreiben', abgeschlossen: false, status: null });
  });

  it('lehnt leeren Titel und unbekannte Spalte ab', () => {
    expect(d.aufgabeErfassen({ aufgabeId: 'x', felder: { titel: '  ' } })).toMatchObject({ ok: false });
    expect(d.aufgabeErfassen({ aufgabeId: 'x', felder: { titel: 'T', status: 'gibtsnicht' } })).toMatchObject({ ok: false });
    expect(typen()).toEqual([]);
  });

  it('erfasst Aufgabe samt Buchung mit Standarddauer und Aufgabentitel', () => {
    d.standarddauerFestlegen({ minuten: 45 });
    d.aufgabeErfassen({ aufgabeId: 'a1', felder: { titel: 'Folien' }, buchung: { buchungId: 'b1', datum: '2026-11-18' } });
    expect(d.buchung('b1')).toMatchObject({ aufgabeId: 'a1', titel: 'Folien', dauer: 45, start: null, belegt: true });
  });

  it('erzeugt beim Ändern nur Events für tatsächliche Änderungen', () => {
    d.aufgabeErfassen({ aufgabeId: 'a1', felder: { titel: 'T', tags: ['kunde', 'alt'] } });
    d.aufgabeAendern({ aufgabeId: 'a1', aenderungen: { titel: 'T', tags: ['#Kunde', 'neu'], frist: '2026-11-20', ort: '' } });
    expect(typen()).toEqual(['AufgabeErfasst', 'AufgabeGetaggt', 'TagEntfernt', 'FristGesetzt']);
    expect(d.aufgabe('a1')!.tags).toEqual(['kunde', 'neu']);
  });

  it('Status setzen und entfernen; Abschließen ist ein eigener Zustand', () => {
    erfasse();
    d.statusSetzen({ aufgabeId: 'a1', status: 'erledigt' });
    expect(d.aufgabe('a1')).toMatchObject({ status: 'erledigt', abgeschlossen: false });
    d.aufgabeAbschliessen({ aufgabeId: 'a1' });
    expect(d.aufgabe('a1')).toMatchObject({ status: 'erledigt', abgeschlossen: true });
  });

  it('abgeschlossene Aufgaben lassen sich nicht ändern, aber wieder öffnen', () => {
    erfasse();
    d.aufgabeAbschliessen({ aufgabeId: 'a1' });
    expect(d.aufgabeAendern({ aufgabeId: 'a1', aenderungen: { titel: 'Neu' } })).toMatchObject({ ok: false });
    expect(d.buchungAnlegen({ buchungId: 'b1', aufgabeId: 'a1', datum: '2026-11-17' })).toMatchObject({ ok: false });
    d.aufgabeWiedereroeffnen({ aufgabeId: 'a1' });
    expect(d.aufgabeAendern({ aufgabeId: 'a1', aenderungen: { titel: 'Neu' } })).toEqual({ ok: true });
  });

  it('Abschließen ist idempotent', () => {
    erfasse();
    d.aufgabeAbschliessen({ aufgabeId: 'a1' });
    d.aufgabeAbschliessen({ aufgabeId: 'a1' });
    expect(typen()).toEqual(['AufgabeErfasst', 'AufgabeAbgeschlossen']);
  });

  it('verworfene Aufgaben verschwinden aus den Queries', () => {
    erfasse();
    d.aufgabeVerwerfen({ aufgabeId: 'a1' });
    expect(d.aufgaben()).toEqual([]);
    expect(d.aufgabe('a1')).toBeNull();
  });
});

describe('Buchungen', () => {
  it('freie Buchung: ohne Aufgabe, mit eigenem Titel und Beschreibung', () => {
    expect(d.buchungEintragen({ buchungId: 'b1', titel: 'Zahnarzt', beschreibung: 'Kontrolle', datum: '2026-11-18', start: '08:30', dauer: 45, belegt: false })).toEqual({ ok: true });
    expect(d.buchung('b1')).toMatchObject({ aufgabeId: null, titel: 'Zahnarzt', beschreibung: 'Kontrolle', start: '08:30', belegt: false });
    expect(d.aufgaben()).toEqual([]);
  });

  it('aus einer freien Buchung wird eine Aufgabe; die Buchung gehört dann dazu', () => {
    d.buchungEintragen({ buchungId: 'b1', titel: 'Belege sortieren', beschreibung: 'Q4', datum: '2026-11-18' });
    expect(d.aufgabeAusBuchung({ buchungId: 'b1', aufgabeId: 'a9', status: 'backlog' })).toEqual({ ok: true });
    expect(d.aufgabe('a9')).toMatchObject({ titel: 'Belege sortieren', beschreibung: 'Q4', status: 'backlog' });
    expect(d.buchung('b1')!.aufgabeId).toBe('a9');
    expect(d.aufgabeAusBuchung({ buchungId: 'b1', aufgabeId: 'a10' })).toMatchObject({ ok: false });
  });

  it('verschieben macht aus einem Termin eine Reservierung (start = null)', () => {
    erfasse();
    d.buchungAnlegen({ buchungId: 'b1', aufgabeId: 'a1', datum: '2026-11-17', start: '14:00', dauer: 60 });
    d.buchungAendern({ buchungId: 'b1', aenderungen: { datum: '2026-11-19', start: null } });
    expect(d.buchung('b1')).toMatchObject({ datum: '2026-11-19', start: null, titel: 'Angebot schreiben' });
  });

  it('prüft Datum, Uhrzeit und Dauer', () => {
    erfasse();
    expect(d.buchungAnlegen({ buchungId: 'b1', aufgabeId: 'a1', datum: '2026-02-30' })).toMatchObject({ ok: false });
    expect(d.buchungAnlegen({ buchungId: 'b1', aufgabeId: 'a1', datum: '2026-11-17', start: '25:00' })).toMatchObject({ ok: false });
    expect(d.buchungAnlegen({ buchungId: 'b1', aufgabeId: 'a1', datum: '2026-11-17', dauer: 0 })).toMatchObject({ ok: false });
  });

  it('stornierte Buchungen tauchen nicht mehr auf', () => {
    d.buchungEintragen({ buchungId: 'b1', titel: 'X', datum: '2026-11-18' });
    d.buchungStornieren({ buchungId: 'b1' });
    expect(d.buchungen()).toEqual([]);
    expect(d.buchungAendern({ buchungId: 'b1', aenderungen: { titel: 'Y' } })).toMatchObject({ ok: false });
  });
});

describe('Board-Spalten und Planung', () => {
  it('Standardspalten werden nur einmal angelegt', () => {
    d.standardspaltenEinrichten();
    expect(d.spalten().map(s => s.name)).toEqual(['Idee', 'Backlog', 'Bereit', 'In Arbeit', 'Blockiert', 'Erledigt', 'Abgebrochen']);
  });

  it('Spalten sortieren nur innerhalb ihrer Kategorie', () => {
    expect(d.spaltenSortieren({ kategorie: 'begonnen', reihenfolge: ['blockiert', 'inarbeit'] })).toEqual({ ok: true });
    expect(d.spalten().filter(s => s.kategorie === 'begonnen').map(s => s.id)).toEqual(['blockiert', 'inarbeit']);
    expect(d.spaltenSortieren({ kategorie: 'begonnen', reihenfolge: ['blockiert', 'idee'] })).toMatchObject({ ok: false });
  });

  it('eine Spalte mit Aufgaben lässt sich nicht entfernen', () => {
    d.aufgabeErfassen({ aufgabeId: 'a1', felder: { titel: 'T', status: 'idee' } });
    expect(d.spalteEntfernen({ statusId: 'idee' })).toMatchObject({ ok: false });
    d.statusSetzen({ aufgabeId: 'a1', status: null });
    expect(d.spalteEntfernen({ statusId: 'idee' })).toEqual({ ok: true });
    expect(d.spalten().some(s => s.id === 'idee')).toBe(false);
  });

  it('neue Spalte landet am Ende ihrer Kategorie', () => {
    d.spalteAnlegen({ statusId: 'review', name: 'Review', kategorie: 'begonnen' });
    expect(d.spalten().filter(s => s.kategorie === 'begonnen').map(s => s.id)).toEqual(['inarbeit', 'blockiert', 'review']);
  });

  it('Tageskapazität je Wochentag', () => {
    d.tageskapazitaetFestlegen({ wochentag: 6, minuten: 120 });
    expect(d.planung().kapazitaet[5]).toBe(120);
    expect(d.tageskapazitaetFestlegen({ wochentag: 8 as never, minuten: 60 })).toMatchObject({ ok: false });
  });
});

describe('Konsistenz', () => {
  it('ein konkurrierendes Event zwischen Lesen und Anhängen führt zur Wiederholung', () => {
    erfasse();
    // Bei der ersten Entscheidung schiebt „ein anderes Gerät“ den Abschluss dazwischen
    const orig = es.anhaengen.bind(es);
    let erst = true;
    es.anhaengen = (events, bedingung) => {
      if (erst && bedingung) { erst = false; orig([{ typ: 'AufgabeAbgeschlossen', tags: ['aufgabe:a1'], daten: { aufgabeId: 'a1' } }]); }
      return orig(events, bedingung);
    };
    expect(d.aufgabeAendern({ aufgabeId: 'a1', aenderungen: { titel: 'Neu' } })).toMatchObject({ ok: false, fehler: [expect.stringContaining('abgeschlossen')] });
  });
});
