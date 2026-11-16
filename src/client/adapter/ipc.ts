// Client-Adapter im Main-Prozess: übersetzt IPC-Aufrufe des Renderers in Body-Aufrufe
// und leitet Änderungsbenachrichtigungen an alle Fenster weiter.
import { BrowserWindow, ipcMain } from 'electron';
import { BODY_METHODEN, type Body, type BodyMethode } from '../../body/interface';

export const KANAL_AUFRUF = 'rb:aufruf';
export const KANAL_GEAENDERT = 'rb:geaendert';

export function ipcAnbinden(body: Body): () => void {
  ipcMain.handle(KANAL_AUFRUF, async (_e, methode: unknown, argument: unknown) => {
    if (!BODY_METHODEN.includes(methode as BodyMethode)) throw new Error(`Unbekannte Methode: ${String(methode)}`);
    const f = body[methode as BodyMethode] as (a: unknown) => Promise<unknown>;
    return f.call(body, argument ?? {});
  });
  const ab = body.beiAenderung(bereiche => {
    BrowserWindow.getAllWindows().forEach(w => { if (!w.isDestroyed()) w.webContents.send(KANAL_GEAENDERT, bereiche); });
  });
  return () => { ipcMain.removeHandler(KANAL_AUFRUF); ab(); };
}
