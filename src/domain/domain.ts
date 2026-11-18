// Implementierung des Domain interface. Kennt nur den Event Store.
import { KATEGORIEN } from '../schema/werte';
import type { EventStore } from '../providers/eventstore/interface';
import type { Datum, Id } from '../schema/werte';
import { anwenden, aufbauen, type Bestand } from './bestand';
import * as A from './commands/aufgaben';
import * as B from './commands/buchungen';
import * as S from './commands/board';
import * as N from './commands/notizen';
import type { DomainInterface } from './interface';
import { aktiveSpalten, type BuchungZ } from './zustand';

export class Domain implements DomainInterface {
  private bestand: Bestand;
  private abos = new Set<() => void>();

  constructor(private readonly es: EventStore) {
    this.bestand = aufbauen(es.lesen().events);
    es.abonnieren(a => {
      // Fremde Events können sich in den Strom einsortieren → Projektion neu aufbauen
      if (a.fremd) this.bestand = aufbauen(es.lesen().events);
      else a.events.forEach(e => anwenden(this.bestand, e));
      this.abos.forEach(cb => cb());
    });
  }

  aufgabeErfassen: DomainInterface['aufgabeErfassen'] = c => A.aufgabeErfassen(this.es, c);
  aufgabeAendern: DomainInterface['aufgabeAendern'] = c => A.aufgabeAendern(this.es, c);
  statusSetzen: DomainInterface['statusSetzen'] = c => A.statusSetzen(this.es, c);
  aufgabeAbschliessen: DomainInterface['aufgabeAbschliessen'] = c => A.aufgabeAbschliessen(this.es, c);
  aufgabeWiedereroeffnen: DomainInterface['aufgabeWiedereroeffnen'] = c => A.aufgabeWiedereroeffnen(this.es, c);
  aufgabeVerwerfen: DomainInterface['aufgabeVerwerfen'] = c => A.aufgabeVerwerfen(this.es, c);
  aufgabeArchivieren: DomainInterface['aufgabeArchivieren'] = c => A.aufgabeArchivieren(this.es, c);
  aufgabeAusArchivHolen: DomainInterface['aufgabeAusArchivHolen'] = c => A.aufgabeAusArchivHolen(this.es, c);
  anhangHinzufuegen: DomainInterface['anhangHinzufuegen'] = c => A.anhangHinzufuegen(this.es, c);
  anhangEntfernen: DomainInterface['anhangEntfernen'] = c => A.anhangEntfernen(this.es, c);
  aufgabeEinsortieren: DomainInterface['aufgabeEinsortieren'] = c => A.aufgabeEinsortieren(this.es, c);
  buchungAnlegen: DomainInterface['buchungAnlegen'] = c => B.buchungAnlegen(this.es, c);
  buchungEintragen: DomainInterface['buchungEintragen'] = c => B.buchungEintragen(this.es, c);
  buchungAendern: DomainInterface['buchungAendern'] = c => B.buchungAendern(this.es, c);
  buchungStornieren: DomainInterface['buchungStornieren'] = c => B.buchungStornieren(this.es, c);
  buchungVerknuepfen: DomainInterface['buchungVerknuepfen'] = c => B.buchungVerknuepfen(this.es, c);
  buchungAbgleichen: DomainInterface['buchungAbgleichen'] = c => B.buchungAbgleichen(this.es, c);
  verknuepfungLoesen: DomainInterface['verknuepfungLoesen'] = c => B.verknuepfungLoesen(this.es, c);
  aufgabeAusBuchung: DomainInterface['aufgabeAusBuchung'] = c => B.aufgabeAusBuchung(this.es, c);
  standardspaltenEinrichten: DomainInterface['standardspaltenEinrichten'] = () => S.standardspaltenEinrichten(this.es);
  spalteAnlegen: DomainInterface['spalteAnlegen'] = c => S.spalteAnlegen(this.es, c);
  spalteUmbenennen: DomainInterface['spalteUmbenennen'] = c => S.spalteUmbenennen(this.es, c);
  kategorieUmbenennen: DomainInterface['kategorieUmbenennen'] = c => S.kategorieUmbenennen(this.es, c);
  spaltenSortieren: DomainInterface['spaltenSortieren'] = c => S.spaltenSortieren(this.es, c);
  spalteEntfernen: DomainInterface['spalteEntfernen'] = c => S.spalteEntfernen(this.es, c);
  tageskapazitaetFestlegen: DomainInterface['tageskapazitaetFestlegen'] = c => S.tageskapazitaetFestlegen(this.es, c);
  standarddauerFestlegen: DomainInterface['standarddauerFestlegen'] = c => S.standarddauerFestlegen(this.es, c);
  notizErfassen: DomainInterface['notizErfassen'] = c => N.notizErfassen(this.es, c);
  notizAendern: DomainInterface['notizAendern'] = c => N.notizAendern(this.es, c);
  notizVerwerfen: DomainInterface['notizVerwerfen'] = c => N.notizVerwerfen(this.es, c);
  notizAnhangHinzufuegen: DomainInterface['notizAnhangHinzufuegen'] = c => N.notizAnhangHinzufuegen(this.es, c);
  notizAnhangEntfernen: DomainInterface['notizAnhangEntfernen'] = c => N.notizAnhangEntfernen(this.es, c);
  aufgabeAusNotiz: DomainInterface['aufgabeAusNotiz'] = c => N.aufgabeAusNotiz(this.es, c);

  aufgaben() { return [...this.bestand.aufgaben.values()].filter(a => !a.verworfen); }
  aufgabe(id: Id) { const a = this.bestand.aufgaben.get(id); return a && !a.verworfen ? a : null; }
  buchungen(von?: Datum, bis?: Datum): BuchungZ[] {
    return [...this.bestand.buchungen.values()].filter(b => !b.storniert && (!von || b.datum >= von) && (!bis || b.datum <= bis));
  }
  buchung(id: Id) { const b = this.bestand.buchungen.get(id); return b && !b.storniert ? b : null; }
  buchungenDerAufgabe(aufgabeId: Id) {
    return this.buchungen().filter(b => b.aufgabeId === aufgabeId).sort((a, b) => (a.datum + (a.start ?? '')).localeCompare(b.datum + (b.start ?? '')));
  }
  spalten() { return aktiveSpalten(this.bestand.spalten); }
  kategorien() { return KATEGORIEN.map(k => ({ id: k.id, name: this.bestand.kategorien[k.id] })); }
  planung() { return this.bestand.planung; }
  notizen() { return [...this.bestand.notizen.values()].filter(n => !n.verworfen && !n.umgewandelt); }
  notiz(id: Id) { const n = this.bestand.notizen.get(id); return n && !n.verworfen && !n.umgewandelt ? n : null; }

  beiAenderung(cb: () => void): () => void {
    this.abos.add(cb);
    return () => { this.abos.delete(cb); };
  }
}
