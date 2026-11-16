import type { Bereich } from '../../../body/interface';

/** Darstellungsdichte – hängt von der Zellgröße ab */
export type Dichte = 'full' | 'compact' | 'mini';

export interface Sicht {
  /** Bei Änderungen dieser Bereiche wird die Sicht neu gezeichnet */
  readonly bereiche: Bereich[];
  render(el: HTMLElement, dichte: Dichte): Promise<void>;
  /** Zustand, der mit dem Layout gespeichert wird (Filter, Kalenderansicht, Zoom …) */
  zustand(): unknown;
}
