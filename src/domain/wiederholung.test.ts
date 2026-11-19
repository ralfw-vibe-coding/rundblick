// Wiederkehrende Aufgaben: Terminrechnung (ab Frist) und Commands.
import { beforeEach, describe, expect, it } from 'vitest';
import { SpeicherEventStore } from '../providers/eventstore/speicher';
import { Domain } from './domain';
import { istWiederholung, naechsterTermin, termin } from './wiederholung';

describe('Terminrechnung', () => {
  it('Tage, Wochen, Monate, Jahre', () => {
    expect(termin('2026-11-20', { einheit: 'tag', alle: 17 }, 1)).toBe('2026-12-07');
    expect(termin('2026-11-20', { einheit: 'woche', alle: 2 }, 1)).toBe('2026-12-04');
    expect(termin('2026-11-12', { einheit: 'monat', alle: 1 }, 2)).toBe('2027-01-12');
    expect(termin('2026-03-17', { einheit: 'jahr', alle: 1 }, 1)).toBe('2027-03-17');
  });
  it('Monatsende: 31. → letzter Tag, ohne abzudriften', () => {
    const w = { einheit: 'monat', alle: 1 } as const;
    expect(termin('2027-01-31', w, 1)).toBe('2027-02-28');
    expect(termin('2027-01-31', w, 2)).toBe('2027-03-31');
    expect(termin('2028-02-29', { einheit: 'jahr', alle: 1 }, 1)).toBe('2029-02-28');
  });
  it('nächster Termin nach einem Datum – verpasste laufen nicht auf', () => {
    const w = { einheit: 'monat', alle: 1 } as const;
    expect(naechsterTermin('2026-11-12', w, '2026-11-12')).toBe('2026-12-12');
    expect(naechsterTermin('2026-11-12', w, '2027-03-20')).toBe('2027-04-12');
    expect(naechsterTermin('2016-01-31', { einheit: 'monat', alle: 1 }, '2026-11-30')).toBe('2026-12-31');
    expect(naechsterTermin('2000-01-01', { einheit: 'tag', alle: 3 }, '2026-11-19')).toBe('2026-11-22'); // 19.11. ist selbst ein Termin
    expect(naechsterTermin('1990-03-17', { einheit: 'jahr', alle: 1 }, '2026-11-19')).toBe('2027-03-17');
  });
  it('prüft Regeln', () => {
    expect(istWiederholung({ einheit: 'monat', alle: 6 })).toBe(true);
    expect(istWiederholung({ einheit: 'stunde', alle: 1 })).toBe(false);
    expect(istWiederholung({ einheit: 'tag', alle: 0 })).toBe(false);
    expect(istWiederholung({ einheit: 'tag', alle: 1.5 })).toBe(false);
    expect(istWiederholung(null)).toBe(false);
  });
});

