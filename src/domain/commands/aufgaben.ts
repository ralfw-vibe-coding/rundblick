// Commands rund um Aufgaben. Kontextmodell ist jeweils ein Bestand, gebaut nur aus den relevanten Events.
import { istDatum, istUhrzeit } from '../../basis/datum';
import type { EventStore } from '../../providers/eventstore/interface';
import { tag, type NeuesEvent } from '../../schema/events';
import type { Datum, Id, Minuten, Uhrzeit } from '../../schema/werte';
import { anwenden, leererBestand, type Bestand } from '../bestand';
import type { AufgabeZ } from '../zustand';
import { entscheide, fehler, nichtLeer, type Entscheidung, type Ergebnis } from './basis';

const entw = (b: Bestand, e: Parameters<typeof anwenden>[1]) => { anwenden(b, e); return b; };
const ctx = (es: EventStore, tags: string[], regel: (b: Bestand) => Entscheidung): Ergebnis =>
  entscheide(es, { tags }, leererBestand, entw, regel);

export type AufgabeFelder = {
  titel: string; beschreibung?: string; ort?: string; verantwortlich?: string; tags?: string[];
  frist?: Datum | null; wiedervorlage?: Datum | null; status?: Id | null;
};

function pruefeFelder(f: Partial<AufgabeFelder>, b: Bestand): string[] {
  const p: string[] = [];
  if ('titel' in f && !nichtLeer(f.titel)) p.push('Titel fehlt.');
  if (f.frist != null && !istDatum(f.frist)) p.push('Frist ist kein gültiges Datum.');
  if (f.wiedervorlage != null && !istDatum(f.wiedervorlage)) p.push('Wiedervorlage ist kein gültiges Datum.');
  if (f.status != null && !aktiv(b, f.status)) p.push('Diese Board-Spalte gibt es nicht.');
  return p;
}
const aktiv = (b: Bestand, statusId: Id) => { const s = b.spalten.get(statusId); return !!s && !s.entfernt; };
const normTags = (t: string[] = []) => [...new Set(t.map(x => x.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))];

function bearbeitbar(a: AufgabeZ | undefined): string | null {
  if (!a) return 'Aufgabe unbekannt.';
  if (a.verworfen) return 'Aufgabe wurde verworfen.';
  if (a.archiviert) return 'Aufgabe ist archiviert – erst aus dem Archiv holen.';
  if (a.abgeschlossen) return 'Aufgabe ist abgeschlossen – erst wieder öffnen.';
  return null;
}

export function aufgabeErfassen(es: EventStore, c: { aufgabeId: Id; felder: AufgabeFelder; buchung?: { buchungId: Id; datum: Datum; start?: Uhrzeit | null; dauer?: Minuten } }): Ergebnis {
  return ctx(es, [tag.aufgabe(c.aufgabeId), tag.spalten, tag.planung], b => {
    const f = c.felder;
    const p = pruefeFelder(f, b);
    if (!nichtLeer(f.titel)) p.unshift('Titel fehlt.');
    if (b.aufgaben.has(c.aufgabeId)) p.push('Aufgabe existiert bereits.');
    if (c.buchung) p.push(...pruefeBuchung(c.buchung));
    if (p.length) return { ok: false, fehler: [...new Set(p)] };
    const titel = f.titel.trim();
    const ev: NeuesEvent[] = [{
      typ: 'AufgabeErfasst', tags: [tag.aufgabe(c.aufgabeId)],
      daten: {
        aufgabeId: c.aufgabeId, titel, beschreibung: f.beschreibung ?? '', ort: f.ort?.trim() ?? '',
        verantwortlich: f.verantwortlich?.trim() ?? '', tags: normTags(f.tags), frist: f.frist ?? null,
        wiedervorlage: f.wiedervorlage ?? null, status: f.status ?? null,
      },
    }];
    if (c.buchung) ev.push({
      typ: 'BuchungAngelegt', tags: [tag.buchung(c.buchung.buchungId), tag.aufgabe(c.aufgabeId)],
      daten: {
        buchungId: c.buchung.buchungId, aufgabeId: c.aufgabeId, titel, beschreibung: '', datum: c.buchung.datum,
        dauer: c.buchung.dauer ?? b.planung.standarddauer, start: c.buchung.start ?? null, belegt: true,
      },
    });
    return ev;
  });
}

export function pruefeBuchung(x: { datum: Datum; start?: Uhrzeit | null; dauer?: Minuten }): string[] {
  const p: string[] = [];
  if (!istDatum(x.datum)) p.push('Datum der Buchung ist ungültig.');
  if (x.start != null && !istUhrzeit(x.start)) p.push('Startzeit ist ungültig.');
  if (x.dauer != null && !(Number.isInteger(x.dauer) && x.dauer > 0 && x.dauer <= 24 * 60)) p.push('Dauer muss zwischen 1 Minute und 24 Stunden liegen.');
  return p;
}

