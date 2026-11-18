// Body: koordiniert jede Anfrage. Holt Zeit und IDs von Providern, ruft die Domain auf,
// führt eigene und externe Kalenderdaten zusammen und meldet Änderungen an die Clients.
import { plusTage } from '../basis/datum';
import type { DomainInterface, Ergebnis } from '../domain/interface';
import type { Anhangspeicher } from '../providers/anhaenge/interface';
import type { Einstellungen } from '../providers/einstellungen/interface';
import type { IdGenerator } from '../providers/ids/interface';
import type { KalenderCache, Kalenderquelle } from '../providers/kalender/interface';
import type { Uhr } from '../providers/uhr/interface';
import type { KalenderEinstellung, KalenderZugriff } from '../schema/extern';
import type { Datum } from '../schema/werte';
import { board, liste, zeile } from './abfragen/aufgaben';
import { logbuch, tagsAusText } from './abfragen/logbuch';
import { buchungDto, KALENDER_STANDARD, zeitraum } from './abfragen/zeitraum';
import type { Bereich, Body, CommandStatus, EinstellungenDto, ErfassungVorschau, Layout, StatusInfo } from './interface';
import { parseErfassung } from './schnellerfassung/parse';

export type BodyAbhaengigkeiten = {
  domain: DomainInterface;
  uhr: Uhr;
  ids: IdGenerator;
  einstellungen: Einstellungen;
  kalender: Kalenderquelle;
  cache: KalenderCache;
  anhaenge: Anhangspeicher;
  info: { datenordner: string; geraet: string };
};

const status = (e: Ergebnis, ids?: Record<string, string>): CommandStatus => (e.ok ? (ids ? { ok: true, ids } : { ok: true }) : e);
/** bisheriges festes Fenster des Kalenders */
export const TAGESZEIT_STANDARD = { von: 7, bis: 21 };
const VORLAUF = 35, NACHLAUF = 200;

export class RundblickBody implements Body {
  private abos = new Set<(b: Bereich[]) => void>();
  private zugriffStand: KalenderZugriff = 'unbestimmt';
  private laedt = false;

  constructor(private readonly x: BodyAbhaengigkeiten) {
    x.domain.beiAenderung(() => this.melde(['aufgaben', 'board', 'kalender']));
    x.kalender.beiAenderung(() => { void this.synchronisieren(); });
  }

  /** Beim Start: Standardspalten anlegen (nur beim allerersten Mal) */
  einrichten(): void { this.x.domain.standardspaltenEinrichten(); }

  // ---------------- Commands: Aufgaben ----------------
  async aufgabeErfassen(c: Parameters<Body['aufgabeErfassen']>[0]): Promise<CommandStatus> {
    const aufgabeId = this.x.ids.neu();
    const buchungId = c.buchung ? this.x.ids.neu() : undefined;
    const { buchung, ...felder } = c;
    const e = this.x.domain.aufgabeErfassen({ aufgabeId, felder, buchung: buchung && { ...buchung, buchungId: buchungId! } });
    return status(e, buchungId ? { aufgabeId, buchungId } : { aufgabeId });
  }

  async schnellErfassen(c: { text: string }): Promise<CommandStatus> {
    const p = this.parse(c.text);
    if (!p.titel) return { ok: false, fehler: ['Titel fehlt.'] };
    if (p.fehler.length) return { ok: false, fehler: [`Nicht verstanden: ${p.fehler.join(', ')}`] };
    if (p.nurBuchung) return this.buchungEintragen({ titel: p.titel, ...p.buchung! });
    return this.aufgabeErfassen({
      titel: p.titel, tags: p.tags, verantwortlich: p.verantwortlich, ort: p.ort, frist: p.frist,
      wiedervorlage: p.wiedervorlage, status: p.status, ...(p.buchung ? { buchung: p.buchung } : {}),
    });
  }

  async aufgabeAendern(c: Parameters<Body['aufgabeAendern']>[0]) { return status(this.x.domain.aufgabeAendern(c)); }
  async statusSetzen(c: Parameters<Body['statusSetzen']>[0]) { return status(this.x.domain.statusSetzen(c)); }
  async aufgabeAbschliessen(c: { aufgabeId: string }) { return status(this.x.domain.aufgabeAbschliessen(c)); }
  async aufgabeWiedereroeffnen(c: { aufgabeId: string }) { return status(this.x.domain.aufgabeWiedereroeffnen(c)); }
  async aufgabeVerwerfen(c: { aufgabeId: string }) { return status(this.x.domain.aufgabeVerwerfen(c)); }
  async aufgabeArchivieren(c: { aufgabeId: string }) { return status(this.x.domain.aufgabeArchivieren(c)); }
  async aufgabeAusArchivHolen(c: { aufgabeId: string }) { return status(this.x.domain.aufgabeAusArchivHolen(c)); }

