// KalenderAblage über eine entfernte Dateiablage (Phone: Dropbox-API, Ordner /kalender) – ohne Node-APIs.
import type { KalenderStand } from '../../schema/extern';
import type { KalenderAblage } from './interface';

/** schmaler Zugang zur Dateiablage (vom Composition Root aus der Dropbox gebaut) */
export type KalenderFern = {
  auflisten(): Promise<string[]>;
  lesen(name: string): Promise<Uint8Array | null>;
  schreiben(name: string, daten: Uint8Array): Promise<void>;
};

export function fernKalenderAblage(fern: KalenderFern): KalenderAblage {
  return {
    async veroeffentlichen(s) { await fern.schreiben(`${s.geraet}.json`, new TextEncoder().encode(JSON.stringify(s))); },
    async staende() {
      const namen = (await fern.auflisten()).filter(n => n.endsWith('.json') && !n.startsWith('.'));
      const r = await Promise.all(namen.map(async n => {
        const d = await fern.lesen(n);
        try { return d ? [JSON.parse(new TextDecoder().decode(d)) as KalenderStand] : []; } catch { return []; }
      }));
      return r.flat();
    },
  };
}
