import { describe, expect, it } from 'vitest';
import type { NeuesEvent } from '../../schema/events';
import { zeilenSchreiben } from './format';
import { FernEventStore, OfflineFehler, type FernDatei, type Fernablage, type FernZustand, type LokalerEventSpeicher } from './fern';
import { SpeicherEventStore, type Rohevent } from './speicher';

const ev = (titel: string): NeuesEvent => ({
  typ: 'AufgabeErfasst', tags: [`aufgabe:${titel}`],
  daten: { aufgabeId: titel, titel, beschreibung: '', ort: '', verantwortlich: '', tags: [], frist: null, wiedervorlage: null, status: null },
});
const titel = (s: { lesen(): { events: { daten: unknown }[] } }) => s.lesen().events.map(e => (e.daten as { titel: string }).titel);
const kodiert = (t: string) => new TextEncoder().encode(t);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** „Desktop“: erzeugt echte Rohevents eines anderen Geräts */
class Geraet extends SpeicherEventStore {
  roh: Rohevent[] = [];
  protected override persistieren(e: Rohevent[]): void { this.roh.push(...e); }
}
let n = 0;
const ids = () => `id${++n}`;
let ms = Date.parse('2026-11-19T10:00:00Z');
const uhr = () => new Date((ms += 1000));

/** Dropbox-Ordner `events/` im Speicher, mit Revisionen und Cursor */
function ablage() {
  let version = 0;
  const dateien = new Map<string, { daten: Uint8Array; rev: number }>();
  const protokoll: string[] = [];
  let offline = false;
  let stoerung: string | null = null;
  const pruefen = () => { if (offline) throw new OfflineFehler('offline'); if (stoerung) throw new Error(stoerung); };
  const setzen = (name: string, daten: Uint8Array) => { version++; dateien.set(name, { daten, rev: version }); };
  const fern: Fernablage & { seiten?: number } = {
    async auflisten(cursor) {
      pruefen();
      const seit = cursor === null ? 0 : Number(cursor);
      const alle: FernDatei[] = [...dateien].filter(([, d]) => d.rev > seit).map(([name, d]) => ({ name, rev: `r${d.rev}`, groesse: d.daten.length }));
      // Seitenweise: höchstens 2 Dateien pro Seite
      const seite = alle.slice(0, 2);
      const mehr = alle.length > 2;
      const neuerCursor = mehr ? String(Math.max(...seite.map(d => Number(d.rev.slice(1)))) ) : String(version);
      return { dateien: seite, cursor: neuerCursor, mehr };
    },
    async lesen(name, ab = 0) {
      pruefen(); protokoll.push(`lesen ${name} ab ${ab}`);
      const d = dateien.get(name);
      return d ? { daten: d.daten.slice(ab), rev: `r${d.rev}` } : null;
    },
    async schreiben(name, daten, rev) {
      pruefen(); protokoll.push(`schreiben ${name} ${rev}`);
      const d = dateien.get(name);
      if ((d ? `r${d.rev}` : null) !== rev) return { ok: false, konflikt: true };
      setzen(name, daten);
      return { ok: true, rev: `r${version}` };
    },
    async warten(cursor) { pruefen(); return version > Number(cursor); },
  };
  return {
    fern, dateien, protokoll, setzen,
    anhaengen: (name: string, t: string) => { const alt = dateien.get(name)?.daten ?? new Uint8Array(); setzen(name, new Uint8Array([...alt, ...kodiert(t)])); },
    inhalt: (name: string) => text(dateien.get(name)!.daten),
    offline: (o: boolean) => { offline = o; },
    stoeren: (s: string | null) => { stoerung = s; },
  };
}

function lokalerSpeicher(): LokalerEventSpeicher & { events: Rohevent[]; zustand: FernZustand | null } {
  const l = {
    events: [] as Rohevent[], zustand: null as FernZustand | null,
    async laden() { return { events: [...l.events], zustand: l.zustand && structuredClone(l.zustand) }; },
    async hinzufuegen(e: Rohevent[]) { l.events.push(...e); },
    async zustandSpeichern(z: FernZustand) { l.zustand = structuredClone(z); },
  };
  return l;
}

