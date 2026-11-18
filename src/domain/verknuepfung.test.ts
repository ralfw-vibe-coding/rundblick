// Spiegelung von Buchungen in Google/iCloud: Verknüpfen, Abgleichen, Lösen.
import { beforeEach, describe, expect, it } from 'vitest';
import { SpeicherEventStore } from '../providers/eventstore/speicher';
import { Domain } from './domain';
import { HINWEIS_EXTERN_GELOESCHT } from './zustand';

let es: SpeicherEventStore, d: Domain, n = 0, uhr = Date.parse('2026-11-18T10:00:00Z');
beforeEach(() => {
  es = new SpeicherEventStore('t', () => `e${++n}`, () => new Date(uhr));
  d = new Domain(es);
  d.buchungEintragen({ buchungId: 'b1', titel: 'Call', datum: '2026-11-19', start: '10:00', dauer: 60 });
  d.buchungEintragen({ buchungId: 'r1', titel: 'Reservierung', datum: '2026-11-19', dauer: 60 });
});
const link = (buchungId = 'b1') => d.buchungVerknuepfen({ buchungId, kalenderId: 'k1', kalender: 'Arbeit', konto: 'Google', farbe: '#2f7cf6', externeUid: 'uid-1', stand: 'fp1' });

describe('Spiegelung', () => {
  it('verknüpft einen Termin und merkt Kalender, UID und Stand', () => {
    expect(link()).toEqual({ ok: true });
    expect(d.buchung('b1')!.verknuepfung).toEqual({ kalenderId: 'k1', kalender: 'Arbeit', konto: 'Google', farbe: '#2f7cf6', externeUid: 'uid-1', stand: 'fp1' });
  });

  it('lehnt Reservierungen, doppelte Verknüpfung, fehlende UID und Unbekanntes ab', () => {
    expect(link('r1')).toMatchObject({ ok: false, fehler: ['Nur Termine (mit Uhrzeit) lassen sich spiegeln.'] });
    expect(link('gibtsnicht')).toMatchObject({ ok: false });
    expect(d.buchungVerknuepfen({ buchungId: 'b1', kalenderId: 'k', kalender: '', konto: '', farbe: '', externeUid: ' ', stand: '' })).toMatchObject({ ok: false });
    link();
    expect(link()).toMatchObject({ ok: false, fehler: ['Die Buchung ist schon gespiegelt.'] });
  });

  it('abgleichen setzt den Stand; gleicher Stand erzeugt kein Event; nur für gespiegelte Buchungen', () => {
    expect(d.buchungAbgleichen({ buchungId: 'b1', stand: 'x' })).toMatchObject({ ok: false });
    link();
    d.buchungAbgleichen({ buchungId: 'b1', stand: 'fp2' });
    d.buchungAbgleichen({ buchungId: 'b1', stand: 'fp2' });
    expect(es.lesen({ typen: ['BuchungAbgeglichen'] }).events).toHaveLength(1);
    expect(d.buchung('b1')!.verknuepfung!.stand).toBe('fp2');
  });

  it('gespiegelte Termine brauchen eine Uhrzeit', () => {
    link();
    expect(d.buchungAendern({ buchungId: 'b1', aenderungen: { start: null } })).toMatchObject({ ok: false });
    expect(d.buchungAendern({ buchungId: 'b1', aenderungen: { start: '11:00' } })).toEqual({ ok: true });
  });

  it('Lösen: manuell ohne Hinweis, extern gelöscht mit Hinweis; erneutes Verknüpfen löscht den Hinweis', () => {
    expect(d.verknuepfungLoesen({ buchungId: 'gibtsnicht', grund: 'manuell' })).toMatchObject({ ok: false });
    expect(d.verknuepfungLoesen({ buchungId: 'b1', grund: 'manuell' })).toEqual({ ok: true }); // nicht verknüpft → nichts
    link();
    d.verknuepfungLoesen({ buchungId: 'b1', grund: 'manuell' });
    expect(d.buchung('b1')).toMatchObject({ verknuepfung: null, hinweis: null });
    link();
    d.verknuepfungLoesen({ buchungId: 'b1', grund: 'externGeloescht' });
    expect(d.buchung('b1')).toMatchObject({ verknuepfung: null, hinweis: HINWEIS_EXTERN_GELOESCHT });
    link();
    expect(d.buchung('b1')!.hinweis).toBeNull();
  });

  it('„zuletzt“ folgt nur inhaltlichen Änderungen', () => {
    const vorher = d.buchung('b1')!.zuletzt;
    expect(vorher).toBe('2026-11-18T10:00:00.000Z');
    uhr += 60_000; d.buchungAendern({ buchungId: 'b1', aenderungen: { belegt: false } });
    expect(d.buchung('b1')!.zuletzt).toBe(vorher);
    uhr += 60_000; d.buchungAendern({ buchungId: 'b1', aenderungen: { titel: 'Neu' } });
    expect(d.buchung('b1')!.zuletzt).toBe('2026-11-18T10:02:00.000Z');
  });
});
