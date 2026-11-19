// Build der Phone App (PWA): Wurzel src/client/phone, Composition Root src/phone/main.ts, Ausgabe out/phone.
// Erzeugt zusätzlich den Service Worker (sw.js) mit der Liste aller Dateien → die App startet auch offline.
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const paket = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string };
const build = (() => { try { return execSync('git rev-list --count HEAD').toString().trim(); } catch { return '0'; } })();
const VERSION = `${paket.version} · Build ${build}`;
const PUBLIC = resolve('src/client/phone/public');

function serviceWorker(): Plugin {
  return {
    name: 'rundblick-service-worker',
    apply: 'build',
    generateBundle(_o, bundle) {
      const dateien = ['/', ...Object.keys(bundle).map(f => `/${f}`), ...readdirSync(PUBLIC).filter(f => !f.startsWith('_')).map(f => `/${f}`)];
      const cache = `rundblick-b${build}-${Date.now().toString(36)}`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `// Service Worker der Phone App (erzeugt beim Build)
const CACHE = ${JSON.stringify(cache)};
const DATEIEN = ${JSON.stringify(dateien)};
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN))));
// Eine neue Version wartet, bis die App „neu laden“ sagt (Einstellungen › Version)
self.addEventListener('message', e => { if (e.data === 'aktivieren') self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // Dropbox-API nie aus dem Cache
  if (e.request.mode === 'navigate') { e.respondWith(caches.match('/', { cacheName: CACHE }).then(r => r || fetch(e.request))); return; }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
` });
    },
  };
}

export default defineConfig({
  root: resolve('src/client/phone'),
  publicDir: PUBLIC,
  define: { __VERSION__: JSON.stringify(VERSION) },
  server: { port: 5174, strictPort: true, fs: { allow: [resolve('src')] } },
  preview: { port: 5174, strictPort: true },
  build: { outDir: resolve('out/phone'), emptyOutDir: true },
  plugins: [serviceWorker()],
});
