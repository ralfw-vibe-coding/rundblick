import { describe, expect, it } from 'vitest';
import { apiArg, dropbox, pkceChallenge } from './dropbox';
import { DropboxAnmeldung, DropboxOffline } from './interface';

type Anfrage = { url: string; methode: string; kopf: Record<string, string>; koerper: string };
type Antwort = { status?: number; json?: unknown; text?: string; bytes?: Uint8Array; kopf?: Record<string, string> } | 'offline';

/** fetch-Attrappe: beantwortet Anfragen der Reihe nach aus einer Liste je URL-Ende */
function netz(regeln: Record<string, Antwort[]>) {
  const anfragen: Anfrage[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const kopf = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const koerper = init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : String(init.body ?? '');
    anfragen.push({ url, methode: init.method ?? 'GET', kopf, koerper });
    const schluessel = Object.keys(regeln).find(k => url.endsWith(k));
    const a = schluessel ? regeln[schluessel]!.shift() : undefined;
    if (!a) throw new Error(`unerwartet: ${url}`);
    if (a === 'offline') throw new TypeError('Failed to fetch');
    const daten = a.bytes ?? (a.json !== undefined ? JSON.stringify(a.json) : a.text ?? '');
    return new Response(daten as BodyInit, { status: a.status ?? 200, headers: a.kopf ?? {} });
  }) as unknown as typeof fetch;
  return { f, anfragen };
}

function speicher(start: Record<string, string> = {}) {
  const m = new Map(Object.entries(start));
  return { m, lesen: (k: string) => m.get(k) ?? null, schreiben: (k: string, w: string | null) => { if (w === null) m.delete(k); else m.set(k, w); } };
}

const JETZT = 1_000_000;
const token = (ablauf = JETZT + 3_600_000) => JSON.stringify({ zugriff: 'A1', erneuern: 'R1', ablauf });
const konto = (regeln: Record<string, Antwort[]>, ablage = speicher({ 'dropbox.token': token() })) => {
  const n = netz(regeln);
  return { ...n, ablage, db: dropbox({ appKey: 'KEY', rueckkehr: 'https://app/', fetch: n.f, jetzt: () => JETZT, ablage, zufall: x => new Uint8Array(x).fill(7) }) };
};

