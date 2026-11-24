// Test-Bank der Phone App: Dropbox-Attrappe im Browser (nur Arbeitsspeicher) – NICHT Teil der App.
// Liefert die Event-Dateien aus /test-daten.json; Prüfhilfe: URL-Fragment #p:<js> (Ergebnis unten eingeblendet).
window.addEventListener('error', e => console.log('TB-FEHLER ' + e.message));
window.addEventListener('unhandledrejection', e => console.log('TB-REJECT ' + (e.reason && (e.reason.stack || e.reason.message || e.reason))));
{ const o = indexedDB.open.bind(indexedDB); indexedDB.open = (...a) => { console.log('TB idb open'); const r = o(...a); r.addEventListener('success', () => console.log('TB idb ok')); r.addEventListener('error', () => console.log('TB idb fehler')); r.addEventListener('blocked', () => console.log('TB idb blocked')); return r; }; }

// Test-Bank: Dropbox-Attrappe im Browser (nur Arbeitsspeicher) – NICHT Teil der App
(() => {
  if (!localStorage.getItem('rundblick.dropbox.token')) {
    localStorage.setItem('rundblick.dropbox.token', JSON.stringify({ zugriff: 'T', erneuern: 'R', ablauf: Date.now() + 36e5 }));
    localStorage.setItem('rundblick.geraet', JSON.stringify('web-test'));
    localStorage.setItem('rundblick.konto', JSON.stringify('Ralf'));
  }
  const enc = new TextEncoder();
  let version = 1;
  const roh = (() => { const x = new XMLHttpRequest(); x.open('GET', '/test-daten.json', false); x.send(); return x.status === 200 ? JSON.parse(x.responseText) : {}; })();
  const dateien = new Map(Object.entries(roh).map(([n, t]) => [n.includes('/') ? '/' + n : '/events/' + n, { daten: enc.encode(t), rev: 'r1', v: 1 }]));
  window.__dropbox = { dateien, protokoll: [], anhaengen(name, text) { const d = dateien.get(name); version++; const neu = new Uint8Array([...(d ? d.daten : []), ...enc.encode(text)]); dateien.set(name, { daten: neu, rev: 'r' + version, v: version }); } };
  const antwort = (j, status = 200, kopf = {}) => new Response(typeof j === 'string' || j instanceof Uint8Array ? j : JSON.stringify(j), { status, headers: kopf });
  const echt = window.fetch.bind(window);
  window.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.includes('dropbox')) return echt(url, init);
    const arg = init.headers && init.headers['Dropbox-API-Arg'] ? JSON.parse(init.headers['Dropbox-API-Arg']) : null;
    const body = typeof init.body === 'string' ? (init.body === 'null' ? null : JSON.parse(init.body)) : null;
    window.__dropbox.protokoll.push(u.split('/2/')[1] + (arg ? ' ' + arg.path : ''));
    await new Promise(r => setTimeout(r, 30));
    if (u.endsWith('users/get_current_account')) return antwort({ name: { given_name: 'Ralf', display_name: 'Ralf' } });
    if (u.endsWith('files/list_folder') || u.endsWith('files/list_folder/continue')) {
      const seit = u.endsWith('continue') ? Number(body.cursor) : 0;
      const ordner = u.endsWith('continue') ? '/events' : body.path;
      const entries = [...dateien].filter(([p, d]) => p.startsWith(ordner + '/') && d.v > seit).map(([p, d]) => ({ '.tag': 'file', name: p.split('/').pop(), path_display: p, rev: d.rev, size: d.daten.length }));
      return antwort({ entries, cursor: String(version), has_more: false });
    }
    if (u.endsWith('files/list_folder/longpoll')) { const c = Number(body.cursor); for (let i = 0; i < 40 && version <= c; i++) await new Promise(r => setTimeout(r, 250)); return antwort({ changes: version > c }); }
    if (u.endsWith('files/download')) {
      const d = dateien.get(arg.path); if (!d) return antwort('path/not_found', 409);
      const m = init.headers.Range ? Number(init.headers.Range.match(/bytes=(\d+)/)[1]) : 0;
      if (m >= d.daten.length && m > 0) return antwort('', 416);
      return antwort(d.daten.slice(m), 200, { 'Dropbox-API-Result': JSON.stringify({ rev: d.rev }) });
    }
    if (u.endsWith('files/upload')) {
      const d = dateien.get(arg.path); const mode = arg.mode;
      const erwartet = mode === 'add' ? null : mode === 'overwrite' ? (d ? d.rev : null) : mode.update;
      if ((d ? d.rev : null) !== erwartet) return antwort('conflict', 409);
      version++; const daten = new Uint8Array(await new Response(init.body).arrayBuffer());
      dateien.set(arg.path, { daten, rev: 'r' + version, v: version });
      return antwort({ rev: 'r' + version });
    }
    if (u.endsWith('files/delete_v2')) { dateien.delete(body.path); version++; return antwort({}); }
    if (u.endsWith('create_folder_v2')) return antwort({});
    if (u.endsWith('auth/token/revoke')) return antwort(null);
    return antwort('unbekannt', 400);
  };
})();
// Prüfhilfe der Test-Bank: #p:<js> → nach 3 s ausführen, Ergebnis in <pre id="aus">
console.log('TB hash ' + location.hash.slice(0, 20));
if (location.hash.startsWith('#p:')) {
  const code = decodeURIComponent(location.hash.slice(3));
  setTimeout(async () => {
    const aus = document.createElement('pre'); aus.id = 'aus'; aus.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#ffd;color:#000;font:11px/1.35 monospace;white-space:pre-wrap;margin:0;padding:6px;max-height:60%;overflow:auto'; document.documentElement.appendChild(aus);
    const ergebnis = t => { aus.textContent = 'ERG' + 'EBNIS: ' + t; };
    const W = ms => new Promise(r => setTimeout(r, ms));
    console.log('TB prüfe');
    try { await (async () => { await eval(code); })(); } catch (e) { ergebnis('FEHLER ' + e.message); }
    console.log('TB fertig ' + aus.textContent.slice(0, 300));
  }, 3000);
}
