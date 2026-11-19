// Composition Root der Phone App (PWA): Browser-Provider → Domain → Body → Oberfläche.
// Offline-first: alle Daten lokal (IndexedDB), Abgleich direkt mit der Dropbox (App-Ordner „Apps/Rundblick“),
// kein Server. Die Desktop-App ist führend – hier wird nichts eingerichtet (keine Standardspalten o. ä.).
import { RundblickBody } from '../body/body';
import { phoneStarten, type Pwa } from '../client/phone/app';
import { Domain } from '../domain/domain';
import type { Abgleich } from '../providers/abgleich/interface';
import { FernAnhaenge, type AnhangFern } from '../providers/anhaenge/fern';
import { dropbox } from '../providers/dropbox/dropbox';
import { DropboxAnmeldung, DropboxOffline, type Dropbox } from '../providers/dropbox/interface';
import { lokaleEinstellungen } from '../providers/einstellungen/lokal';
import { FernEventStore, OfflineFehler, type Fernablage } from '../providers/eventstore/fern';
import { zuNeueAnzahl } from '../providers/eventstore/format';
import { ulidGenerator } from '../providers/ids/ulid';
import { ohneKalender, speicherKalenderCache } from '../providers/kalender/ohne';
import { systemUhr } from '../providers/uhr/system';
import { anhangSpeicher, datenbankLoeschen, datenbankOeffnen, eventSpeicher } from './idb';

declare const __VERSION__: string;

/** Öffentlicher App-Key der Dropbox-App „Rundblick“ (PKCE, kein Secret) */
const APP_KEY = 'npwte2lly4p0gdj';
const RUECKKEHR = location.origin + '/';

const offline = <T>(f: () => Promise<T>): Promise<T> => f().catch((e: unknown) => { throw e instanceof DropboxOffline ? new OfflineFehler(e.message) : e; });
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

function geraetVorschlag(name: string): string {
  const ua = navigator.userAgent;
  const art = /iPhone/.test(ua) ? 'iphone' : /iPad/.test(ua) ? 'ipad' : /Android/.test(ua) ? 'android' : 'web';
  return `${art}-${name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '') || 'ich'}`;
}

function eventAblage(db: Dropbox): Fernablage {
  return {
    auflisten: c => offline(async () => { const r = await db.auflisten('/events', c); return { dateien: r.eintraege.map(e => ({ name: e.name, rev: e.rev, groesse: e.groesse })), cursor: r.cursor, mehr: r.mehr }; }),
    lesen: (name, ab) => offline(() => db.laden(`/events/${name}`, ab)),
    schreiben: (name, daten, rev) => offline(() => db.hochladen(`/events/${name}`, daten, rev)),
    warten: c => offline(async () => { const r = await db.warten(c, 90); if (r.pause) await pause(r.pause * 1000); return r.aenderungen; }),
  };
}
function anhangAblage(db: Dropbox): AnhangFern {
  return {
    lesen: async id => (await db.laden(`/anhaenge/${id}`))?.daten ?? null,
    schreiben: async (id, d) => { await db.hochladen(`/anhaenge/${id}`, d, null, true); },
    loeschen: id => db.loeschen(`/anhaenge/${id}`),
  };
}

function pwaAnbinden(): Pwa {
  let warten: ServiceWorker | null = null;
  const abos: (() => void)[] = [];
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    void navigator.serviceWorker.register('/sw.js').then(reg => {
      const pruefen = () => { if (reg.waiting && navigator.serviceWorker.controller) { warten = reg.waiting; abos.forEach(cb => cb()); } };
      pruefen();
      reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', pruefen));
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update(); });
    });
    let neu = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!neu) { neu = true; location.reload(); } });
  }
  return {
    version: __VERSION__,
    neueVersion: () => warten !== null,
    neuLaden: () => { if (warten) warten.postMessage('aktivieren'); else location.reload(); },
    beiNeuerVersion: cb => { abos.push(cb); },
  };
}

