// Kleiner Chrome-Treiber über das DevTools-Protokoll (nur für die Test-Bank).
// Aufruf: node cdp.mjs <skript.mjs>  – das Skript exportiert default async ({ eval, foto, warten, klick, tippen, mobil }) => …
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const profil = mkdtempSync(join(tmpdir(), 'rb-cdp-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profil}`, '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
const warten = ms => new Promise(r => setTimeout(r, ms));

let ziel;
for (let i = 0; i < 50 && !ziel; i++) {
  await warten(150);
  try { ziel = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { /* startet noch */ }
}
const ws = new WebSocket(ziel.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let nr = 0; const offen = new Map(); const konsole = [];
ws.addEventListener('message', m => {
  const d = JSON.parse(m.data);
  if (d.id && offen.has(d.id)) { offen.get(d.id)(d); offen.delete(d.id); }
  if (d.method === 'Runtime.consoleAPICalled') konsole.push(d.params.args.map(a => a.value ?? a.description).join(' '));
  if (d.method === 'Runtime.exceptionThrown') konsole.push('FEHLER ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text));
});
const cdp = (method, params = {}) => new Promise(r => { const id = ++nr; offen.set(id, r); ws.send(JSON.stringify({ id, method, params })); });

await cdp('Runtime.enable'); await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const api = {
  konsole,
  warten,
  async laden(url) { await cdp('Page.navigate', { url }); await warten(1500); },
  async eval(ausdruck) {
    const r = await cdp('Runtime.evaluate', { expression: `(async()=>{ ${ausdruck} })()`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return 'FEHLER ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result?.result?.value;
  },
  async foto(datei) { const r = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(datei, Buffer.from(r.result.data, 'base64')); },
  async klick(sel) { return api.eval(`const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'fehlt: '+${JSON.stringify(sel)}; e.click(); return 'ok'`); },
  async tippen(sel, text, enter = true) {
    await api.eval(`document.querySelector(${JSON.stringify(sel)}).focus()`);
    await cdp('Input.insertText', { text });
    if (enter) { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); }
  },
  async beruehren(typ, x, y) { await cdp('Input.dispatchTouchEvent', { type: typ, touchPoints: typ === 'touchEnd' ? [] : [{ x, y }] }); },
  async maus(typ, x, y) { await cdp('Input.dispatchMouseEvent', { type: typ, x, y, button: 'left', buttons: typ === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' }); },
};

try {
  const skript = (await import(process.argv[2] + '?' + Date.now())).default;
  await skript(api);
} catch (e) { console.log('SKRIPT-FEHLER', e); }
finally {
  if (konsole.length) console.log('--- Konsole ---\n' + konsole.slice(-30).join('\n'));
  ws.close(); chrome.kill();
}
