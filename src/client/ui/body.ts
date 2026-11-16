// Der Client sieht nur das Body interface. Diese Proxy-Implementierung leitet jeden Aufruf weiter:
// im Electron-Fenster über die Preload-Brücke (IPC), im Browser über das lokale Web-API (HTTP + SSE).
import type { Bereich, Body, BodyMethode } from '../../body/interface';

type Bruecke = {
  aufruf(methode: BodyMethode, argument?: unknown): Promise<unknown>;
  beiAenderung(cb: (bereiche: Bereich[]) => void): () => void;
};
declare global { interface Window { rb?: Bruecke } }

const webBruecke: Bruecke = {
  async aufruf(methode, argument) {
    const r = await fetch(`/api/${methode}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rundblick': '1' }, body: JSON.stringify(argument ?? {}) });
    const daten = await r.json();
    if (!r.ok) throw new Error(daten?.fehler ?? `HTTP ${r.status}`);
    return daten;
  },
  beiAenderung(cb) {
    const quelle = new EventSource('/api/aenderungen');
    quelle.onmessage = e => cb(JSON.parse(e.data) as Bereich[]);
    return () => quelle.close();
  },
};

const bruecke = (): Bruecke => window.rb ?? webBruecke;

export const body: Body = new Proxy({} as Body, {
  get(_z, name: string) {
    if (name === 'beiAenderung') return (cb: (b: Bereich[]) => void) => bruecke().beiAenderung(cb);
    return (argument?: unknown) => bruecke().aufruf(name as BodyMethode, argument);
  },
});
