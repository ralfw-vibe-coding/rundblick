// IndexedDB der Phone App: Events, Abgleich-Zustand, Bilder, Warteschlange.
// Echtes Browser-Werkzeug (wie src/main/aktualisierung.ts am Desktop) – die Logik steckt in den getesteten Providern.
import type { AnhangAuftrag, AnhangLokal } from '../providers/anhaenge/fern';
import type { FernZustand, LokalerEventSpeicher } from '../providers/eventstore/fern';
import type { Rohevent } from '../providers/eventstore/speicher';

const NAME = 'rundblick';

export function datenbankOeffnen(): Promise<IDBDatabase> {
  return new Promise((ok, fehler) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('events', { keyPath: 'id' });
      db.createObjectStore('meta');
      db.createObjectStore('anhaenge');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fehler(r.error);
  });
}

export function datenbankLoeschen(db: IDBDatabase): Promise<void> {
  db.close();
  return new Promise((ok, fehler) => { const r = indexedDB.deleteDatabase(NAME); r.onsuccess = () => ok(); r.onerror = () => fehler(r.error); r.onblocked = () => ok(); });
}

const anfrage = <T>(r: IDBRequest<T>) => new Promise<T>((ok, fehler) => { r.onsuccess = () => ok(r.result); r.onerror = () => fehler(r.error); });
const fertig = (t: IDBTransaction) => new Promise<void>((ok, fehler) => { t.oncomplete = () => ok(); t.onerror = () => fehler(t.error); t.onabort = () => fehler(t.error); });

export function eventSpeicher(db: IDBDatabase): LokalerEventSpeicher {
  return {
    async laden() {
      const t = db.transaction(['events', 'meta'], 'readonly');
      const events = await anfrage(t.objectStore('events').getAll()) as Rohevent[];
      const zustand = (await anfrage(t.objectStore('meta').get('fern')) ?? null) as FernZustand | null;
      return { events, zustand };
    },
    async hinzufuegen(events) {
      const t = db.transaction('events', 'readwrite');
      const s = t.objectStore('events');
      events.forEach(e => s.put(e));
      await fertig(t);
    },
    async zustandSpeichern(z) {
      const t = db.transaction('meta', 'readwrite');
      t.objectStore('meta').put(z, 'fern');
      await fertig(t);
    },
  };
}

export function anhangSpeicher(db: IDBDatabase): AnhangLokal {
  const meta = async <T>(art: 'readonly' | 'readwrite', f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
    const t = db.transaction(['anhaenge', 'meta'], art);
    const r = f(art === 'readonly' ? t.objectStore('anhaenge') : t.objectStore('anhaenge'));
    const ergebnis = r ? await anfrage(r) : undefined;
    await fertig(t);
    return ergebnis;
  };
  return {
    lesen: async id => ((await meta('readonly', s => s.get(id))) as Uint8Array | undefined) ?? null,
    schreiben: async (id, d) => { await meta('readwrite', s => { s.put(d, id); }); },
    entfernen: async id => { await meta('readwrite', s => { s.delete(id); }); },
    async warteschlangeLesen() {
      const t = db.transaction('meta', 'readonly');
      return ((await anfrage(t.objectStore('meta').get('anhangSchlange'))) ?? []) as AnhangAuftrag[];
    },
    async warteschlangeSchreiben(a) {
      const t = db.transaction('meta', 'readwrite');
      t.objectStore('meta').put(a, 'anhangSchlange');
      await fertig(t);
    },
  };
}