describe('Dropbox-Provider', () => {
  it('PKCE: Anmelde-URL mit S256-Challenge; Code wird mit Verifier eingelöst, Token gemerkt', async () => {
    const { db, ablage, anfragen } = konto({ 'oauth2/token': [{ json: { access_token: 'A', refresh_token: 'R', expires_in: 14400 } }] }, speicher());
    expect(db.angemeldet()).toBe(false);
    const url = new URL(await db.anmeldeUrl());
    const verifier = ablage.m.get('dropbox.verifier')!;
    expect(url.searchParams.get('code_challenge')).toBe(await pkceChallenge(verifier));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('token_access_type')).toBe('offline');
    expect(url.searchParams.get('client_id')).toBe('KEY');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app/');
    await db.anmeldungAbschliessen('CODE');
    const form = new URLSearchParams(anfragen[0]!.koerper);
    expect(Object.fromEntries(form)).toEqual({ grant_type: 'authorization_code', code: 'CODE', code_verifier: verifier, redirect_uri: 'https://app/', client_id: 'KEY' });
    expect(db.angemeldet()).toBe(true);
    expect(JSON.parse(ablage.m.get('dropbox.token')!)).toEqual({ zugriff: 'A', erneuern: 'R', ablauf: JETZT + 14400_000 });
    expect(ablage.m.has('dropbox.verifier')).toBe(false);
  });

  it('PKCE-Challenge nach RFC 7636 (Beispielwerte)', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('Anmeldung abschließen ohne Beginn auf diesem Gerät schlägt fehl', async () => {
    const { db } = konto({}, speicher());
    await expect(db.anmeldungAbschliessen('X')).rejects.toBeInstanceOf(DropboxAnmeldung);
  });

  it('erneuert ein ablaufendes Token vor dem Aufruf und behält das Refresh-Token', async () => {
    const { db, anfragen, ablage } = konto({
      'oauth2/token': [{ json: { access_token: 'A2', expires_in: 14400 } }],
      'users/get_current_account': [{ json: { name: { given_name: 'Ralf', display_name: 'Ralf W' } } }],
    }, speicher({ 'dropbox.token': token(JETZT + 1000) }));
    expect(await db.konto()).toEqual({ name: 'Ralf' });
    expect(new URLSearchParams(anfragen[0]!.koerper).get('grant_type')).toBe('refresh_token');
    expect(anfragen[1]!.kopf.Authorization).toBe('Bearer A2');
    expect(JSON.parse(ablage.m.get('dropbox.token')!).erneuern).toBe('R1');
  });

  it('401 → einmal erneuern und wiederholen; scheitert auch das, ist die Anmeldung weg', async () => {
    const ok = konto({
      'users/get_current_account': [{ status: 401 }, { json: { name: { given_name: '', display_name: 'Anzeige' } } }],
      'oauth2/token': [{ json: { access_token: 'A3', expires_in: 100 } }],
    });
    expect(await ok.db.konto()).toEqual({ name: 'Anzeige' });

    const weg = konto({ 'users/get_current_account': [{ status: 401 }, { status: 401 }], 'oauth2/token': [{ json: { access_token: 'A4', expires_in: 100 } }] });
    await expect(weg.db.konto()).rejects.toBeInstanceOf(DropboxAnmeldung);
    expect(weg.db.angemeldet()).toBe(false);

    const widerrufen = konto({ 'oauth2/token': [{ status: 400, text: 'invalid_grant' }] }, speicher({ 'dropbox.token': token(0) }));
    await expect(widerrufen.db.konto()).rejects.toBeInstanceOf(DropboxAnmeldung);
    expect(widerrufen.db.angemeldet()).toBe(false);

    const kaputt = konto({ 'oauth2/token': [{ status: 500 }] }, speicher({ 'dropbox.token': token(0) }));
    await expect(kaputt.db.konto()).rejects.toThrow('HTTP 500');

    const ohne = konto({}, speicher());
    await expect(ohne.db.konto()).rejects.toBeInstanceOf(DropboxAnmeldung);
  });

  it('offline → DropboxOffline', async () => {
    const { db } = konto({ 'users/get_current_account': ['offline'] });
    await expect(db.konto()).rejects.toBeInstanceOf(DropboxOffline);
  });

  it('auflisten: nur Dateien, mit Cursor weiter; fehlenden Ordner anlegen', async () => {
    const { db, anfragen } = konto({
      'files/list_folder': [
        { status: 409, text: '{"error_summary":"path/not_found/"}' },
        { json: { entries: [{ '.tag': 'file', name: 'mac.jsonl', path_display: '/events/mac.jsonl', rev: 'r1', size: 10 }, { '.tag': 'folder', name: 'x', path_display: '/events/x' }], cursor: 'C1', has_more: true } },
      ],
      'files/create_folder_v2': [{ json: {} }],
      'files/list_folder/continue': [{ json: { entries: [], cursor: 'C2', has_more: false } }],
    });
    expect(await db.auflisten('/events', null)).toEqual({ eintraege: [{ pfad: '/events/mac.jsonl', name: 'mac.jsonl', rev: 'r1', groesse: 10 }], cursor: 'C1', mehr: true });
    expect(JSON.parse(anfragen[0]!.koerper)).toEqual({ path: '/events', recursive: false, include_deleted: false });
    expect(await db.auflisten('/events', 'C1')).toEqual({ eintraege: [], cursor: 'C2', mehr: false });
    expect(JSON.parse(anfragen.at(-1)!.koerper)).toEqual({ cursor: 'C1' });
  });

  it('auflisten: andere Fehler werden gemeldet', async () => {
    const { db } = konto({ 'files/list_folder': [{ status: 500, text: 'kaputt' }] });
    await expect(db.auflisten('/events', null)).rejects.toThrow('Ordner lesen');
  });

  it('laden: ganz oder ab Byte (Range); fehlt → null; nichts Neues (416) → leer', async () => {
    const { db, anfragen } = konto({
      'files/download': [
        { bytes: new TextEncoder().encode('abc'), kopf: { 'Dropbox-API-Result': '{"rev":"r9"}' } },
        { bytes: new TextEncoder().encode('c') },
        { status: 409, text: 'path/not_found' },
        { status: 416 },
        { status: 500 },
      ],
    });
    const ganz = await db.laden('/events/mäc.jsonl');
    expect(new TextDecoder().decode(ganz!.daten)).toBe('abc');
    expect(ganz!.rev).toBe('r9');
    expect(anfragen[0]!.kopf['Dropbox-API-Arg']).toBe('{"path":"/events/m\\u00e4c.jsonl"}');
    expect(anfragen[0]!.kopf.Range).toBeUndefined();
    expect((await db.laden('/events/x', 2))!.rev).toBe('');
    expect(anfragen[1]!.kopf.Range).toBe('bytes=2-');
    expect(await db.laden('/events/fehlt')).toBeNull();
    expect((await db.laden('/events/x', 3))!.daten.length).toBe(0);
    await expect(db.laden('/events/x')).rejects.toThrow('HTTP 500');
  });

  it('hochladen: neu (add), mit Revision (update), überschreiben; Konflikt bei 409', async () => {
    const { db, anfragen } = konto({ 'files/upload': [{ json: { rev: 'r1' } }, { json: { rev: 'r2' } }, { status: 409 }, { json: { rev: 'r3' } }, { status: 503 }] });
    const d = new TextEncoder().encode('x');
    expect(await db.hochladen('/events/a.jsonl', d, null)).toEqual({ ok: true, rev: 'r1' });
    expect(JSON.parse(anfragen[0]!.kopf['Dropbox-API-Arg']!).mode).toBe('add');
    expect(await db.hochladen('/events/a.jsonl', d, 'r1')).toEqual({ ok: true, rev: 'r2' });
    expect(JSON.parse(anfragen[1]!.kopf['Dropbox-API-Arg']!).mode).toEqual({ '.tag': 'update', update: 'r1' });
    expect(await db.hochladen('/events/a.jsonl', d, 'r1')).toEqual({ ok: false, konflikt: true });
    expect(await db.hochladen('/anhaenge/b', d, null, true)).toEqual({ ok: true, rev: 'r3' });
    expect(JSON.parse(anfragen[3]!.kopf['Dropbox-API-Arg']!).mode).toBe('overwrite');
    await expect(db.hochladen('/x', d, null)).rejects.toThrow('HTTP 503');
  });

  it('löschen: fehlt schon → ok; andere Fehler melden', async () => {
    const { db } = konto({ 'files/delete_v2': [{ json: {} }, { status: 409, text: 'path_lookup/not_found/' }, { status: 409, text: 'other' }] });
    await db.loeschen('/anhaenge/a');
    await db.loeschen('/anhaenge/a');
    await expect(db.loeschen('/anhaenge/a')).rejects.toThrow('Löschen');
  });

  it('Longpoll ohne Token mit Pause; Fehler melden', async () => {
    const { db, anfragen } = konto({ 'files/list_folder/longpoll': [{ json: { changes: true, backoff: 5 } }, { json: { changes: false } }, { status: 400 }] });
    expect(await db.warten('C1', 30)).toEqual({ aenderungen: true, pause: 5 });
    expect(anfragen[0]!.kopf.Authorization).toBeUndefined();
    expect(JSON.parse(anfragen[0]!.koerper)).toEqual({ cursor: 'C1', timeout: 30 });
    expect(await db.warten('C1')).toEqual({ aenderungen: false, pause: 0 });
    await expect(db.warten('C1')).rejects.toThrow('Warten');
  });

  it('abmelden: Token weg, Widerruf versucht (auch offline kein Fehler)', async () => {
    const a = konto({ 'auth/token/revoke': [{ json: null }] });
    await a.db.abmelden();
    expect(a.db.angemeldet()).toBe(false);
    expect(a.anfragen[0]!.kopf.Authorization).toBe('Bearer A1');
    const b = konto({ 'auth/token/revoke': ['offline'] });
    await b.db.abmelden();
    expect(b.db.angemeldet()).toBe(false);
    const c = konto({}, speicher());
    await c.db.abmelden();
  });

  it('apiArg maskiert Nicht-ASCII', () => {
    expect(apiArg({ p: 'ä€' })).toBe('{"p":"\\u00e4\\u20ac"}');
  });
});
