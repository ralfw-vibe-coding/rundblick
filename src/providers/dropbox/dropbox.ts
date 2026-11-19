// Dropbox-HTTP-API (v2) über ein übergebenes fetch – testbar ohne Netz.
// Endpunkte: api.dropboxapi.com (RPC), content.dropboxapi.com (Up-/Download), notify.dropboxapi.com (Longpoll).
import { DropboxAnmeldung, DropboxOffline, type Dropbox, type DropboxEintrag, type DropboxToken } from './interface';

export type DropboxKonfig = {
  appKey: string;
  /** Rücksprung-Adresse nach der Anmeldung (muss in der Dropbox App Console eingetragen sein) */
  rueckkehr: string;
  fetch: typeof fetch;
  jetzt: () => number;
  /** Ablage für Token und PKCE-Verifier (localStorage o. ä.) */
  ablage: { lesen(schluessel: string): string | null; schreiben(schluessel: string, wert: string | null): void };
  zufall?: (n: number) => Uint8Array;
};

const API = 'https://api.dropboxapi.com/2/';
const CONTENT = 'https://content.dropboxapi.com/2/';
const NOTIFY = 'https://notify.dropboxapi.com/2/';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const K_TOKEN = 'dropbox.token', K_VERIFIER = 'dropbox.verifier';

const base64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** Dropbox-API-Arg muss reines ASCII sein: alles darüber als \uXXXX */
export const apiArg = (o: unknown) => JSON.stringify(o).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

export async function pkceChallenge(verifier: string): Promise<string> {
  const h = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(h));
}

