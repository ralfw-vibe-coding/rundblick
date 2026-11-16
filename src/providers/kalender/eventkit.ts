// Kalenderquelle über EventKit: startet den Swift-Helfer (helfer/bin/rb-kalender) als Kindprozess
// und spricht JSON-Zeilen mit ihm. Fehlt der Helfer, meldet die Quelle 'nichtVerfuegbar'.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { ExternerTermin, KalenderInfo, KalenderZugriff } from '../../schema/extern';
import type { Kalenderquelle } from './interface';

type Offen = { ok: (d: unknown) => void; nein: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export function eventKitKalender(helferPfad: string, zeitlimit = { anfrage: 15_000, termine: 60_000, zugriff: 10 * 60_000 }): Kalenderquelle & { beenden(): void } {
  let proc: ChildProcessWithoutNullStreams | null = null;
  let naechste = 1;
  const offen = new Map<number, Offen>();
  const abos = new Set<() => void>();

  function starten(): ChildProcessWithoutNullStreams | null {
    if (proc) return proc;
    if (!existsSync(helferPfad)) return null;
    const p = spawn(helferPfad, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: p.stdout }).on('line', zeile => {
      let n: { id?: number; ok?: boolean; daten?: unknown; fehler?: string; ereignis?: string };
      try { n = JSON.parse(zeile); } catch { return; }
      if (n.ereignis === 'geaendert') { abos.forEach(cb => cb()); return; }
      const o = n.id !== undefined ? offen.get(n.id) : undefined;
      if (!o) return;
      offen.delete(n.id!); clearTimeout(o.timer);
      if (n.ok) o.ok(n.daten); else o.nein(new Error(n.fehler ?? 'Helfer-Fehler'));
    });
    p.on('exit', () => {
      proc = null;
      offen.forEach(o => { clearTimeout(o.timer); o.nein(new Error('Kalender-Helfer beendet')); });
      offen.clear();
    });
    p.on('error', () => { proc = null; });
    proc = p;
    return p;
  }

  function frage<T>(op: string, extra: Record<string, unknown> = {}, ms = zeitlimit.anfrage): Promise<T> {
    const p = starten();
    if (!p) return Promise.reject(new Error('Kalender-Helfer nicht gefunden'));
    const id = naechste++;
    return new Promise<T>((ok, nein) => {
      // Die Erlaubnis-Anfrage wartet auf den Menschen – dafür länger warten
      const timer = setTimeout(() => { offen.delete(id); nein(new Error('Kalender-Helfer antwortet nicht')); }, op === 'zugriff' ? zeitlimit.zugriff : ms);
      offen.set(id, { ok: d => ok(d as T), nein, timer });
      p.stdin.write(JSON.stringify({ id, op, ...extra }) + '\n');
    });
  }

  return {
    async zugriff(): Promise<KalenderZugriff> {
      if (!existsSync(helferPfad)) return 'nichtVerfuegbar';
      try { return await frage<KalenderZugriff>('zugriff'); } catch { return 'nichtVerfuegbar'; }
    },
    kalender: () => frage<KalenderInfo[]>('kalender'),
    termine: (von, bis) => frage<ExternerTermin[]>('termine', { von, bis }, zeitlimit.termine),
    beiAenderung: cb => { abos.add(cb); return () => { abos.delete(cb); }; },
    beenden: () => { proc?.kill(); proc = null; },
  };
}