  async aufgabeVerschieben(c: { aufgabeId: string; oben: string | null; unten: string | null }): Promise<CommandStatus> {
    const rang = (id: string | null) => (id ? this.x.domain.aufgabe(id)?.rang ?? null : null);
    const o = rang(c.oben), u = rang(c.unten);
    const neu = o !== null && u !== null ? (o + u) / 2 : o !== null ? o + 1 : u !== null ? u - 1 : null;
    if (neu === null) return { ok: true };
    return status(this.x.domain.aufgabeEinsortieren({ aufgabeId: c.aufgabeId, rang: neu }));
  }

  // ---------------- Commands: Anhänge ----------------
  async anhangHinzufuegen(c: { aufgabeId: string; name: string; typ: string; daten: string }): Promise<CommandStatus> {
    let bytes: Uint8Array;
    try { bytes = ausBase64(c.daten); } catch { return { ok: false, fehler: ['Die Bilddaten sind beschädigt.'] }; }
    const anhangId = this.x.ids.neu();
    this.x.anhaenge.speichern(anhangId, bytes);
    const e = this.x.domain.anhangHinzufuegen({ aufgabeId: c.aufgabeId, anhangId, name: c.name, typ: c.typ, groesse: bytes.length });
    if (!e.ok) this.x.anhaenge.entfernen(anhangId);
    return status(e, { anhangId });
  }
  async anhangEntfernen(c: { aufgabeId: string; anhangId: string }): Promise<CommandStatus> {
    const e = this.x.domain.anhangEntfernen(c);
    if (e.ok) this.x.anhaenge.entfernen(c.anhangId);
    return status(e);
  }

  // ---------------- Commands: Notizen (Logbuch) ----------------
  async notizErfassen(c: { text: string; tags?: string[]; datum?: string }): Promise<CommandStatus> {
    const notizId = this.x.ids.neu();
    const t = c.tags === undefined ? tagsAusText(c.text) : { text: c.text, tags: c.tags };
    return status(this.x.domain.notizErfassen({ notizId, text: t.text, tags: t.tags, datum: c.datum ?? this.x.uhr.heute() }), { notizId });
  }
  async notizAendern(c: { notizId: string; text?: string; tags?: string[]; datum?: string }): Promise<CommandStatus> {
    const { notizId, ...aenderungen } = c;
    return status(this.x.domain.notizAendern({ notizId, aenderungen }));
  }
  async notizVerwerfen(c: { notizId: string }): Promise<CommandStatus> {
    const n = this.x.domain.notiz(c.notizId);
    const e = this.x.domain.notizVerwerfen(c);
    if (e.ok && n) n.anhaenge.forEach(a => this.x.anhaenge.entfernen(a.id));
    return status(e);
  }
  async notizAnhangHinzufuegen(c: { notizId: string; name: string; typ: string; daten: string }): Promise<CommandStatus> {
    let bytes: Uint8Array;
    try { bytes = ausBase64(c.daten); } catch { return { ok: false, fehler: ['Die Bilddaten sind beschädigt.'] }; }
    const anhangId = this.x.ids.neu();
    this.x.anhaenge.speichern(anhangId, bytes);
    const e = this.x.domain.notizAnhangHinzufuegen({ notizId: c.notizId, anhangId, name: c.name, typ: c.typ, groesse: bytes.length });
    if (!e.ok) this.x.anhaenge.entfernen(anhangId);
    return status(e, { anhangId });
  }
  async notizAnhangEntfernen(c: { notizId: string; anhangId: string }): Promise<CommandStatus> {
    const e = this.x.domain.notizAnhangEntfernen(c);
    if (e.ok) this.x.anhaenge.entfernen(c.anhangId);
    return status(e);
  }
  async aufgabeAusNotiz(c: { notizId: string }): Promise<CommandStatus> {
    const aufgabeId = this.x.ids.neu();
    return status(this.x.domain.aufgabeAusNotiz({ notizId: c.notizId, aufgabeId }), { aufgabeId });
  }