async function starten(): Promise<void> {
  const wurzel = document.getElementById('app')!;
  const einstellungen = lokaleEinstellungen(localStorage);
  const db = dropbox({
    appKey: APP_KEY, rueckkehr: RUECKKEHR, fetch: (u, i) => fetch(u, i), jetzt: () => Date.now(),
    ablage: { lesen: k => localStorage.getItem(`rundblick.${k}`), schreiben: (k, w) => { if (w === null) localStorage.removeItem(`rundblick.${k}`); else localStorage.setItem(`rundblick.${k}`, w); } },
  });

  // Rückkehr von der Dropbox-Anmeldung: Code einlösen, Gerätename festlegen, sauber neu starten
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  if (code) {
    try {
      await db.anmeldungAbschliessen(code);
      const k = await db.konto();
      einstellungen.schreiben('konto', k.name);
      if (!einstellungen.lesen<string | null>('geraet', null)) einstellungen.schreiben('geraet', geraetVorschlag(k.name));
      location.replace(RUECKKEHR);
    } catch (e) {
      location.replace(`${RUECKKEHR}?error_description=${encodeURIComponent((e as Error).message)}`);
    }
    return;
  }

  const geraet = einstellungen.lesen<string>('geraet', 'handy');
  const idb = await datenbankOeffnen();
  const store = await FernEventStore.oeffnen({ geraet, neueId: ulidGenerator.neu, jetzt: () => systemUhr.jetzt(), lokal: eventSpeicher(idb) });
  const anhaenge = await FernAnhaenge.oeffnen(anhangSpeicher(idb));
  let dauerhaft: boolean | null = null;
  void navigator.storage?.persist?.().then(p => { dauerhaft = p; melden(); });

  // ---- Abgleich (für den Body): Stand aus Store + Anhängen + Anmeldung
  const abos = new Set<() => void>();
  const melden = () => abos.forEach(cb => cb());
  store.beiStand(melden);
  const verbinden = () => {
    const an = db.angemeldet();
    store.verbinden(an ? eventAblage(db) : null);
    anhaenge.verbinden(an ? anhangAblage(db) : null);
  };
  verbinden();
  const abgleich: Abgleich = {
    stand: () => {
      const s = store.abgleichStand();
      return {
        verfuegbar: true, verbunden: db.angemeldet(), konto: einstellungen.lesen<string | null>('konto', null), geraet,
        online: s.online, laeuft: s.laeuft, wartend: store.wartend() + anhaenge.wartend(), zuletzt: s.zuletzt, fehler: s.fehler, speicherDauerhaft: dauerhaft,
      };
    },
    abgleichen: async () => {
      try { await store.abgleichen(); await anhaenge.abgleichen(); }
      catch (e) { if (e instanceof DropboxAnmeldung) verbinden(); }
      finally { melden(); }
    },
    verbinden: async () => { location.assign(await db.anmeldeUrl()); },
    trennen: async () => {
      await db.abmelden();
      await datenbankLoeschen(idb);
      ['geraet', 'konto', 'phone.ui'].forEach(k => localStorage.removeItem(`rundblick.${k}`));
      location.replace(RUECKKEHR);
    },
    beiAenderung: cb => { abos.add(cb); return () => { abos.delete(cb); }; },
  };

  // ---- Domain & Body
  const domain = new Domain(store);
  const body = new RundblickBody({
    domain, uhr: systemUhr, ids: ulidGenerator, einstellungen, kalender: ohneKalender(), cache: speicherKalenderCache(),
    anhaenge, info: { datenordner: 'Dropbox · Apps/Rundblick', geraet }, abgleich, zuNeueEvents: zuNeueAnzahl,
  });

  phoneStarten(body, wurzel, pwaAnbinden());

  // ---- Abgleich anstoßen: nach eigenen Änderungen (kurz gebündelt), beim Zurückkehren, wenn wieder online,
  // und dauerhaft per Longpoll auf Änderungen anderer Geräte
  let buendel: ReturnType<typeof setTimeout> | undefined;
  store.abonnieren(a => { if (!a.fremd) { clearTimeout(buendel); buendel = setTimeout(() => void abgleich.abgleichen(), 400); } });
  window.addEventListener('online', () => void abgleich.abgleichen());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void abgleich.abgleichen(); });

  while (db.angemeldet()) {
    await abgleich.abgleichen();
    const s = store.abgleichStand();
    if (!s.online || s.fehler) { await pause(20_000); continue; }
    if (document.visibilityState !== 'visible') { await new Promise<void>(ok => document.addEventListener('visibilitychange', () => ok(), { once: true })); continue; }
    try { await store.aufAenderungWarten(); } catch { await pause(15_000); }
  }
}

void starten();
