// Pure Funktion: das Logbuch – was an welchem Tag abgehakt wurde, dazu die Notizen.
// Abgeschlossene Aufgaben und abgehakte Checklisten-Punkte stehen am Tag (lokale Zeit) ihres Abhakens;
// Notizen an ihrem Datum. Tage und Einträge innerhalb eines Tages: umgekehrt chronologisch (neuester oben). Verworfene Aufgaben fehlen; archivierte bleiben (das Logbuch ist Geschichte).
import { fmt, uhrzeit } from '../../basis/datum';
import type { AufgabeZ, NotizZ } from '../../domain/interface';
import type { Datum } from '../../schema/werte';
import type { LogEintrag, Logbuch } from '../interface';

/** ISO-Zeitpunkt → lokales Datum und Uhrzeit */
export function lokal(iso: string): { datum: Datum; uhrzeit: string } {
  const d = new Date(iso);
  return { datum: fmt(d), uhrzeit: uhrzeit(d.getHours() * 60 + d.getMinutes()) };
}

/** erste nichtleere Zeile ohne Markdown-Überschrift = Titel; Rest als einzeilige Vorschau */
export function notizTitel(text: string): { titel: string; vorschau: string } {
  const zeilen = text.split('\n').map(z => z.trim()).filter(Boolean);
  const titel = (zeilen[0] ?? '').replace(/^#+\s*/, '');
  const vorschau = zeilen.slice(1).join(' ').replace(/[*_`#>]|\[( |x|X)\]/g, '').replace(/\s+/g, ' ').trim();
  return { titel, vorschau: vorschau.length > 160 ? vorschau.slice(0, 159) + '…' : vorschau };
}

type Sortiert = { datum: Datum; schluessel: string; e: LogEintrag; text: string };

export function logbuch(x: { aufgaben: AufgabeZ[]; notizen: NotizZ[]; heute: Datum; bis?: Datum | null; tage?: number; filter?: string }): Logbuch {
  const alle: Sortiert[] = [];
  for (const a of x.aufgaben) {
    if (a.verworfen) continue;
    const suche = [a.titel, ...a.tags.map(t => '#' + t)].join(' ');
    if (a.abgeschlossen && a.abgeschlossenAm) {
      const l = lokal(a.abgeschlossenAm);
      alle.push({ datum: l.datum, schluessel: a.abgeschlossenAm, text: suche, e: { art: 'aufgabe', aufgabeId: a.id, titel: a.titel, tags: a.tags, uhrzeit: l.uhrzeit, archiviert: a.archiviert } });
    }
    // wiederkehrende Aufgaben: jede Erledigung steht an ihrem Tag
    for (const zeit of a.erledigt ?? []) {
      const l = lokal(zeit);
      alle.push({ datum: l.datum, schluessel: zeit, text: suche, e: { art: 'aufgabe', aufgabeId: a.id, titel: a.titel, tags: a.tags, uhrzeit: l.uhrzeit, archiviert: a.archiviert } });
    }
    for (const p of a.abgehakt) {
      const l = lokal(p.zeit);
      alle.push({ datum: l.datum, schluessel: p.zeit, text: `${p.text} ${suche}`, e: { art: 'punkt', aufgabeId: a.id, aufgabentitel: a.titel, text: p.text, uhrzeit: l.uhrzeit } });
    }
  }
  for (const n of x.notizen) {
    const { titel, vorschau } = notizTitel(n.text);
    const l = n.erfasst ? lokal(n.erfasst) : null;
    // nachgetragene Notizen (Datum ≠ Tag des Erfassens) stehen ohne Uhrzeit unten in ihrem Tag
    const amTag = l && l.datum === n.datum;
    alle.push({
      datum: n.datum, schluessel: amTag ? n.erfasst : `!${n.erfasst}`,
      text: [n.text, ...n.tags.map(t => '#' + t)].join(' '),
      e: { art: 'notiz', notizId: n.id, titel, vorschau, tags: n.tags, bilder: n.anhaenge.length, uhrzeit: amTag ? l!.uhrzeit : null },
    });
  }

  const f = (x.filter ?? '').trim().toLowerCase();
  const passend = f ? alle.filter(s => f.split(/\s+/).every(w => s.text.toLowerCase().includes(w))) : alle;

  const spaetester = passend.reduce((m, s) => (s.datum > m ? s.datum : m), x.heute);
  const bis = x.bis ?? spaetester;
  const tage = new Map<Datum, Sortiert[]>();
  for (const s of passend) if (s.datum <= bis) (tage.get(s.datum) ?? tage.set(s.datum, []).get(s.datum)!).push(s);
  // „Heute“ steht immer da (zum Hineinschreiben), wenn es im Bereich liegt und nicht gefiltert wird
  if (!f && x.heute <= bis && !tage.has(x.heute)) tage.set(x.heute, []);
  const daten = [...tage.keys()].sort().reverse();
  const anzahl = Math.max(1, x.tage ?? 14);
  return {
    heute: x.heute,
    tage: daten.slice(0, anzahl).map(datum => ({ datum, eintraege: tage.get(datum)!.sort((a, b) => b.schluessel.localeCompare(a.schluessel)).map(s => s.e) })),
    weiter: daten[anzahl] ?? null,
  };
}

/** #tags aus einem Text lösen: liefert den Text ohne die Tags und die Tags */
export function tagsAusText(text: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  const rest = text.replace(/(^|[ \t])#([\p{L}\p{N}_-]+)/gu, (_m, vor: string, t: string) => { tags.push(t.toLowerCase()); return vor; });
  return { text: rest.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.;:!?])/g, '$1').replace(/[ \t]+$/gm, '').trim(), tags: [...new Set(tags)] };
}