describe('Commands', () => {
  let es: SpeicherEventStore, d: Domain;
  beforeEach(() => { es = new SpeicherEventStore('t', (() => { let i = 0; return () => `e${++i}`; })(), () => new Date('2026-11-19T10:00:00Z')); d = new Domain(es); d.standardspaltenEinrichten(); });
  const typen = () => es.lesen().events.map(e => e.typ).filter(t => t !== 'StatusspalteAngelegt');
  const monatlich = { einheit: 'monat', alle: 1 } as const;

  it('erfassen mit Wiederholung braucht eine Frist; Events tragen Schema 2', () => {
    expect(d.aufgabeErfassen({ aufgabeId: 'x', felder: { titel: 'T', wiederholung: monatlich } })).toMatchObject({ ok: false, fehler: ['Wiederholung braucht eine Frist.'] });
    expect(d.aufgabeErfassen({ aufgabeId: 'x', felder: { titel: 'T', frist: '2026-11-12', wiederholung: { einheit: 'jahr', alle: 0 } } })).toMatchObject({ ok: false });
    expect(d.aufgabeErfassen({ aufgabeId: 'a', felder: { titel: 'Backup', frist: '2026-11-12', wiederholung: monatlich } })).toMatchObject({ ok: true });
    expect(d.aufgabe('a')!.wiederholung).toEqual({ ...monatlich, anker: '2026-11-12' });
    const ev = es.lesen().events.filter(e => e.typ !== 'StatusspalteAngelegt');
    expect(ev.map(e => [e.typ, e.meta.schema])).toEqual([['AufgabeErfasst', 1], ['WiederholungGesetzt', 2]]);
  });

  it('abhaken: springt auf den nächsten Termin nach heute, bleibt offen; ohne heute = normal abschließen', () => {
    d.aufgabeErfassen({ aufgabeId: 'a', felder: { titel: 'Backup', frist: '2026-09-12', wiederholung: monatlich } });
    d.aufgabeAbschliessen({ aufgabeId: 'a', heute: '2026-11-19' });
    expect(d.aufgabe('a')).toMatchObject({ frist: '2026-12-12', abgeschlossen: false, erledigt: ['2026-11-19T10:00:00.000Z'] });
    // vor der Frist erledigt → der Termin danach
    d.aufgabeAbschliessen({ aufgabeId: 'a', heute: '2026-11-20' });
    expect(d.aufgabe('a')!.frist).toBe('2027-01-12');
    d.aufgabeAbschliessen({ aufgabeId: 'a' });
    expect(d.aufgabe('a')!.abgeschlossen).toBe(true);
  });

  it('Wiedervorlage fällt beim Weiterspringen weg', () => {
    d.aufgabeErfassen({ aufgabeId: 'a', felder: { titel: 'T', frist: '2026-11-19', wiedervorlage: '2026-11-18', wiederholung: { einheit: 'tag', alle: 17 } } });
    d.aufgabeAbschliessen({ aufgabeId: 'a', heute: '2026-11-19' });
    expect(d.aufgabe('a')).toMatchObject({ frist: '2026-12-06', wiedervorlage: null });
  });

  it('ändern: setzen, umstellen, Frist verschiebt den Anker, Frist weg = Wiederholung weg, aufheben', () => {
    d.aufgabeErfassen({ aufgabeId: 'a', felder: { titel: 'T' } });
    expect(d.aufgabeAendern({ aufgabeId: 'a', aenderungen: { wiederholung: monatlich } })).toMatchObject({ ok: false, fehler: ['Wiederholung braucht eine Frist.'] });
    d.aufgabeAendern({ aufgabeId: 'a', aenderungen: { frist: '2026-11-20', wiederholung: monatlich } });
    expect(d.aufgabe('a')!.wiederholung).toEqual({ ...monatlich, anker: '2026-11-20' });
    d.aufgabeAendern({ aufgabeId: 'a', aenderungen: { wiederholung: monatlich } }); // unverändert → kein Event
    d.aufgabeAendern({ aufgabeId: 'a', aenderungen: { frist: '2026-11-25' } });
    expect(d.aufgabe('a')!.wiederholung!.anker).toBe('2026-11-25');
    d.aufgabeAendern({ aufgabeId: 'a', aenderungen: { wiederholung: { einheit: 'monat', alle: 6 } } });
    d.aufgabeAendern({ aufgabeId: 'a', aenderungen: { wiederholung: null } });
    expect(d.aufgabe('a')!.wiederholung).toBeNull();
    d.aufgabeAendern({ aufgabeId: 'a', aenderungen: { wiederholung: monatlich } });
    d.aufgabeAendern({ aufgabeId: 'a', aenderungen: { frist: null } });
    expect(d.aufgabe('a')).toMatchObject({ frist: null, wiederholung: null });
    expect(typen()).toEqual(['AufgabeErfasst', 'FristGesetzt', 'WiederholungGesetzt', 'FristGesetzt', 'WiederholungGesetzt', 'WiederholungAufgehoben',
      'WiederholungGesetzt', 'FristEntfernt', 'WiederholungAufgehoben']);
  });
});
