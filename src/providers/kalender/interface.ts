// Provider für externe Kalender (zuerst: EventKit über einen Swift-Helfer).
import type { ExternerTermin, KalenderInfo, KalenderZugriff } from '../../schema/extern';
import type { Datum } from '../../schema/werte';

export interface Kalenderquelle {
  /** Fragt (falls nötig) beim System um Erlaubnis und meldet den Stand */
  zugriff(): Promise<KalenderZugriff>;
  kalender(): Promise<KalenderInfo[]>;
  /** Einzeltermine (Serien aufgelöst) im Bereich [von, bis] */
  termine(von: Datum, bis: Datum): Promise<ExternerTermin[]>;
  /** Das System meldet Änderungen an Kalendern (z. B. iCloud-Sync) */
  beiAenderung(cb: () => void): () => void;
}

/** Zwischenspeicher externer Termine – damit Queries nie auf die Quelle warten */
export interface KalenderCache {
  kalender(): KalenderInfo[];
  termine(von: Datum, bis: Datum): ExternerTermin[];
  ersetzen(von: Datum, bis: Datum, kalender: KalenderInfo[], termine: ExternerTermin[]): void;
  stand(): { zuletzt: string | null; von: Datum | null; bis: Datum | null };
}