export type AufgabeAenderungen = Partial<Omit<AufgabeFelder, 'status'>>;

export function aufgabeAendern(es: EventStore, c: { aufgabeId: Id; aenderungen: AufgabeAenderungen }): Ergebnis {
  return ctx(es, [tag.aufgabe(c.aufgabeId)], b => {
    const a = b.aufgaben.get(c.aufgabeId);
    const nicht = bearbeitbar(a);
    if (nicht) return { ok: false, fehler: [nicht] };
    const x = c.aenderungen;
    const p = pruefeFelder(x, b);
    if (p.length) return { ok: false, fehler: p };
    const id = c.aufgabeId, t = [tag.aufgabe(id)];
    const ev: NeuesEvent[] = [];
    if (x.titel !== undefined && x.titel.trim() !== a!.titel) ev.push({ typ: 'AufgabeUmbenannt', tags: t, daten: { aufgabeId: id, titel: x.titel.trim() } });
    if (x.beschreibung !== undefined && x.beschreibung !== a!.beschreibung) ev.push({ typ: 'BeschreibungGeaendert', tags: t, daten: { aufgabeId: id, beschreibung: x.beschreibung } });
    if (x.ort !== undefined && x.ort.trim() !== a!.ort) ev.push({ typ: 'OrtGeaendert', tags: t, daten: { aufgabeId: id, ort: x.ort.trim() } });
    if (x.verantwortlich !== undefined && x.verantwortlich.trim() !== a!.verantwortlich) ev.push({ typ: 'VerantwortlicherGeaendert', tags: t, daten: { aufgabeId: id, verantwortlich: x.verantwortlich.trim() } });
    if (x.tags !== undefined) {
      const neu = normTags(x.tags);
      neu.filter(g => !a!.tags.includes(g)).forEach(g => ev.push({ typ: 'AufgabeGetaggt', tags: t, daten: { aufgabeId: id, tag: g } }));
      a!.tags.filter(g => !neu.includes(g)).forEach(g => ev.push({ typ: 'TagEntfernt', tags: t, daten: { aufgabeId: id, tag: g } }));
    }
    if (x.frist !== undefined && x.frist !== a!.frist) ev.push(x.frist === null ? { typ: 'FristEntfernt', tags: t, daten: { aufgabeId: id } } : { typ: 'FristGesetzt', tags: t, daten: { aufgabeId: id, frist: x.frist } });
    if (x.wiedervorlage !== undefined && x.wiedervorlage !== a!.wiedervorlage) ev.push(x.wiedervorlage === null ? { typ: 'WiedervorlageAufgehoben', tags: t, daten: { aufgabeId: id } } : { typ: 'WiedervorlageGesetzt', tags: t, daten: { aufgabeId: id, datum: x.wiedervorlage } });
    return ev;
  });
}

export function statusSetzen(es: EventStore, c: { aufgabeId: Id; status: Id | null }): Ergebnis {
  return ctx(es, [tag.aufgabe(c.aufgabeId), tag.spalten], b => {
    const a = b.aufgaben.get(c.aufgabeId);
    const nicht = bearbeitbar(a);
    if (nicht) return { ok: false, fehler: [nicht] };
    if (c.status !== null && !aktiv(b, c.status)) return { ok: false, fehler: ['Diese Board-Spalte gibt es nicht.'] };
    if (a!.status === c.status) return [];
    const t = [tag.aufgabe(c.aufgabeId)];
    return [c.status === null
      ? { typ: 'StatusEntfernt', tags: t, daten: { aufgabeId: c.aufgabeId } }
      : { typ: 'StatusGesetzt', tags: t, daten: { aufgabeId: c.aufgabeId, status: c.status } }];
  });
}

export function aufgabeAbschliessen(es: EventStore, c: { aufgabeId: Id }): Ergebnis {
  return ctx(es, [tag.aufgabe(c.aufgabeId)], b => {
    const a = b.aufgaben.get(c.aufgabeId);
    if (!a) return { ok: false, fehler: ['Aufgabe unbekannt.'] };
    if (a.verworfen) return { ok: false, fehler: ['Aufgabe wurde verworfen.'] };
    if (a.archiviert) return { ok: false, fehler: ['Aufgabe ist archiviert.'] };
    if (a.abgeschlossen) return [];
    return [{ typ: 'AufgabeAbgeschlossen', tags: [tag.aufgabe(a.id)], daten: { aufgabeId: a.id } }];
  });
}

export function aufgabeWiedereroeffnen(es: EventStore, c: { aufgabeId: Id }): Ergebnis {
  return ctx(es, [tag.aufgabe(c.aufgabeId)], b => {
    const a = b.aufgaben.get(c.aufgabeId);
    if (!a) return { ok: false, fehler: ['Aufgabe unbekannt.'] };
    if (a.verworfen) return { ok: false, fehler: ['Aufgabe wurde verworfen.'] };
    if (a.archiviert) return { ok: false, fehler: ['Aufgabe ist archiviert.'] };
    if (!a.abgeschlossen) return [];
    return [{ typ: 'AufgabeWiedereroeffnet', tags: [tag.aufgabe(a.id)], daten: { aufgabeId: a.id } }];
  });
}