  // ---------------- Commands: Buchungen ----------------
  async buchungAnlegen(c: Parameters<Body['buchungAnlegen']>[0]) {
    const buchungId = this.x.ids.neu();
    return status(this.x.domain.buchungAnlegen({ ...c, buchungId }), { buchungId });
  }
  async buchungEintragen(c: Parameters<Body['buchungEintragen']>[0]) {
    const buchungId = this.x.ids.neu();
    return status(this.x.domain.buchungEintragen({ ...c, buchungId }), { buchungId });
  }
  async buchungAendern(c: Parameters<Body['buchungAendern']>[0]) {
    const { buchungId, ...aenderungen } = c;
    return status(this.x.domain.buchungAendern({ buchungId, aenderungen }));
  }
  async buchungStornieren(c: { buchungId: string }) { return status(this.x.domain.buchungStornieren(c)); }
  async aufgabeAusBuchung(c: Parameters<Body['aufgabeAusBuchung']>[0]) {
    const aufgabeId = this.x.ids.neu();
    return status(this.x.domain.aufgabeAusBuchung({ ...c, aufgabeId }), { aufgabeId });
  }

  // ---------------- Commands: Board & Planung ----------------
  async spalteAnlegen(c: Parameters<Body['spalteAnlegen']>[0]) {
    const statusId = this.x.ids.neu();
    return status(this.x.domain.spalteAnlegen({ ...c, statusId }), { statusId });
  }
  async spalteUmbenennen(c: Parameters<Body['spalteUmbenennen']>[0]) { return status(this.x.domain.spalteUmbenennen(c)); }
  async kategorieUmbenennen(c: Parameters<Body['kategorieUmbenennen']>[0]) { return status(this.x.domain.kategorieUmbenennen(c)); }
  async spaltenSortieren(c: Parameters<Body['spaltenSortieren']>[0]) { return status(this.x.domain.spaltenSortieren(c)); }
  async spalteEntfernen(c: Parameters<Body['spalteEntfernen']>[0]) { return status(this.x.domain.spalteEntfernen(c)); }
  async tageskapazitaetFestlegen(c: Parameters<Body['tageskapazitaetFestlegen']>[0]) { return status(this.x.domain.tageskapazitaetFestlegen(c)); }
  async standarddauerFestlegen(c: Parameters<Body['standarddauerFestlegen']>[0]) { return status(this.x.domain.standarddauerFestlegen(c)); }

  /** Sichtbare Tageszeit im Kalender – Darstellung pro Gerät, deshalb in den Einstellungen statt als Event */
  async tageszeitFestlegen(c: { von: number; bis: number }): Promise<CommandStatus> {
    const ganz = (x: number) => Number.isInteger(x) && x >= 0 && x <= 24;
    if (!ganz(c.von) || !ganz(c.bis) || c.bis - c.von < 2) return { ok: false, fehler: ['Tageszeit: volle Stunden zwischen 0 und 24, mindestens 2 Stunden.'] };
    this.x.einstellungen.schreiben('tageszeit', { von: c.von, bis: c.bis });
    this.melde(['kalender', 'einstellungen']);
    return { ok: true };
  }

  // ---------------- Commands: externe Kalender & Gerät ----------------
  async kalenderEinstellen(c: { kalenderId: string; sichtbar?: boolean; belegt?: boolean }): Promise<CommandStatus> {
    const alle = this.kalenderEinstellungen();
    const alt = alle[c.kalenderId] ?? KALENDER_STANDARD;
    alle[c.kalenderId] = { sichtbar: c.sichtbar ?? alt.sichtbar, belegt: c.belegt ?? alt.belegt };
    this.x.einstellungen.schreiben('kalender', alle);
    this.melde(['kalender', 'einstellungen']);
    return { ok: true };
  }

  async kalenderZugriffAnfragen(): Promise<CommandStatus> {
    this.zugriffStand = await this.x.kalender.zugriff();
    this.melde(['einstellungen']);
    if (this.zugriffStand !== 'erlaubt') return { ok: false, fehler: [this.zugriffText()] };
    return this.synchronisieren();
  }

  async synchronisieren(): Promise<CommandStatus> {
    const heute = this.x.uhr.heute();
    return this.laden(plusTage(heute, -VORLAUF), plusTage(heute, NACHLAUF));
  }

