// Logbuch: Notizen (Domain + Body) und alles, was explizit abgehakt wurde.
import { beforeEach, describe, expect, it } from 'vitest';
import { Domain } from '../domain/domain';
import { titelUndRest } from '../domain/commands/notizen';
import { speicherAnhaenge } from '../providers/anhaenge/datei';
import { speicherEinstellungen } from '../providers/einstellungen/json';
import { SpeicherEventStore } from '../providers/eventstore/speicher';
import { zaehlerIds } from '../providers/ids/ulid';
import { kalenderCache } from '../providers/kalender/cache';
import { beispielKalender } from '../providers/kalender/fake';
import type { Uhr } from '../providers/uhr/interface';
import { datumLokal } from '../providers/uhr/system';
import { lokal, notizTitel, tagsAusText } from './abfragen/logbuch';
import { RundblickBody } from './body';
import type { CommandStatus, LogEintrag } from './interface';

// Eine Uhr, die sich im Test vorstellen lässt (lokale Zeit)
let jetzt = new Date('2026-11-18T09:15:00');
const uhr: Uhr = { jetzt: () => new Date(jetzt), heute: () => datumLokal(jetzt), minuteDesTages: () => jetzt.getHours() * 60 + jetzt.getMinutes() };
const stellen = (iso: string) => { jetzt = new Date(iso); };

let body: RundblickBody;
let domain: Domain;
const BILD = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71]).toString('base64');
const id = (r: CommandStatus, k: string) => (r.ok ? r.ids![k]! : '');
const kurz = (e: LogEintrag) => e.art === 'aufgabe' ? `A ${e.uhrzeit} ${e.titel}` : e.art === 'punkt' ? `P ${e.uhrzeit} ${e.text} (${e.aufgabentitel})` : `N ${e.uhrzeit ?? '--:--'} ${e.titel}`;

beforeEach(() => {
  stellen('2026-11-18T09:15:00');
  const es = new SpeicherEventStore('t', zaehlerIds('e').neu, () => uhr.jetzt());
  domain = new Domain(es);
  body = new RundblickBody({
    domain, uhr, ids: zaehlerIds('x'), einstellungen: speicherEinstellungen(), kalender: beispielKalender(),
    cache: kalenderCache(), anhaenge: speicherAnhaenge(), info: { datenordner: '/d', geraet: 'g' },
  });
  body.einrichten();
});

