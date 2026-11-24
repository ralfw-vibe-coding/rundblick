// Kalenderquelle „ablage“: liest den jüngsten Kalender-Stand, den ein Gerät mit direktem Zugang (Mac) abgelegt hat.
// Schreiben geht nicht direkt – dafür erteilt der Body Kalender-Aufträge, die jenes Gerät ausführt.
// (Später austauschbar gegen eine direkte Quelle, z. B. Google per OAuth – dann entfallen die Aufträge.)
import type { KalenderStand } from '../../schema/extern';
import type { KalenderAblage, Kalenderquelle } from './interface';

const NICHT = () => Promise.reject(new Error('Dieses Gerät schreibt nicht selbst in Kalender – dafür gibt es Kalender-Aufträge.'));

export function ablageKalender(ablage: KalenderAblage, frisch = 5000): Kalenderquelle {
  let stand: KalenderStand | null = null, geholt = 0, laufend: Promise<KalenderStand | null> | null = null;
  const holen = (): Promise<KalenderStand | null> => {
    if (Date.now() - geholt < frisch) return Promise.resolve(stand);
    laufend ??= ablage.staende().then(alle => {
      stand = alle.sort((a, b) => b.zeit.localeCompare(a.zeit))[0] ?? null;
      geholt = Date.now();
      return stand;
    }).finally(() => { laufend = null; });
    return laufend;
  };
  return {
    art: 'ablage',
    herkunft: () => (stand ? { geraet: stand.geraet, zeit: stand.zeit } : null),
    zugriff: async () => { try { return (await holen()) ? 'erlaubt' : 'nichtVerfuegbar'; } catch { return stand ? 'erlaubt' : 'nichtVerfuegbar'; } },
    kalender: async () => (await holen())?.kalender ?? [],
    termine: async (von, bis) => ((await holen())?.termine ?? []).filter(t => t.datum >= von && t.datum <= bis),
    beiAenderung: () => () => {},
    terminAnlegen: NICHT, terminAendern: NICHT, terminLoeschen: NICHT, vorkommenLoeschen: NICHT, vorkommenVerschieben: NICHT, terminLesen: NICHT,
  };
}
