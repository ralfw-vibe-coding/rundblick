// Der Client sieht nur das Body interface. Diese Proxy-Implementierung leitet jeden Aufruf
// über die Preload-Brücke (IPC) an den Main-Prozess weiter.
import type { Bereich, Body, BodyMethode } from '../../body/interface';

type Bruecke = {
  aufruf(methode: BodyMethode, argument?: unknown): Promise<unknown>;
  beiAenderung(cb: (bereiche: Bereich[]) => void): () => void;
};
declare global { interface Window { rb: Bruecke } }

export const body: Body = new Proxy({} as Body, {
  get(_z, name: string) {
    if (name === 'beiAenderung') return (cb: (b: Bereich[]) => void) => window.rb.beiAenderung(cb);
    return (argument?: unknown) => window.rb.aufruf(name as BodyMethode, argument);
  },
});