describe('Notizen', () => {
  it('erfassen: #tags werden aus dem Text gelöst, Datum ist heute', async () => {
    const n = id(await body.notizErfassen({ text: 'Idee für den Workshop #ki #Workshop' }), 'notizId');
    expect(await body.notiz({ notizId: n })).toMatchObject({ text: 'Idee für den Workshop', tags: ['ki', 'workshop'], datum: '2026-11-18', anhangliste: [] });
  });

  it('erfassen mit ausdrücklichen Tags und Datum; leer oder ungültig wird abgelehnt', async () => {
    const n = id(await body.notizErfassen({ text: 'Text mit #nichtTag', tags: ['a'], datum: '2026-11-10' }), 'notizId');
    expect(await body.notiz({ notizId: n })).toMatchObject({ text: 'Text mit #nichtTag', tags: ['a'], datum: '2026-11-10' });
    expect(await body.notizErfassen({ text: '  ' })).toMatchObject({ ok: false });
    expect(await body.notizErfassen({ text: 'x', datum: 'gestern' })).toMatchObject({ ok: false });
  });

  it('ändern: Text, Tags, Datum – nur echte Änderungen; Fehlerfälle', async () => {
    const n = id(await body.notizErfassen({ text: 'A', tags: ['alt'] }), 'notizId');
    expect(await body.notizAendern({ notizId: n, text: 'B', tags: ['neu'], datum: '2026-11-17' })).toEqual({ ok: true });
    expect(await body.notizAendern({ notizId: n, text: 'B' })).toEqual({ ok: true });
    expect(await body.notiz({ notizId: n })).toMatchObject({ text: 'B', tags: ['neu'], datum: '2026-11-17' });
    expect(await body.notizAendern({ notizId: n, text: '' })).toMatchObject({ ok: false });
    expect(await body.notizAendern({ notizId: n, datum: 'x' })).toMatchObject({ ok: false });
    expect(await body.notizAendern({ notizId: 'fehlt', text: 'x' })).toMatchObject({ ok: false, fehler: ['Notiz unbekannt.'] });
  });

  it('Bilder anhängen und entfernen; kaputte Daten und falscher Typ werden abgelehnt', async () => {
    const n = id(await body.notizErfassen({ text: 'Foto' }), 'notizId');
    const a = id(await body.notizAnhangHinzufuegen({ notizId: n, name: 'x.png', typ: 'image/png', daten: BILD }), 'anhangId');
    expect((await body.notiz({ notizId: n }))!.anhangliste).toMatchObject([{ id: a, nr: 1, name: 'x.png' }]);
    expect(await body.anhang({ anhangId: a })).toMatchObject({ typ: 'image/png' });
    expect(await body.notizAnhangHinzufuegen({ notizId: n, name: 'x.txt', typ: 'text/plain', daten: BILD })).toMatchObject({ ok: false });
    expect(await body.notizAnhangHinzufuegen({ notizId: n, name: 'x', typ: 'image/png', daten: 'data:image/png;base64,!!!' })).toMatchObject({ ok: false });
    expect(await body.notizAnhangEntfernen({ notizId: n, anhangId: a })).toEqual({ ok: true });
    expect(await body.notizAnhangEntfernen({ notizId: n, anhangId: a })).toEqual({ ok: true });
    expect((await body.notiz({ notizId: n }))!.anhangliste).toEqual([]);
    expect(await body.anhang({ anhangId: a })).toBeNull();
  });

  it('verwerfen: Notiz und Bilder sind weg; zweimal verwerfen schadet nicht', async () => {
    const n = id(await body.notizErfassen({ text: 'Weg damit' }), 'notizId');
    const a = id(await body.notizAnhangHinzufuegen({ notizId: n, name: 'x.png', typ: 'image/png', daten: BILD }), 'anhangId');
    expect(await body.notizVerwerfen({ notizId: n })).toEqual({ ok: true });
    expect(await body.notizVerwerfen({ notizId: n })).toEqual({ ok: true });
    expect(await body.notiz({ notizId: n })).toBeNull();
    expect(await body.anhang({ anhangId: a })).toBeNull();
    expect(await body.notizVerwerfen({ notizId: 'fehlt' })).toMatchObject({ ok: false });
    expect(await body.notizAendern({ notizId: n, text: 'x' })).toMatchObject({ ok: false });
  });

  it('aus einer Notiz wird eine Aufgabe: erste Zeile Titel, Rest Notiz, Tags und Bilder wandern mit', async () => {
    const n = id(await body.notizErfassen({ text: '# Angebot prüfen\n\nDetails\n- [ ] Preis', tags: ['kunde'] }), 'notizId');
    const bild = id(await body.notizAnhangHinzufuegen({ notizId: n, name: 'x.png', typ: 'image/png', daten: BILD }), 'anhangId');
    const r = await body.aufgabeAusNotiz({ notizId: n });
    const a = id(r, 'aufgabeId');
    expect(await body.aufgabe({ aufgabeId: a })).toMatchObject({ titel: 'Angebot prüfen', beschreibung: 'Details\n- [ ] Preis', tags: ['kunde'], abgeschlossen: false });
    expect((await body.aufgabe({ aufgabeId: a }))!.anhangliste.map(x => x.id)).toEqual([bild]);
    expect(await body.anhang({ anhangId: bild })).not.toBeNull();
    expect(await body.notiz({ notizId: n })).toBeNull();
    expect((await body.liste({})).gruppen.find(g => g.art === 'ohne')!.aufgaben[0]!.titel).toBe('Angebot prüfen');
    // einmal umgewandelt, nicht noch einmal – und nicht mehr änderbar
    expect(await body.aufgabeAusNotiz({ notizId: n })).toMatchObject({ ok: false });
    expect(domain.notizAendern({ notizId: n, aenderungen: { text: 'x' } })).toMatchObject({ ok: false, fehler: [expect.stringContaining('Aufgabe')] });
    expect(domain.aufgabeAusNotiz({ notizId: id(await body.notizErfassen({ text: 'Y' }), 'notizId'), aufgabeId: a })).toMatchObject({ ok: false });
  });

  it('Tag-Vorschläge enthalten auch Notiz-Tags', async () => {
    await body.notizErfassen({ text: 'x #lesen' });
    expect(await body.vorschlaege({ art: 'tag', praefix: 'le' })).toEqual(['lesen']);
  });
});

