// Provider für externe Kalender (zuerst: EventKit über einen Swift-Helfer).
import type { ExternerTermin, KalenderInfo, KalenderStand, KalenderZugriff, TerminDaten, Vorkommen } from '../../schema/extern';
import type { Datum, Minuten, Uhrzeit } from '../../schema/werte';

export interface Kalenderquelle {
  /**
   * direkt: liest und schreibt selbst (EventKit; später z. B. Google per OAuth).
   * ablage: liest nur den Kalender-Stand, den ein Gerät mit direktem Zugang ablegt – schreiben geht dann über
   * Kalender-Aufträge, die jenes Gerät ausführt. Die Schreib-Methoden einer Ablage-Quelle werfen.
   */
  readonly art: 'direkt' | 'ablage';
  /** nur ablage: von welchem Gerät und wann der gelesene Stand ist */
  herkunft?(): { geraet: string; zeit: string } | null;
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
  /** löscht genau dieses Vorkommen (per terminId, sonst per uid + Datum/Beginn; bei Serien nur diesen Termin); false = nicht (mehr) gefunden */
  vorkommenLoeschen(v: Vorkommen): Promise<boolean>;
  /** verschiebt genau dieses Vorkommen (neuer Tag, Beginn, Dauer; Inhalt bleibt); null = nicht (mehr) gefunden */
  vorkommenVerschieben(v: Vorkommen, z: { datum: Datum; start: Uhrzeit; dauer: Minuten }): Promise<ExternerTermin | null>;
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

/** Ablage für Kalender-Stände: Geräte mit direktem Kalenderzugang legen ihren Stand ab, andere lesen ihn (Dropbox: kalender/<gerät>.json) */
export interface KalenderAblage {
  veroeffentlichen(s: KalenderStand): Promise<void>;
  /** alle abgelegten Stände (je Gerät einer) */
  staende(): Promise<KalenderStand[]>;
}