export function dropbox(k: DropboxKonfig): Dropbox {
  const zufall = k.zufall ?? (n => globalThis.crypto.getRandomValues(new Uint8Array(n)));
  const tokenLesen = (): DropboxToken | null => { const t = k.ablage.lesen(K_TOKEN); return t ? JSON.parse(t) as DropboxToken : null; };
  const tokenSchreiben = (t: DropboxToken | null) => k.ablage.schreiben(K_TOKEN, t ? JSON.stringify(t) : null);

  const holen = async (url: string, init: RequestInit): Promise<Response> => {
    try { return await k.fetch(url, init); }
    catch (e) { throw new DropboxOffline((e as Error).message || 'offline'); }
  };

  const tokenAnfrage = async (felder: Record<string, string>, alt?: DropboxToken): Promise<DropboxToken> => {
    const r = await holen(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...felder, client_id: k.appKey }).toString() });
    if (r.status === 400 || r.status === 401) { tokenSchreiben(null); throw new DropboxAnmeldung('Dropbox-Anmeldung abgelaufen – bitte neu verbinden'); }
    if (!r.ok) throw new Error(`Dropbox-Anmeldung: HTTP ${r.status}`);
    const j = await r.json() as { access_token: string; refresh_token?: string; expires_in: number };
    const t = { zugriff: j.access_token, erneuern: j.refresh_token ?? alt?.erneuern ?? '', ablauf: k.jetzt() + j.expires_in * 1000 };
    tokenSchreiben(t);
    return t;
  };

  const zugriff = async (erzwingen = false): Promise<string> => {
    const t = tokenLesen();
    if (!t) throw new DropboxAnmeldung('Nicht mit Dropbox verbunden');
    if (!erzwingen && t.ablauf - 60_000 > k.jetzt()) return t.zugriff;
    return (await tokenAnfrage({ grant_type: 'refresh_token', refresh_token: t.erneuern }, t)).zugriff;
  };

  /** Aufruf mit Token; bei 401 einmal erneuern und wiederholen */
  const mitToken = async (url: string, init: (token: string) => RequestInit): Promise<Response> => {
    let r = await holen(url, init(await zugriff()));
    if (r.status === 401) r = await holen(url, init(await zugriff(true)));
    if (r.status === 401) { tokenSchreiben(null); throw new DropboxAnmeldung('Dropbox-Anmeldung abgelaufen – bitte neu verbinden'); }
    return r;
  };

  const rpc = async <T>(endpunkt: string, arg: unknown): Promise<{ status: number; daten: T | null; fehler: string }> => {
    const r = await mitToken(API + endpunkt, token => ({ method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: arg === null ? 'null' : JSON.stringify(arg) }));
    if (r.ok) return { status: r.status, daten: await r.json() as T, fehler: '' };
    return { status: r.status, daten: null, fehler: await r.text() };
  };
  const pruefen = <T>(x: { status: number; daten: T | null; fehler: string }, was: string): T => {
    if (x.daten === null) throw new Error(`Dropbox (${was}): HTTP ${x.status} ${x.fehler.slice(0, 200)}`);
    return x.daten;
  };

  type Roh = { '.tag': string; name: string; path_display: string; rev?: string; size?: number };
  const eintraege = (e: Roh[]): DropboxEintrag[] => e.filter(x => x['.tag'] === 'file').map(x => ({ pfad: x.path_display, name: x.name, rev: x.rev!, groesse: x.size! }));

  return {
    angemeldet: () => tokenLesen() !== null,

    async anmeldeUrl() {
      const verifier = base64url(zufall(48));
      k.ablage.schreiben(K_VERIFIER, verifier);
      const p = new URLSearchParams({
        client_id: k.appKey, response_type: 'code', code_challenge: await pkceChallenge(verifier), code_challenge_method: 'S256',
        token_access_type: 'offline', redirect_uri: k.rueckkehr,
      });
      return `https://www.dropbox.com/oauth2/authorize?${p}`;
    },

    async anmeldungAbschliessen(code) {
      const verifier = k.ablage.lesen(K_VERIFIER);
      if (!verifier) throw new DropboxAnmeldung('Anmeldung wurde nicht auf diesem Gerät begonnen');
      k.ablage.schreiben(K_VERIFIER, null);
      await tokenAnfrage({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: k.rueckkehr });
    },

    async abmelden() {
      const t = tokenLesen();
      tokenSchreiben(null);
      if (t) { try { await holen(API + 'auth/token/revoke', { method: 'POST', headers: { Authorization: `Bearer ${t.zugriff}` } }); } catch { /* offline: Token ist lokal trotzdem weg */ } }
    },

    async konto() {
      const j = pruefen(await rpc<{ name: { given_name: string; display_name: string } }>('users/get_current_account', null), 'Konto');
      return { name: j.name.given_name || j.name.display_name };
    },

    auflisten: async function auflisten(ordner: string, cursor: string | null): Promise<{ eintraege: DropboxEintrag[]; cursor: string; mehr: boolean }> {
      type Antwort = { entries: Roh[]; cursor: string; has_more: boolean };
      const x = cursor
        ? await rpc<Antwort>('files/list_folder/continue', { cursor })
        : await rpc<Antwort>('files/list_folder', { path: ordner, recursive: false, include_deleted: false });
      // Ordner gibt es noch nicht (erster Start): leer, aber mit gültigem Cursor nach dem Anlegen
      if (!cursor && x.status === 409 && x.fehler.includes('not_found')) {
        pruefen(await rpc('files/create_folder_v2', { path: ordner, autorename: false }), 'Ordner anlegen');
        return auflisten(ordner, null);
      }
      const j = pruefen(x, 'Ordner lesen');
      return { eintraege: eintraege(j.entries), cursor: j.cursor, mehr: j.has_more };
    },

    async laden(pfad, ab = 0) {
      const r = await mitToken(CONTENT + 'files/download', token => ({
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': apiArg({ path: pfad }), ...(ab > 0 ? { Range: `bytes=${ab}-` } : {}) },
      }));
      if (r.status === 409) return null;
      if (r.status === 416) return { daten: new Uint8Array(), rev: '' }; // nichts Neues ab dieser Stelle
      if (!r.ok) throw new Error(`Dropbox (Laden ${pfad}): HTTP ${r.status}`);
      const meta = JSON.parse(r.headers.get('Dropbox-API-Result') ?? '{}') as { rev?: string };
      return { daten: new Uint8Array(await r.arrayBuffer()), rev: meta.rev ?? '' };
    },

    async hochladen(pfad, daten, rev, ueberschreiben = false) {
      const mode = ueberschreiben ? 'overwrite' : rev ? { '.tag': 'update', update: rev } : 'add';
      const r = await mitToken(CONTENT + 'files/upload', token => ({
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': apiArg({ path: pfad, mode, autorename: false, mute: true }) },
        body: daten as BodyInit,
      }));
      if (r.status === 409) return { ok: false, konflikt: true };
      if (!r.ok) throw new Error(`Dropbox (Hochladen ${pfad}): HTTP ${r.status}`);
      const j = await r.json() as { rev: string };
      return { ok: true, rev: j.rev };
    },

    async loeschen(pfad) {
      const x = await rpc('files/delete_v2', { path: pfad });
      if (x.status === 409 && x.fehler.includes('not_found')) return;
      pruefen(x, 'Löschen');
    },

    async warten(cursor, sekunden = 120) {
      const r = await holen(NOTIFY + 'files/list_folder/longpoll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cursor, timeout: sekunden }) });
      if (!r.ok) throw new Error(`Dropbox (Warten): HTTP ${r.status}`);
      const j = await r.json() as { changes: boolean; backoff?: number };
      return { aenderungen: j.changes, pause: j.backoff ?? 0 };
    },
  };
}
