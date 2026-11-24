// Pure Funktionen: offene Kalender-Aufträge in die Anzeige einrechnen – was beauftragt ist, erscheint schon so,
// wie es werden soll (verschoben, gelöscht, gespiegelt), mit Kennzeichen „wartet“.
import type { KalenderauftragZ } from '../../domain/interface';
import type { ExternerTermin, KalenderInfo } from '../../schema/extern';

export type AuftragKontext = {
  /** Buchungen, deren Spiegeln beauftragt, aber noch nicht erledigt ist → Zielkalender */
  spiegelnWartet: Map<string, { kalender: string; konto: string; farbe: string }>;
  /** Buchungen, deren letztes Spiegeln fehlschlug → Meldung */
  spiegelnFehler: Map<string, string>;
};

export const offen = (a: KalenderauftragZ[]) => a.filter(x => !x.erledigt);

export function auftragKontext(auftraege: KalenderauftragZ[], kalender: KalenderInfo[]): AuftragKontext {
  const spiegelnWartet = new Map<string, { kalender: string; konto: string; farbe: string }>(), spiegelnFehler = new Map<string, string>();
  for (const a of auftraege) {
    if (a.art !== 'spiegeln' || !a.buchungId) continue;
    if (!a.erledigt) {
      const k = kalender.find(x => x.id === a.kalender.id) ?? kalender.find(x => x.name === a.kalender.name && x.konto === a.kalender.konto);
      spiegelnWartet.set(a.buchungId, { kalender: a.kalender.name, konto: a.kalender.konto, farbe: k?.farbe ?? '#888888' });
      spiegelnFehler.delete(a.buchungId);
    } else if (!a.erledigt.ok) spiegelnFehler.set(a.buchungId, a.erledigt.meldung);
    else spiegelnFehler.delete(a.buchungId);
  }
  return { spiegelnWartet, spiegelnFehler };
}

const gleich = (t: ExternerTermin, v: NonNullable<KalenderauftragZ['termin']>) =>
  t.id === v.terminId || (!!v.uid && t.uid === v.uid && t.datum === v.datum && t.start === v.start);

/** externe Termine mit offenen Aufträgen: Gelöschtes fehlt, Verschobenes steht am neuen Platz (wartet = true) */
export function mitAuftraegen(termine: ExternerTermin[], auftraege: KalenderauftragZ[]): (ExternerTermin & { wartet?: boolean })[] {
  const o = offen(auftraege).filter(a => a.termin && a.art !== 'spiegeln');
  if (!o.length) return termine;
  return termine.flatMap(t => {
    const a = [...o].reverse().find(x => gleich(t, x.termin!));
    if (!a) return [t];
    if (a.art === 'loeschen') return [];
    return [{ ...t, datum: a.ziel!.datum, start: a.ziel!.start, dauer: a.ziel!.dauer, wartet: true }];
  });
}