  async layoutSpeichern(c: { layout: Layout }): Promise<CommandStatus> {
    this.x.einstellungen.schreiben('layout', c.layout);
    return { ok: true };
  }

  // ---------------- Queries ----------------
  async liste(q: { filter?: string }) {
    const d = this.x.domain;
    return liste(d.aufgaben(), d.buchungen(), new Map(d.spalten().map(s => [s.id, s])), this.x.uhr.heute(), q.filter ?? '');
  }

  async board() {
    const d = this.x.domain;
    return board(d.aufgaben(), d.buchungen(), d.spalten(), this.x.uhr.heute(), d.kategorien());
  }

  async zeitraum(q: { von: Datum; bis: Datum }) {
    const d = this.x.domain, st = this.x.cache.stand();
    // Außerhalb des zwischengespeicherten Fensters im Hintergrund nachladen (höchstens ±2 Jahre um heute)
    const heute = this.x.uhr.heute(), min = plusTage(heute, -730), max = plusTage(heute, 730);
    const von = q.von < min ? min : q.von, bis = q.bis > max ? max : q.bis;
    if (this.zugriffStand === 'erlaubt' && von <= bis && (!st.von || !st.bis || von < st.von || bis > st.bis)) {
      void this.laden(st.von && st.von < von ? st.von : von, st.bis && st.bis > bis ? st.bis : bis);
    }
    return zeitraum({
      von: q.von, bis: q.bis, heute: this.x.uhr.heute(), jetzt: this.x.uhr.minuteDesTages(),
      aufgaben: d.aufgaben(), buchungen: d.buchungen(q.von, q.bis), planung: d.planung(),
      extern: this.x.cache.termine(q.von, q.bis), kalender: this.x.cache.kalender(), kalenderEinstellungen: this.kalenderEinstellungen(),
    });
  }

  async aufgabe(q: { aufgabeId: string }) {
    const d = this.x.domain, a = d.aufgabe(q.aufgabeId);
    if (!a) return null;
    const amap = new Map(d.aufgaben().map(x => [x.id, x]));
    return {
      ...zeile(a, d.buchungen(), new Map(d.spalten().map(s => [s.id, s])), this.x.uhr.heute()),
      beschreibung: a.beschreibung,
      buchungsliste: d.buchungenDerAufgabe(a.id).map(b => buchungDto(b, amap)),
      anhangliste: a.anhaenge.map((x, i) => ({ ...x, nr: i + 1 })),
    };
  }

  async buchung(q: { buchungId: string }) {
    const d = this.x.domain, b = d.buchung(q.buchungId);
    if (!b) return null;
    const amap = new Map(d.aufgaben().map(x => [x.id, x]));
    const tag = (await this.zeitraum({ von: b.datum, bis: b.datum })).tage[0]!;
    return { ...buchungDto(b, amap), tag: tag.auslastung };
  }

  async einstellungen(): Promise<EinstellungenDto> {
    const d = this.x.domain, p = d.planung(), e = this.kalenderEinstellungen();
    return {
      kategorien: d.kategorien(),
      spalten: d.spalten().map(s => ({ id: s.id, name: s.name, kategorie: s.kategorie })),
      kapazitaet: p.kapazitaet, standarddauer: p.standarddauer,
      tageszeit: this.x.einstellungen.lesen('tageszeit', TAGESZEIT_STANDARD),
      kalender: this.x.cache.kalender().map(k => ({ ...k, ...(e[k.id] ?? KALENDER_STANDARD) })),
      zugriff: this.zugriffStand, letzteSynchronisation: this.x.cache.stand().zuletzt,
      datenordner: this.x.info.datenordner, geraet: this.x.info.geraet,
    };
  }

  async erfassungVorschau(q: { text: string }): Promise<ErfassungVorschau> {
    const p = this.parse(q.text);
    const s = p.status ? this.x.domain.spalten().find(x => x.id === p.status) : undefined;
    const st: StatusInfo | null = s ? { id: s.id, name: s.name, kategorie: s.kategorie } : null;
    return { ...p, status: st };
  }

