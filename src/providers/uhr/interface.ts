import type { Datum } from '../../schema/werte';

export interface Uhr {
  jetzt(): Date;
  /** heutiges Datum in lokaler Zeit */
  heute(): Datum;
  /** Minuten seit Mitternacht (lokal) */
  minuteDesTages(): number;
}
