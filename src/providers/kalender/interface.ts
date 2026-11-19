// Provider für externe Kalender (zuerst: EventKit über einen Swift-Helfer).
import type { ExternerTermin, KalenderInfo, KalenderZugriff, TerminDaten } from '../../schema/extern';
import type { Datum } from '../../schema/werte';

export interface Kalenderquelle {
  /** Fragt (falls nötig) beim System um Erlaubnis und meldet den Stand */
  zugriff(): Promise<KalenderZugriff>;
  kalender(): Promise<KalenderInfo[]>;
  /** Einzeltermine (Serien aufgelöst) im Bereich [von, bis] */
  termine(von: Datum, bis: Datum): Promise<ExternerTermin[]>;
  /** Das System meldet Änderungen an Kalendern (z. B. iCloud-Sync) */
  beiAenderung(cb: () => void): () => void;
  // ---- Spiegelung (nur Termine)
  /** legt einen Termin an und liefert ihn mit seiner UID */
  terminAnlegen(kalenderId: string, t: TerminDaten): Promise<ExternerTermin>;
  /** ändert den Termin mit dieser UID; null = nicht (mehr) gefunden */
  terminAendern(uid: string, t: TerminDaten): Promise<ExternerTermin | null>;
  /** löscht den Termin; false = war nicht (mehr) da */
  terminLoeschen(uid: string): Promise<boolean>;
  /** löscht genau dieses Vorkommen (Termin-id aus termine(); bei Serien nur diesen Termin); false = nicht (mehr) gefunden */
  vorkommenLoeschen(terminId: string): Promise<boolean>;
  /** liest einen Termin per UID (auch außerhalb des zwischengespeicherten Zeitraums); null = gelöscht */
  terminLesen(uid: string): Promise<ExternerTermin | null>;
}

/** Zwischenspeicher externer Termine – damit Queries nie auf die Quelle warten */
export interface KalenderCache {
  kalender(): KalenderInfo[];
  termine(von: Datum, bis: Datum): ExternerTermin[];
  ersetzen(von: Datum, bis: Datum, kalender: KalenderInfo[], termine: ExternerTermin[]): void;
  stand(): { zuletzt: string | null; von: Datum | null; bis: Datum | null };
}