describe('Logbuch', () => {
  it('sammelt abgeschlossene Aufgaben, abgehakte Punkte und Notizen pro Tag, neuester Tag zuerst', async () => {
    const a = id(await body.aufgabeErfassen({ titel: 'Angebot', beschreibung: '- [ ] Preis\n- [ ] Text', tags: ['kunde'] }), 'aufgabeId');
    stellen('2026-11-17T10:00:00');
    await body.aufgabeAendern({ aufgabeId: a, aenderungen: { beschreibung: '- [x] Preis\n- [ ] Text' } });
    stellen('2026-11-18T08:30:00');
    await body.notizErfassen({ text: 'Morgenseiten\nEin paar Gedanken' });
    stellen('2026-11-18T11:05:00');
    await body.aufgabeAbschliessen({ aufgabeId: a });
    const l = await body.logbuch({});
    expect(l.tage.map(t => [t.datum, t.eintraege.map(kurz)])).toEqual([
      ['2026-11-18', ['N 08:30 Morgenseiten', 'A 11:05 Angebot']],
      ['2026-11-17', ['P 10:00 Preis (Angebot)']],
    ]);
    expect(l.weiter).toBeNull();
    expect(l.tage[0]!.eintraege[0]).toMatchObject({ vorschau: 'Ein paar Gedanken', bilder: 0 });
  });

  it('wieder geöffnet / wieder aufgehakt / verworfen → aus dem Logbuch; archiviert bleibt', async () => {
    const a = id(await body.aufgabeErfassen({ titel: 'A', beschreibung: '- [ ] P' }), 'aufgabeId');
    const b = id(await body.aufgabeErfassen({ titel: 'B' }), 'aufgabeId');
    const c = id(await body.aufgabeErfassen({ titel: 'C' }), 'aufgabeId');
    await body.aufgabeAendern({ aufgabeId: a, aenderungen: { beschreibung: '- [x] P' } });
    await body.aufgabeAendern({ aufgabeId: a, aenderungen: { beschreibung: '- [ ] P' } });
    await body.aufgabeAbschliessen({ aufgabeId: a });
    await body.aufgabeWiedereroeffnen({ aufgabeId: a });
    await body.aufgabeAbschliessen({ aufgabeId: b });
    await body.aufgabeArchivieren({ aufgabeId: b });
    await body.aufgabeAbschliessen({ aufgabeId: c });
    await body.aufgabeVerwerfen({ aufgabeId: c });
    const t = (await body.logbuch({})).tage[0]!;
    expect(t.eintraege).toEqual([expect.objectContaining({ art: 'aufgabe', titel: 'B', archiviert: true })]);
  });

  it('heute steht immer da; nachgetragene Notizen stehen ohne Uhrzeit am Ende ihres Tages', async () => {
    expect((await body.logbuch({})).tage).toEqual([{ datum: '2026-11-18', eintraege: [] }]);
    stellen('2026-11-18T07:00:00');
    await body.notizErfassen({ text: 'Gestern vergessen', datum: '2026-11-17' });
    stellen('2026-11-17T08:00:00');
    const x = id(await body.aufgabeErfassen({ titel: 'X' }), 'aufgabeId');
    await body.aufgabeAbschliessen({ aufgabeId: x });
    stellen('2026-11-18T09:00:00');
    const gestern = (await body.logbuch({})).tage[1]!;
    expect(gestern.eintraege.map(kurz)).toEqual(['A 08:00 X', 'N --:-- Gestern vergessen']);
  });

  it('blättert in Portionen zurück; Filter nach Text und #tag', async () => {
    for (let i = 1; i <= 5; i++) await body.notizErfassen({ text: `Tag ${i}${i % 2 ? ' #ungerade' : ''}`, datum: `2026-11-0${i}` });
    const p1 = await body.logbuch({ tage: 3 });
    expect(p1.tage.map(t => t.datum)).toEqual(['2026-11-18', '2026-11-05', '2026-11-04']);
    expect(p1.weiter).toBe('2026-11-03');
    const p2 = await body.logbuch({ bis: p1.weiter, tage: 3 });
    expect(p2.tage.map(t => t.datum)).toEqual(['2026-11-03', '2026-11-02', '2026-11-01']);
    expect(p2.weiter).toBeNull();
    const f = await body.logbuch({ filter: '#ungerade' });
    expect(f.tage.map(t => t.datum)).toEqual(['2026-11-05', '2026-11-03', '2026-11-01']);
    expect((await body.logbuch({ filter: 'tag 2' })).tage.map(t => t.datum)).toEqual(['2026-11-02']);
  });

  it('Notizen in der Zukunft verschieben den Anfang nach vorn', async () => {
    await body.notizErfassen({ text: 'Plan', datum: '2026-11-25' });
    expect((await body.logbuch({})).tage.map(t => t.datum)).toEqual(['2026-11-25', '2026-11-18']);
  });
});

describe('Hilfsfunktionen', () => {
  it('Titel und Vorschau einer Notiz', () => {
    expect(notizTitel('\n## Überschrift\n**fett** und - [x] erledigt\n')).toEqual({ titel: 'Überschrift', vorschau: 'fett und - erledigt' });
    expect(notizTitel('x\n' + 'a'.repeat(200)).vorschau).toHaveLength(160);
    expect(notizTitel('')).toEqual({ titel: '', vorschau: '' });
    expect(titelUndRest('\n\n# T\n\nRest')).toEqual({ titel: 'T', rest: 'Rest' });
    expect(titelUndRest('  ')).toEqual({ titel: '', rest: '' });
  });
  it('Tags aus Text', () => {
    expect(tagsAusText('Hallo #Welt und #welt, nicht#tag  # kein')).toEqual({ text: 'Hallo und, nicht#tag # kein', tags: ['welt'] });
  });
  it('lokale Zeit', () => {
    const d = new Date(2026, 10, 18, 7, 5);
    expect(lokal(d.toISOString())).toEqual({ datum: '2026-11-18', uhrzeit: '07:05' });
  });
});
