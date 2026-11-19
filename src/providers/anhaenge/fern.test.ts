import { describe, expect, it } from 'vitest';
import { FernAnhaenge, type AnhangAuftrag, type AnhangFern, type AnhangLokal } from './fern';

const b = (t: string) => new TextEncoder().encode(t);
const t = (d: Uint8Array | null) => (d ? new TextDecoder().decode(d) : null);
const warten = () => new Promise(r => setTimeout(r, 0));

function lokal(): AnhangLokal & { m: Map<string, Uint8Array>; q: AnhangAuftrag[] } {
  const l = {
    m: new Map<string, Uint8Array>(), q: [] as AnhangAuftrag[],
    lesen: async (id: string) => l.m.get(id) ?? null,
    schreiben: async (id: string, d: Uint8Array) => { l.m.set(id, d); },
    entfernen: async (id: string) => { l.m.delete(id); },
    warteschlangeLesen: async () => [...l.q],
    warteschlangeSchreiben: async (q: AnhangAuftrag[]) => { l.q = [...q]; },
  };
  return l;
}
function fern(): AnhangFern & { m: Map<string, Uint8Array>; offline: boolean; lesungen: number } {
  const f = {
    m: new Map<string, Uint8Array>(), offline: false, lesungen: 0,
    lesen: async (id: string) => { if (f.offline) throw new Error('offline'); f.lesungen++; return f.m.get(id) ?? null; },
    schreiben: async (id: string, d: Uint8Array) => { if (f.offline) throw new Error('offline'); f.m.set(id, d); },
    loeschen: async (id: string) => { if (f.offline) throw new Error('offline'); f.m.delete(id); },
  };
  return f;
}

describe('FernAnhaenge (Phone App)', () => {
  it('speichert sofort lokal, lädt beim Abgleich hoch – auch nach Neustart aus der Warteschlange', async () => {
    const l = lokal();
    const a = await FernAnhaenge.oeffnen(l);
    a.speichern('A1', b('bild'));
    expect(t(a.lesen('A1'))).toBe('bild');
    expect(a.wartend()).toBe(1);
    await a.fertig();
    expect(t(l.m.get('A1')!)).toBe('bild');
    expect(l.q).toEqual([{ art: 'hoch', id: 'A1' }]);

    const nachNeustart = await FernAnhaenge.oeffnen(l);
    const f = fern();
    nachNeustart.verbinden(f);
    await nachNeustart.abgleichen();
    expect(t(f.m.get('A1')!)).toBe('bild');
    expect(nachNeustart.wartend()).toBe(0);
    expect(l.q).toEqual([]);
  });

  it('entfernen ersetzt einen offenen Upload; löscht in der Ablage', async () => {
    const l = lokal(); const f = fern();
    const a = await FernAnhaenge.oeffnen(l);
    a.speichern('A1', b('x'));
    a.entfernen('A1');
    expect(a.wartend()).toBe(1);
    f.m.set('A1', b('alt'));
    a.verbinden(f);
    await a.abgleichen();
    expect(f.m.has('A1')).toBe(false);
    expect(l.m.has('A1')).toBe(false);
  });

  it('offline: Warteschlange bleibt, Fehler bricht ab; doppelter Anstoß teilt sich den Lauf', async () => {
    const l = lokal(); const f = fern();
    const a = await FernAnhaenge.oeffnen(l);
    a.speichern('A1', b('x'));
    a.verbinden(f);
    f.offline = true;
    await expect(a.abgleichen()).rejects.toThrow('offline');
    expect(a.wartend()).toBe(1);
    f.offline = false;
    const p1 = a.abgleichen(); const p2 = a.abgleichen();
    expect(p1).toBe(p2);
    await p1;
    expect(a.wartend()).toBe(0);
  });

  it('ohne Verbindung wird nichts hochgeladen; Auftrag für ein lokal verschwundenes Bild wird übersprungen', async () => {
    const l = lokal(); const f = fern();
    l.q = [{ art: 'hoch', id: 'weg' }];
    const a = await FernAnhaenge.oeffnen(l);
    await a.abgleichen();
    expect(a.wartend()).toBe(1);
    a.verbinden(f);
    await a.abgleichen();
    expect(a.wartend()).toBe(0);
    expect(f.m.size).toBe(0);
  });

  it('lesen: erst lokal, dann aus der Ablage nachladen und melden; Fehlendes nicht dauernd erfragen', async () => {
    const l = lokal(); const f = fern();
    l.m.set('L', b('lokal'));
    f.m.set('F', b('fern'));
    const a = await FernAnhaenge.oeffnen(l);
    const angekommen: string[] = [];
    a.beiAnkunft(id => angekommen.push(id));
    expect(a.lesen('L')).toBeNull();
    await warten();
    expect(t(a.lesen('L'))).toBe('lokal');
    expect(a.lesen('F')).toBeNull(); // ohne Verbindung
    await warten();
    expect(a.lesen('F')).toBeNull();
    a.verbinden(f);
    a.lesen('F');
    await warten(); await warten();
    expect(t(a.lesen('F'))).toBe('fern');
    expect(t(l.m.get('F')!)).toBe('fern');
    expect(angekommen).toEqual(['L', 'F']);
    a.lesen('gibtsnicht'); await warten(); await warten();
    const vorher = f.lesungen;
    a.lesen('gibtsnicht'); await warten();
    expect(f.lesungen).toBe(vorher);
    f.offline = true;
    a.verbinden(f);
    a.lesen('X'); await warten(); await warten();
    expect(a.lesen('X')).toBeNull();
  });
});
