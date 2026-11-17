// Anhänge als Dateien in <datenordner>/anhaenge/<id> (ohne Endung; der Typ steht im Event).
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Anhangspeicher } from './interface';

export function dateiAnhaenge(datenordner: string): Anhangspeicher {
  const ordner = join(datenordner, 'anhaenge');
  const pfad = (id: string) => {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Ungültige Anhang-ID: ${id}`);
    return join(ordner, id);
  };
  return {
    speichern: (id, daten) => {
      mkdirSync(ordner, { recursive: true });
      writeFileSync(pfad(id) + '.tmp', daten);
      renameSync(pfad(id) + '.tmp', pfad(id));
    },
    lesen: id => (existsSync(pfad(id)) ? new Uint8Array(readFileSync(pfad(id))) : null),
    entfernen: id => { rmSync(pfad(id), { force: true }); },
  };
}

export function speicherAnhaenge(): Anhangspeicher {
  const m = new Map<string, Uint8Array>();
  return { speichern: (id, d) => { m.set(id, d); }, lesen: id => m.get(id) ?? null, entfernen: id => { m.delete(id); } };
}
