// Merkt sich frisch angelegte Aufgaben für 5 Sekunden: Sichten heben sie hervor und rollen sie einmal in den Blick.
const DAUER = 5000;
const frisch = new Map<string, number>();
const gezeigt = new Set<string>();

export function markieren(id: string): void {
  frisch.set(id, Date.now()); gezeigt.delete(id);
  dispatchEvent(new CustomEvent('rb-frisch'));
}
export function istFrisch(id: string): boolean { const t = frisch.get(id); return t !== undefined && Date.now() - t < DAUER; }
/** bisher vergangene Zeit – damit die Animation nach einem Neuzeichnen nicht von vorn beginnt */
export function alter(id: string): number { return Date.now() - (frisch.get(id) ?? 0); }
/** true genau einmal je frischer Aufgabe: dann soll die Sicht sie in den Blick rollen */
export function einmalZeigen(id: string): boolean { if (gezeigt.has(id)) return false; gezeigt.add(id); return true; }
