// Brücke zwischen Renderer und Main-Prozess. Die Oberfläche bekommt genau zwei Funktionen:
// eine Body-Methode aufrufen und über Änderungen informiert werden.
import { contextBridge, ipcRenderer } from 'electron';
import type { Bereich, BodyMethode } from '../../body/interface';

export type RbBruecke = {
  aufruf(methode: BodyMethode, argument?: unknown): Promise<unknown>;
  beiAenderung(cb: (bereiche: Bereich[]) => void): () => void;
};

const bruecke: RbBruecke = {
  aufruf: (methode, argument) => ipcRenderer.invoke('rb:aufruf', methode, argument),
  beiAenderung: cb => {
    const h = (_e: unknown, b: Bereich[]) => cb(b);
    ipcRenderer.on('rb:geaendert', h);
    return () => { ipcRenderer.off('rb:geaendert', h); };
  },
};

contextBridge.exposeInMainWorld('rb', bruecke);
