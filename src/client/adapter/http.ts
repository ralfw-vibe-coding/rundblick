// Client-Adapter: lokales Web-API. Liefert die Oberfläche auch an einen Browser (z. B. Chrome mit
// Feedback-Extension) und übersetzt HTTP-Aufrufe in Body-Aufrufe.
//   POST /api/<methode>   JSON rein, JSON raus (Header X-Rundblick: 1 nötig)
//   GET  /api/aenderungen Server-Sent Events mit den geänderten Bereichen
// Nur 127.0.0.1. Der Pflicht-Header erzwingt bei fremden Webseiten einen CORS-Preflight, den wir nicht
// beantworten – so können Webseiten im Browser keine Commands auslösen. Host-Prüfung gegen DNS-Rebinding.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { BODY_METHODEN, type Body, type BodyMethode } from '../../body/interface';

const TYPEN: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
};

export type WebServer = { url: string; stoppen(): void };

export function webAnbinden(body: Body, rendererOrdner: string, port = 4718): Promise<WebServer> {
  const server = createServer((req, res) => { void bearbeiten(body, rendererOrdner, req, res, port); });
  return new Promise((ok, nein) => {
    server.once('error', nein);
    server.listen(port, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${port}/`, stoppen: () => server.close() }));
  });
}

async function bearbeiten(body: Body, ordner: string, req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
  const host = req.headers.host ?? '';
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { res.writeHead(403).end(); return; }
  const url = new URL(req.url ?? '/', `http://${host}`);

  if (url.pathname === '/api/aenderungen' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': verbunden\n\n');
    const ab = body.beiAenderung(b => res.write(`data: ${JSON.stringify(b)}\n\n`));
    req.on('close', ab);
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    const methode = url.pathname.slice(5) as BodyMethode;
    if (req.method !== 'POST' || req.headers['x-rundblick'] !== '1' || !BODY_METHODEN.includes(methode)) { res.writeHead(400).end(); return; }
    try {
      const text = await lesen(req);
      const f = body[methode] as (a: unknown) => Promise<unknown>;
      const ergebnis = await f.call(body, text ? JSON.parse(text) : {});
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(ergebnis ?? null));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ fehler: (e as Error).message }));
    }
    return;
  }

  // Statische Dateien der Oberfläche
  const pfad = normalize(join(ordner, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!pfad.startsWith(normalize(ordner))) { res.writeHead(403).end(); return; }
  try {
    const inhalt = await readFile(pfad);
    res.writeHead(200, { 'Content-Type': TYPEN[extname(pfad)] ?? 'application/octet-stream' }).end(inhalt);
  } catch {
    res.writeHead(404).end();
  }
}

function lesen(req: IncomingMessage): Promise<string> {
  return new Promise((ok, nein) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', d => { s += d; if (s.length > 1_000_000) { nein(new Error('zu groß')); req.destroy(); } });
    req.on('end', () => ok(s));
    req.on('error', nein);
  });
}
