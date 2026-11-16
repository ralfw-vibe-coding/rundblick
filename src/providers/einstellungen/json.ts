import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Einstellungen } from './interface';

/** Einstellungen in einer JSON-Datei; geschrieben wird atomar (temp + rename) */
export function jsonEinstellungen(pfad: string): Einstellungen {
  let daten: Record<string, unknown> = {};
  try { if (existsSync(pfad)) daten = JSON.parse(readFileSync(pfad, 'utf8')) as Record<string, unknown>; } catch { daten = {}; }
  return {
    lesen: <T>(k: string, standard: T): T => (k in daten ? (daten[k] as T) : standard),
    schreiben: (k, w) => {
      daten[k] = w;
      mkdirSync(dirname(pfad), { recursive: true });
      writeFileSync(pfad + '.tmp', JSON.stringify(daten, null, 2));
      renameSync(pfad + '.tmp', pfad);
    },
  };
}

export function speicherEinstellungen(start: Record<string, unknown> = {}): Einstellungen {
  const daten = { ...start };
  return { lesen: <T>(k: string, s: T): T => (k in daten ? (daten[k] as T) : s), schreiben: (k, w) => { daten[k] = w; } };
}