const oeffnen = (lokal: LokalerEventSpeicher, geraet = 'iphone-ralf') => FernEventStore.oeffnen({ geraet, neueId: ids, jetzt: uhr, lokal });

describe('FernEventStore (Phone App, Dropbox)', () => {
  it('lädt die eigene Datei hoch und danach nur bei neuen Events wieder', async () => {
    const a = ablage();
    const s = await oeffnen(lokalerSpeicher());
    s.verbinden(a.fern);
    s.anhaengen([ev('Milch')]);
    expect(s.wartend()).toBe(1);
    await s.abgleichen();
    expect(s.wartend()).toBe(0);
    expect(a.inhalt('iphone-ralf.jsonl')).toContain('"titel":"Milch"');
    a.protokoll.length = 0;
    await s.abgleichen();
    expect(a.protokoll).toEqual([]);
    s.anhaengen([ev('Brot')]);
    await s.abgleichen();
    expect(a.protokoll).toEqual(['schreiben iphone-ralf.jsonl r1']);
    expect(a.inhalt('iphone-ralf.jsonl').trim().split('\n')).toHaveLength(2);
    expect(s.abgleichStand()).toMatchObject({ laeuft: false, online: true, wartend: 0, fehler: null });
    expect(s.abgleichStand().zuletzt).not.toBeNull();
  });

  it('liest fremde Dateien nur ab dem bekannten Ende und meldet fremde Events', async () => {
    const a = ablage();
    const mac = new Geraet('mac-ralf', ids, uhr);
    mac.anhaengen([ev('Vom Mac 1')]);
    a.anhaengen('mac-ralf.jsonl', zeilenSchreiben(mac.roh));
    const s = await oeffnen(lokalerSpeicher());
    const gemeldet: boolean[] = [];
    s.abonnieren(x => gemeldet.push(x.fremd));
    s.verbinden(a.fern);
    await s.abgleichen();
    expect(titel(s)).toEqual(['Vom Mac 1']);
    expect(gemeldet).toEqual([true]);
    const laenge = a.dateien.get('mac-ralf.jsonl')!.daten.length;
    mac.anhaengen([ev('Vom Mac 2')]);
    a.anhaengen('mac-ralf.jsonl', zeilenSchreiben(mac.roh.slice(1)));
    await s.abgleichen();
    expect(titel(s)).toEqual(['Vom Mac 1', 'Vom Mac 2']);
    expect(a.protokoll).toContain(`lesen mac-ralf.jsonl ab ${laenge}`);
  });

  it('wartet bei einer unvollständigen letzten Zeile, bis sie vollständig ist', async () => {
    const a = ablage();
    const mac = new Geraet('mac', ids, uhr);
    mac.anhaengen([ev('Eins'), ev('Zwei')]);
    const zeilen = zeilenSchreiben(mac.roh);
    const schnitt = zeilen.indexOf('\n') + 10;
    a.anhaengen('mac.jsonl', zeilen.slice(0, schnitt));
    const s = await oeffnen(lokalerSpeicher());
    s.verbinden(a.fern);
    await s.abgleichen();
    expect(titel(s)).toEqual(['Eins']);
    a.anhaengen('mac.jsonl', zeilen.slice(schnitt));
    await s.abgleichen();
    expect(titel(s)).toEqual(['Eins', 'Zwei']);
  });

  it('nur ein halber Satz ohne Zeilenende: noch nichts übernehmen', async () => {
    const a = ablage();
    a.anhaengen('mac.jsonl', '{"id":"x"');
    const s = await oeffnen(lokalerSpeicher());
    s.verbinden(a.fern);
    await s.abgleichen();
    expect(s.lesen().events).toHaveLength(0);
  });

  it('liest eine gekürzte/ersetzte Datei von vorn; Konfliktkopien und andere Dateien werden ignoriert', async () => {
    const a = ablage();
    const mac = new Geraet('mac', ids, uhr);
    mac.anhaengen([ev('A'), ev('B')]);
    a.anhaengen('mac.jsonl', zeilenSchreiben(mac.roh));
    a.anhaengen('mac (conflicted copy).jsonl', zeilenSchreiben(mac.roh));
    a.anhaengen('notizen.txt', 'hallo');
    const s = await oeffnen(lokalerSpeicher());
    s.verbinden(a.fern);
    await s.abgleichen();
    const neu = new Geraet('mac', ids, uhr);
    neu.anhaengen([ev('C')]);
    a.setzen('mac.jsonl', kodiert(zeilenSchreiben(neu.roh)));
    a.protokoll.length = 0;
    await s.abgleichen();
    expect(a.protokoll).toContain('lesen mac.jsonl ab 0');
    expect(titel(s)).toEqual(['A', 'B', 'C']);
  });

  it('übersteht einen Neustart: Events und Lesestand kommen aus dem lokalen Speicher', async () => {
    const a = ablage();
    const lokal = lokalerSpeicher();
    const mac = new Geraet('mac', ids, uhr);
    mac.anhaengen([ev('Mac')]);
    a.anhaengen('mac.jsonl', zeilenSchreiben(mac.roh));
    const s1 = await oeffnen(lokal);
    s1.verbinden(a.fern);
    s1.anhaengen([ev('Handy')]);
    await s1.abgleichen();
    await s1.fertig();

    const s2 = await oeffnen(lokal);
    expect(titel(s2).sort()).toEqual(['Handy', 'Mac']);
    expect(s2.wartend()).toBe(0);
    s2.verbinden(a.fern);
    a.protokoll.length = 0;
    await s2.abgleichen();
    expect(a.protokoll).toEqual([]);
    s2.anhaengen([ev('Nach Neustart')]);
    await s2.abgleichen();
    expect(a.inhalt('iphone-ralf.jsonl').trim().split('\n')).toHaveLength(2);
  });

  it('Neuinstallation mit gleichem Gerätenamen: übernimmt die vorhandene eigene Datei und hängt an', async () => {
    const a = ablage();
    const alt = await oeffnen(lokalerSpeicher());
    alt.verbinden(a.fern);
    alt.anhaengen([ev('Alt 1'), ev('Alt 2')]);
    await alt.abgleichen();

    const neu = await oeffnen(lokalerSpeicher());
    neu.anhaengen([ev('Offline erfasst')]);
    neu.verbinden(a.fern);
    await neu.abgleichen();
    expect(titel(neu)).toEqual(['Alt 1', 'Alt 2', 'Offline erfasst']);
    const zeilen = a.inhalt('iphone-ralf.jsonl').trim().split('\n');
    expect(zeilen).toHaveLength(3);
    expect(neu.wartend()).toBe(0);
  });

  it('Konflikt beim Hochladen (Datei inzwischen anders): zusammenführen und erneut hochladen', async () => {
    const a = ablage();
    const s = await oeffnen(lokalerSpeicher());
    s.verbinden(a.fern);
    s.anhaengen([ev('Eins')]);
    await s.abgleichen();
    // eine zweite Installation schreibt dazwischen in dieselbe Datei
    const zweite = await oeffnen(lokalerSpeicher());
    zweite.verbinden(a.fern);
    await zweite.abgleichen();
    zweite.anhaengen([ev('Von der zweiten')]);
    await zweite.abgleichen();
    s.anhaengen([ev('Zwei')]);
    // s kennt die neue Revision nicht (kein Holen dazwischen): direkt hochladen → Konflikt
    await s['hochladen'](a.fern);
    expect(a.inhalt('iphone-ralf.jsonl').trim().split('\n')).toHaveLength(3);
    expect(titel(s).sort()).toEqual(['Eins', 'Von der zweiten', 'Zwei']);
  });

  it('eigene Datei inzwischen gelöscht: neu anlegen', async () => {
    const a = ablage();
    const s = await oeffnen(lokalerSpeicher());
    s.verbinden(a.fern);
    s.anhaengen([ev('Eins')]);
    await s.abgleichen();
    a.dateien.delete('iphone-ralf.jsonl');
    s.anhaengen([ev('Zwei')]);
    await s['hochladen'](a.fern);
    expect(a.inhalt('iphone-ralf.jsonl').trim().split('\n')).toHaveLength(2);
  });

  it('gibt nach wiederholtem Konflikt auf', async () => {
    const a = ablage();
    const s = await oeffnen(lokalerSpeicher());
    s.anhaengen([ev('Eins')]);
    const stur: Fernablage = { ...a.fern, schreiben: async () => ({ ok: false, konflikt: true }), lesen: async () => null };
    s.verbinden(stur);
    await expect(s.abgleichen()).rejects.toThrow(/wiederholter Konflikt/);
    expect(s.abgleichStand().fehler).toMatch(/Konflikt/);
  });

  it('offline: lokal geht alles weiter, der Stand zeigt offline; danach wird nachgeholt', async () => {
    const a = ablage();
    const s = await oeffnen(lokalerSpeicher());
    s.verbinden(a.fern);
    a.offline(true);
    s.anhaengen([ev('Im Funkloch')]);
    await expect(s.abgleichen()).rejects.toBeInstanceOf(OfflineFehler);
    expect(s.abgleichStand()).toMatchObject({ online: false, wartend: 1, fehler: null, laeuft: false });
    a.offline(false);
    await s.abgleichen();
    expect(s.abgleichStand()).toMatchObject({ online: true, wartend: 0 });
  });

  it('andere Fehler erscheinen im Stand', async () => {
    const a = ablage();
    const s = await oeffnen(lokalerSpeicher());
    s.verbinden(a.fern);
    a.stoeren('Anmeldung abgelaufen');
    await expect(s.abgleichen()).rejects.toThrow('Anmeldung abgelaufen');
    expect(s.abgleichStand()).toMatchObject({ online: true, fehler: 'Anmeldung abgelaufen' });
  });

  it('läuft nie doppelt: ein Anstoß während des Laufs führt zu genau einem weiteren Durchgang', async () => {
    const a = ablage();
    let aufrufe = 0;
    const gezaehlt: Fernablage = { ...a.fern, auflisten: async c => { aufrufe++; return a.fern.auflisten(c); } };
    const s = await oeffnen(lokalerSpeicher());
    s.verbinden(gezaehlt);
    const l1 = s.abgleichen(); const l2 = s.abgleichen(); const l3 = s.abgleichen();
    expect(l1).toBe(l2);
    await Promise.all([l1, l2, l3]);
    expect(aufrufe).toBe(2);
  });

  it('holt mehrere Seiten der Dateiliste', async () => {
    const a = ablage();
    for (const g of ['a', 'b', 'c', 'd', 'e']) {
      const x = new Geraet(g, ids, uhr); x.anhaengen([ev(`von ${g}`)]); a.anhaengen(`${g}.jsonl`, zeilenSchreiben(x.roh));
    }
    const s = await oeffnen(lokalerSpeicher());
    s.verbinden(a.fern);
    await s.abgleichen();
    expect(s.lesen().events).toHaveLength(5);
  });

  it('ohne Verbindung: kein Abgleich, kein Warten; Trennen und Zurücksetzen', async () => {
    const a = ablage();
    const s = await oeffnen(lokalerSpeicher());
    await s.abgleichen();
    expect(await s.aufAenderungWarten()).toBe(false);
    s.verbinden(a.fern);
    expect(await s.aufAenderungWarten()).toBe(false); // noch kein Cursor
    s.anhaengen([ev('X')]);
    await s.abgleichen();
    // das eigene Hochladen ändert den Ordner: einmal melden, der nächste Durchgang liest nichts nach
    expect(await s.aufAenderungWarten()).toBe(true);
    a.protokoll.length = 0;
    await s.abgleichen();
    expect(a.protokoll).toEqual([]);
    expect(await s.aufAenderungWarten()).toBe(false);
    a.anhaengen('mac.jsonl', '\n');
    expect(await s.aufAenderungWarten()).toBe(true);
    let meldungen = 0;
    const ab = s.beiStand(() => meldungen++);
    s.verbinden(null);
    await s.zuruecksetzen();
    expect(meldungen).toBeGreaterThan(0);
    ab();
    expect(s.wartend()).toBe(1); // nach dem Zurücksetzen gilt nichts mehr als hochgeladen
    expect(s.abgleichStand().zuletzt).toBeNull();
    expect(s.dateiname).toBe('iphone-ralf.jsonl');
  });
});
