// Beispiel-Kalenderquelle für Entwicklung, Demo und Tests (RB_KALENDER=beispiel).
import type { ExternerTermin, KalenderInfo, KalenderZugriff } from '../../schema/extern';
import type { Datum } from '../../schema/werte';
import type { Kalenderquelle } from './interface';

const KALENDER: KalenderInfo[] = [
  { id: 'arbeit', name: 'Arbeit', konto: 'Google', farbe: '#2f7cf6' },
  { id: 'privat', name: 'Privat', konto: 'iCloud', farbe: '#f08a24' },
  { id: 'familie', name: 'Familie', konto: 'iCloud', farbe: '#d6409f' },
];

function plus(d: Datum, n: number): Datum {
  const [y, m, t] = d.split('-').map(Number);
  const x = new Date(y!, m! - 1, t! + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
const wt = (d: Datum) => { const [y, m, t] = d.split('-').map(Number); return (new Date(y!, m! - 1, t!).getDay() + 6) % 7; };

export function beispielKalender(zugriff: KalenderZugriff = 'erlaubt'): Kalenderquelle & { aendern(): void } {
  const abos = new Set<() => void>();
  return {
    zugriff: async () => zugriff,
    kalender: async () => KALENDER,
    termine: async (von, bis) => {
      const r: ExternerTermin[] = [];
      for (let d = von; d <= bis; d = plus(d, 1)) {
        const w = wt(d);
        const t = (kalenderId: string, titel: string, start: string | null, dauer: number) => r.push({ id: `${kalenderId}-${titel}-${d}`, kalenderId, titel, datum: d, start, dauer, ort: '' });
        if (w === 0) t('arbeit', 'Jour fixe', '09:30', 30);
        if (w === 2) t('arbeit', 'Weekly', '11:00', 60);
        if (w === 1) t('privat', 'Yoga', '18:30', 75);
        if (w === 3) t('privat', 'Lauftreff', '07:00', 60);
        if (w === 5 && Number(d.slice(8)) % 2 === 0) t('familie', 'Familienessen', '18:00', 120);
        if (Number(d.slice(8)) === 1) t('familie', 'Monatsanfang', null, 0);
      }
      return r;
    },
    beiAenderung: cb => { abos.add(cb); return () => { abos.delete(cb); }; },
    aendern: () => abos.forEach(cb => cb()),
  };
}