export function aufgabeVerwerfen(es: EventStore, c: { aufgabeId: Id }): Ergebnis {
  return ctx(es, [tag.aufgabe(c.aufgabeId)], b => {
    const a = b.aufgaben.get(c.aufgabeId);
    if (!a) return { ok: false, fehler: ['Aufgabe unbekannt.'] };
    if (a.verworfen) return [];
    return [{ typ: 'AufgabeVerworfen', tags: [tag.aufgabe(a.id)], daten: { aufgabeId: a.id } }];
  });
}

/** Archivieren: Aufgabe wird verborgen (nicht gelöscht) – auch nicht mehr unter „Abgeschlossen“ */
export function aufgabeArchivieren(es: EventStore, c: { aufgabeId: Id }): Ergebnis {
  return ctx(es, [tag.aufgabe(c.aufgabeId)], b => {
    const a = b.aufgaben.get(c.aufgabeId);
    if (!a) return { ok: false, fehler: ['Aufgabe unbekannt.'] };
    if (a.verworfen) return { ok: false, fehler: ['Aufgabe wurde verworfen.'] };
    if (a.archiviert) return [];
    return [{ typ: 'AufgabeArchiviert', tags: [tag.aufgabe(a.id)], daten: { aufgabeId: a.id } }];
  });
}

export function aufgabeAusArchivHolen(es: EventStore, c: { aufgabeId: Id }): Ergebnis {
  return ctx(es, [tag.aufgabe(c.aufgabeId)], b => {
    const a = b.aufgaben.get(c.aufgabeId);
    if (!a || a.verworfen) return { ok: false, fehler: ['Aufgabe unbekannt.'] };
    if (!a.archiviert) return [];
    return [{ typ: 'AufgabeAusArchivGeholt', tags: [tag.aufgabe(a.id)], daten: { aufgabeId: a.id } }];
  });
}

export const BILDTYPEN = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/svg+xml'];
export const MAX_ANHANG = 25 * 1024 * 1024;

/** Bild an die Notiz einer Aufgabe hängen (die Datei selbst legt der Body über den Anhangspeicher ab) */
export function anhangHinzufuegen(es: EventStore, c: { aufgabeId: Id; anhangId: Id; name: string; typ: string; groesse: number }): Ergebnis {
  return ctx(es, [tag.aufgabe(c.aufgabeId)], b => {
    const a = b.aufgaben.get(c.aufgabeId);
    const nicht = bearbeitbar(a);
    if (nicht) return { ok: false, fehler: [nicht] };
    if (!BILDTYPEN.includes(c.typ)) return { ok: false, fehler: ['Nur Bilder (PNG, JPEG, GIF, WebP, HEIC, SVG) können angehängt werden.'] };
    if (!(c.groesse > 0 && c.groesse <= MAX_ANHANG)) return { ok: false, fehler: ['Das Bild ist zu groß (höchstens 25 MB).'] };
    if (a!.anhaenge.some(x => x.id === c.anhangId)) return [];
    return [{ typ: 'AnhangHinzugefuegt', tags: [tag.aufgabe(c.aufgabeId)], daten: { aufgabeId: c.aufgabeId, anhangId: c.anhangId, name: c.name.trim() || 'Bild', typ: c.typ, groesse: c.groesse } }];
  });
}

export function anhangEntfernen(es: EventStore, c: { aufgabeId: Id; anhangId: Id }): Ergebnis {
  return ctx(es, [tag.aufgabe(c.aufgabeId)], b => {
    const a = b.aufgaben.get(c.aufgabeId);
    const nicht = bearbeitbar(a);
    if (nicht) return { ok: false, fehler: [nicht] };
    if (!a!.anhaenge.some(x => x.id === c.anhangId)) return [];
    return [{ typ: 'AnhangEntfernt', tags: [tag.aufgabe(c.aufgabeId)], daten: { aufgabeId: c.aufgabeId, anhangId: c.anhangId } }];
  });
}

/** Manuelle Priorisierung: neuen Rang setzen (der Body berechnet ihn aus den Nachbarn) */
export function aufgabeEinsortieren(es: EventStore, c: { aufgabeId: Id; rang: number }): Ergebnis {
  return ctx(es, [tag.aufgabe(c.aufgabeId)], b => {
    const a = b.aufgaben.get(c.aufgabeId);
    if (!a || a.verworfen) return { ok: false, fehler: ['Aufgabe unbekannt.'] };
    if (!Number.isFinite(c.rang)) return { ok: false, fehler: ['Ungültiger Rang.'] };
    return [{ typ: 'AufgabeEinsortiert', tags: [tag.aufgabe(c.aufgabeId)], daten: { aufgabeId: c.aufgabeId, rang: c.rang } }];
  });
}

export { fehler };
