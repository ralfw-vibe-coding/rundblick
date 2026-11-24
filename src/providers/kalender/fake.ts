// Beispiel-Kalenderquelle für Entwicklung, Demo und Tests (RB_KALENDER=beispiel).
// Wiederkehrende Beispieltermine plus ein Speicher für gespiegelte Termine (Anlegen/Ändern/Löschen).
import type { ExternerTermin, KalenderInfo, KalenderZugriff, TerminDaten, Vorkommen } from '../../schema/extern';
import type { Datum } from '../../schema/werte';
import type { Kalenderquelle } from './interface';

const KALENDER: KalenderInfo[] = [
  { id: 'arbeit', name: 'Arbeit', konto: 'Google', farbe: '#2f7cf6', schreibbar: true },
  { id: 'privat', name: 'Privat', konto: 'iCloud', farbe: '#f08a24', schreibbar: true },
  { id: 'familie', name: 'Familie', konto: 'iCloud', farbe: '#d6409f', schreibbar: false },
];

function plus(d: Datum, n: number): Datum {
  const [y, m, t] = d.split('-').map(Number);
  const x = new Date(y!, m! - 1, t! + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
const wt = (d: Datum) => { const [y, m, t] = d.split('-').map(Number); return (new Date(y!, m! - 1, t!).getDay() + 6) % 7; };

export type BeispielKalender = Kalenderquelle & {
  /** simuliert eine Änderungsmeldung des Systems */
  aendern(): void;
  /** simuliert eine Änderung bzw. Löschung „von außen“ (z. B. in der Kalender-App) */
  extern: { aendern(uid: string, x: Partial<TerminDaten>, geaendert: string): void; loeschen(uid: string): void; alle(): ExternerTermin[] };
};

export function beispielKalender(zugriff: KalenderZugriff = 'erlaubt', jetzt: () => string = () => new Date().toISOString()): BeispielKalender {
  const abos = new Set<() => void>();
  const gespiegelt = new Map<string, ExternerTermin>();
  const geloescht = new Set<string>();
  /** verschobene Vorkommen der Beispiel-Serien: alte id → Termin am neuen Platz */
  const verschoben = new Map<string, ExternerTermin>();
  let n = 0;
  const als = (kalenderId: string, uid: string, t: TerminDaten, geaendert: string): ExternerTermin =>
    ({ id: `${uid}@${t.datum}`, kalenderId, titel: t.titel, datum: t.datum, start: t.start, dauer: t.dauer, ort: '', uid, notiz: t.notiz, geaendert });
  const inhalt = (e: ExternerTermin): TerminDaten => ({ titel: e.titel, notiz: e.notiz ?? '', datum: e.datum, start: e.start!, dauer: e.dauer });
  /** Vorkommen finden: per id, sonst per uid + Tag (wie ein anderes Gerät es täte) */
  const finden = (v: Vorkommen, liste: ExternerTermin[]) => liste.find(e => e.id === v.terminId) ?? (v.uid ? liste.find(e => e.uid === v.uid && e.datum === v.datum && e.start === v.start) : undefined);
  return {
    art: 'direkt',
    zugriff: async () => zugriff,
    kalender: async () => KALENDER,
    termine: async (von, bis) => {
      const r: ExternerTermin[] = [];
      for (let d = von; d <= bis; d = plus(d, 1)) {
        const w = wt(d);
        const t = (kalenderId: string, titel: string, start: string | null, dauer: number) => {
          const id = `${kalenderId}-${titel}-${d}`;
          if (!geloescht.has(id) && !verschoben.has(id)) r.push({ id, kalenderId, titel, datum: d, start, dauer, ort: '', uid: id, notiz: '', geaendert: null, serie: true });
        };
        if (w === 0) t('arbeit', 'Jour fixe', '09:30', 30);
        if (w === 2) t('arbeit', 'Weekly', '11:00', 60);
        if (w === 1) t('privat', 'Yoga', '18:30', 75);
        if (w === 3) t('privat', 'Lauftreff', '07:00', 60);
        if (w === 5 && Number(d.slice(8)) % 2 === 0) t('familie', 'Familienessen', '18:00', 120);
        if (Number(d.slice(8)) === 1) t('familie', 'Monatsanfang', null, 0);
      }
      return [...r, ...[...gespiegelt.values(), ...verschoben.values()].filter(e => e.datum >= von && e.datum <= bis)];
    },
    beiAenderung: cb => { abos.add(cb); return () => { abos.delete(cb); }; },
    aendern: () => abos.forEach(cb => cb()),
    terminAnlegen: async (kalenderId, t) => {
      if (!KALENDER.find(k => k.id === kalenderId)?.schreibbar) throw new Error('Kalender nicht beschreibbar');
      const e = als(kalenderId, `bsp-${++n}`, t, jetzt());
      gespiegelt.set(e.uid!, e);
      return e;
    },
    terminAendern: async (uid, t) => {
      const alt = gespiegelt.get(uid);
      if (!alt) return null;
      const e = als(alt.kalenderId, uid, t, jetzt());
      gespiegelt.set(uid, e);
      return e;
    },
    terminLoeschen: async uid => gespiegelt.delete(uid),
    vorkommenLoeschen: async v => {
      const g = finden(v, [...gespiegelt.values()]);
      if (g) return gespiegelt.delete(g.uid!);
      const vv = finden(v, [...verschoben.values()]);
      if (vv) { verschoben.delete(vv.uid!); geloescht.add(vv.uid!); return true; }
      const id = beispielId(v);
      if (!id || geloescht.has(id) || verschoben.has(id)) return false;
      geloescht.add(id);
      return true;
    },
    vorkommenVerschieben: async (v, z) => {
      const g = finden(v, [...gespiegelt.values()]);
      if (g) { const e = als(g.kalenderId, g.uid!, { ...inhalt(g), ...z }, jetzt()); gespiegelt.set(g.uid!, e); return e; }
      const vv = finden(v, [...verschoben.values()]);
      const alt = vv ? vv.uid! : beispielId(v);
      if (!alt || geloescht.has(alt) || (!vv && verschoben.has(alt))) return null;
      const titel = vv ? vv.titel : alt.split('-').slice(1, -3).join('-');
      const e: ExternerTermin = { id: `${alt}>${z.datum}T${z.start}`, kalenderId: alt.split('-')[0]!, titel, datum: z.datum, start: z.start, dauer: z.dauer, ort: '', uid: alt, notiz: '', geaendert: jetzt(), serie: true };
      verschoben.set(alt, e);
      return e;
    },
    terminLesen: async uid => gespiegelt.get(uid) ?? null,
    extern: {
      aendern: (uid, x, geaendert) => { const alt = gespiegelt.get(uid); if (alt) gespiegelt.set(uid, als(alt.kalenderId, uid, { ...inhalt(alt), ...x }, geaendert)); },
      loeschen: uid => { gespiegelt.delete(uid); },
      alle: () => [...gespiegelt.values()],
    },
  };
}

/** Kennung eines Beispiel-Serientermins (<kalender>-<titel>-<datum>), per id oder uid */
function beispielId(v: Vorkommen): string | null {
  const id = [v.terminId, v.uid].find(x => x && /^(arbeit|privat|familie)-.+-\d{4}-\d{2}-\d{2}$/.test(x));
  return id ?? null;
}
