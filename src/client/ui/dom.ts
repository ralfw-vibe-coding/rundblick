// Kleine DOM-Helfer für die Oberfläche.
import type { CommandStatus } from '../../body/interface';

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

let toastEl: HTMLDivElement | null = null;
let toastT: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, fehler = false): void {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
  toastEl.textContent = text;
  toastEl.style.background = fehler ? '#b42318' : '#1d1d1f';
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl!.classList.remove('show'), fehler ? 4000 : 2200);
}

/** Zeigt Fehler eines Commands an; liefert true bei Erfolg */
export function pruefe(r: CommandStatus, erfolg?: string): boolean {
  if (!r.ok) { toast(r.fehler.join(' '), true); return false; }
  if (erfolg) toast(erfolg);
  return true;
}

/** true, wenn gerade in ein Eingabefeld getippt wird (dann keine Tastenkürzel) */
export const tippt = (e: KeyboardEvent): boolean =>
  /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? '') || (e.target as HTMLElement)?.isContentEditable || e.metaKey || e.ctrlKey || e.altKey;
