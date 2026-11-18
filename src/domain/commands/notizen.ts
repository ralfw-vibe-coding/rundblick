// Commands rund um Notizen (Logbuch). Eine Notiz ist nur Text (erste Zeile = Titel), Tags, Bilder und ein Tag.
import { istDatum } from '../../basis/datum';
import type { EventStore } from '../../providers/eventstore/interface';
import { tag, type NeuesEvent } from '../../schema/events';
import type { Datum, Id } from '../../schema/werte';
import { anwenden, leererBestand, type Bestand } from '../bestand';
import type { NotizZ } from '../zustand';
import { BILDTYPEN, MAX_ANHANG, normTags } from './aufgaben';
import { entscheide, nichtLeer, type Entscheidung, type Ergebnis } from './basis';

const entw = (b: Bestand, e: Parameters<typeof anwenden>[1]) => { anwenden(b, e); return b; };
const ctx = (es: EventStore, tags: string[], regel: (b: Bestand) => Entscheidung): Ergebnis =>
  entscheide(es, { tags }, leererBestand, entw, regel);
const nein = (...f: string[]) => ({ ok: false as const, fehler: f });

function bearbeitbar(n: NotizZ | undefined): string | null {
  if (!n || n.verworfen) return 'Notiz unbekannt.';
  if (n.umgewandelt) return 'Aus der Notiz ist schon eine Aufgabe geworden.';
  return null;
}

/** Titel und Rest: erste nichtleere Zeile (ohne Markdown-Überschriftszeichen) und alles danach */
export function titelUndRest(text: string): { titel: string; rest: string } {
  const zeilen = text.split('\n');
  const i = zeilen.findIndex(z => z.trim());
  if (i < 0) return { titel: '', rest: '' };
  return { titel: zeilen[i]!.replace(/^\s*#+\s*/, '').trim(), rest: zeilen.slice(i + 1).join('\n').replace(/^\n+/, '') };
}

export function notizErfassen(es: EventStore, c: { notizId: Id; text: string; tags?: string[]; datum: Datum }): Ergebnis {
  return ctx(es, [tag.notiz(c.notizId)], b => {
    if (!nichtLeer(c.text)) return nein('Die Notiz ist leer.');
    if (!istDatum(c.datum)) return nein('Datum ist ungültig.');
    if (b.notizen.has(c.notizId)) return nein('Notiz existiert bereits.');
    return [{ typ: 'NotizErfasst', tags: [tag.notiz(c.notizId)], daten: { notizId: c.notizId, text: c.text, tags: normTags(c.tags), datum: c.datum } }];
  });
}

export type NotizAenderungen = { text?: string; tags?: string[]; datum?: Datum };

export function notizAendern(es: EventStore, c: { notizId: Id; aenderungen: NotizAenderungen }): Ergebnis {
  return ctx(es, [tag.notiz(c.notizId)], b => {
    const n = b.notizen.get(c.notizId);
    const nicht = bearbeitbar(n);
    if (nicht) return nein(nicht);
    const x = c.aenderungen, t = [tag.notiz(c.notizId)], id = c.notizId;
    if (x.text !== undefined && !nichtLeer(x.text)) return nein('Die Notiz ist leer.');
    if (x.datum !== undefined && !istDatum(x.datum)) return nein('Datum ist ungültig.');
    const ev: NeuesEvent[] = [];
    if (x.text !== undefined && x.text !== n!.text) ev.push({ typ: 'NotizTextGeaendert', tags: t, daten: { notizId: id, text: x.text } });
    if (x.tags !== undefined) {
      const neu = normTags(x.tags);
      neu.filter(g => !n!.tags.includes(g)).forEach(g => ev.push({ typ: 'NotizGetaggt', tags: t, daten: { notizId: id, tag: g } }));
      n!.tags.filter(g => !neu.includes(g)).forEach(g => ev.push({ typ: 'NotizTagEntfernt', tags: t, daten: { notizId: id, tag: g } }));
    }
    if (x.datum !== undefined && x.datum !== n!.datum) ev.push({ typ: 'NotizDatumGeaendert', tags: t, daten: { notizId: id, datum: x.datum } });
    return ev;
  });
}

export function notizVerwerfen(es: EventStore, c: { notizId: Id }): Ergebnis {
  return ctx(es, [tag.notiz(c.notizId)], b => {
    const n = b.notizen.get(c.notizId);
    if (!n) return nein('Notiz unbekannt.');
    if (n.verworfen) return [];
    return [{ typ: 'NotizVerworfen', tags: [tag.notiz(c.notizId)], daten: { notizId: c.notizId } }];
  });
}

export function notizAnhangHinzufuegen(es: EventStore, c: { notizId: Id; anhangId: Id; name: string; typ: string; groesse: number }): Ergebnis {
  return ctx(es, [tag.notiz(c.notizId)], b => {
    const n = b.notizen.get(c.notizId);
    const nicht = bearbeitbar(n);
    if (nicht) return nein(nicht);
    if (!BILDTYPEN.includes(c.typ)) return nein('Nur Bilder (PNG, JPEG, GIF, WebP, HEIC, SVG) können angehängt werden.');
    if (!(c.groesse > 0 && c.groesse <= MAX_ANHANG)) return nein('Das Bild ist zu groß (höchstens 25 MB).');
    if (n!.anhaenge.some(a => a.id === c.anhangId)) return [];
    return [{ typ: 'NotizAnhangHinzugefuegt', tags: [tag.notiz(c.notizId)], daten: { notizId: c.notizId, anhangId: c.anhangId, name: c.name.trim() || 'Bild', typ: c.typ, groesse: c.groesse } }];
  });
}

export function notizAnhangEntfernen(es: EventStore, c: { notizId: Id; anhangId: Id }): Ergebnis {
  return ctx(es, [tag.notiz(c.notizId)], b => {
    const n = b.notizen.get(c.notizId);
    const nicht = bearbeitbar(n);
    if (nicht) return nein(nicht);
    if (!n!.anhaenge.some(a => a.id === c.anhangId)) return [];
    return [{ typ: 'NotizAnhangEntfernt', tags: [tag.notiz(c.notizId)], daten: { notizId: c.notizId, anhangId: c.anhangId } }];
  });
}

/** Aus einer Notiz wird eine Aufgabe: erste Zeile = Titel, Rest = Notiz der Aufgabe; Tags und Bilder wandern mit */
export function aufgabeAusNotiz(es: EventStore, c: { notizId: Id; aufgabeId: Id }): Ergebnis {
  return ctx(es, [tag.notiz(c.notizId), tag.aufgabe(c.aufgabeId)], b => {
    const n = b.notizen.get(c.notizId);
    const nicht = bearbeitbar(n);
    if (nicht) return nein(nicht);
    if (b.aufgaben.has(c.aufgabeId)) return nein('Aufgabe existiert bereits.');
    const { titel, rest } = titelUndRest(n!.text);
    return [{
      typ: 'AufgabeAusNotizErstellt', tags: [tag.aufgabe(c.aufgabeId), tag.notiz(c.notizId)],
      daten: { aufgabeId: c.aufgabeId, notizId: c.notizId, titel: titel.slice(0, 300), beschreibung: rest, tags: [...n!.tags], anhaenge: n!.anhaenge.map(a => ({ ...a })) },
    }];
  });
}