  async vorschlaege(q: { art: 'tag' | 'person' | 'ort'; praefix: string }): Promise<string[]> {
    const zaehler = new Map<string, number>();
    for (const a of this.x.domain.aufgaben()) {
      const werte = q.art === 'tag' ? a.tags : q.art === 'person' ? [a.verantwortlich] : [a.ort];
      werte.filter(Boolean).forEach(w => zaehler.set(w, (zaehler.get(w) ?? 0) + 1));
    }
    if (q.art === 'tag') for (const n of this.x.domain.notizen()) n.tags.forEach(w => zaehler.set(w, (zaehler.get(w) ?? 0) + 1));
    const p = q.praefix.toLowerCase();
    return [...zaehler.entries()].filter(([w]) => w.toLowerCase().startsWith(p)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de')).map(([w]) => w).slice(0, 12);
  }

  async logbuch(q: { bis?: string | null; tage?: number; filter?: string }) {
    return logbuch({ aufgaben: this.x.domain.aufgaben(), notizen: this.x.domain.notizen(), heute: this.x.uhr.heute(), bis: q.bis ?? null, tage: q.tage, filter: q.filter });
  }

  async notiz(q: { notizId: string }) {
    const n = this.x.domain.notiz(q.notizId);
    return n ? { id: n.id, text: n.text, tags: n.tags, datum: n.datum, erfasst: n.erfasst, anhangliste: n.anhaenge.map((a, i) => ({ ...a, nr: i + 1 })) } : null;
  }

  async anhang(q: { anhangId: string }) {
    const info = [...this.x.domain.aufgaben().flatMap(a => a.anhaenge), ...this.x.domain.notizen().flatMap(n => n.anhaenge)].find(x => x.id === q.anhangId);
    const bytes = info ? this.x.anhaenge.lesen(q.anhangId) : null;
    return info && bytes ? { name: info.name, typ: info.typ, url: `data:${info.typ};base64,${inBase64(bytes)}` } : null;
  }

  async heute() { return { datum: this.x.uhr.heute(), minute: this.x.uhr.minuteDesTages() }; }

  async layout(): Promise<Layout> { return this.x.einstellungen.lesen<Layout>('layout', null); }

  beiAenderung(cb: (bereiche: Bereich[]) => void): () => void {
    this.abos.add(cb);
    return () => { this.abos.delete(cb); };
  }

  /** Für den Tageswechsel (Zeitgeber in der Composition Root) */
  tageswechsel(): void { this.melde(['aufgaben', 'board', 'kalender']); }

  // ---------------- intern ----------------
  private parse(text: string) {
    const d = this.x.domain;
    return parseErfassung(text, this.x.uhr.heute(), d.spalten(), d.planung().standarddauer);
  }

  private kalenderEinstellungen(): Record<string, KalenderEinstellung> {
    return { ...this.x.einstellungen.lesen<Record<string, KalenderEinstellung>>('kalender', {}) };
  }

  private async laden(von: Datum, bis: Datum): Promise<CommandStatus> {
    if (this.laedt) return { ok: true };
    this.laedt = true;
    try {
      this.zugriffStand = await this.x.kalender.zugriff();
      if (this.zugriffStand !== 'erlaubt') { this.melde(['einstellungen']); return { ok: false, fehler: [this.zugriffText()] }; }
      const [kalender, termine] = await Promise.all([this.x.kalender.kalender(), this.x.kalender.termine(von, bis)]);
      this.x.cache.ersetzen(von, bis, kalender, termine);
      this.melde(['kalender', 'einstellungen']);
      return { ok: true };
    } catch (e) {
      return { ok: false, fehler: [`Kalender konnten nicht gelesen werden: ${(e as Error).message}`] };
    } finally {
      this.laedt = false;
    }
  }

  private zugriffText(): string {
    return {
      erlaubt: '', unbestimmt: 'Kalenderzugriff noch nicht erteilt.',
      verweigert: 'Kalenderzugriff verweigert – in den Systemeinstellungen › Datenschutz › Kalender erlauben.',
      nichtVerfuegbar: 'Kalender-Helfer nicht verfügbar (npm run build:helfer).',
    }[this.zugriffStand];
  }

  private melde(b: Bereich[]): void { this.abos.forEach(cb => cb(b)); }
}

// Base64 ohne Node-APIs (der Body läuft plattformunabhängig)
function ausBase64(s: string): Uint8Array {
  const roh = atob(s.replace(/^data:[^,]*,/, ''));
  const b = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) b[i] = roh.charCodeAt(i);
  return b;
}
function inBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
