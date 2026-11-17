# Rundblick (rb) – Hinweise für jede Session

Electron-App für Aufgaben, Board und Kalender. Sprache in Oberfläche, Code-Bezeichnern und Commits: **Deutsch**.
Architektur und Entscheidungen: `requirements/design.html` (Abschnitte 13–15). Bedienung: `README.md`.

## Arbeitsweise
- **Regelmäßig committen** (Repo `rundblick/`), Commit-Nachrichten auf Deutsch.
- Vor jedem Commit: `npm run check` (Typecheck, Schichtregeln mit dependency-cruiser, Tests mit **≥ 90 % Abdeckung** für `src/body`, `src/domain`, `src/providers` – sonst bricht der Check ab).
- App bauen und starten: `npm run app` → `dist/mac-arm64/Rundblick.app`, signiert mit **„HyperRec Code Signing“** (Schlüsselbund). Läuft die App, vorher `osascript -e 'quit app "Rundblick"'`, danach `open dist/mac-arm64/Rundblick.app`.
- Sichtprüfung ohne die Daten des Nutzers anzufassen: `RB_PROFIL=/tmp/rb-prof RB_DATEN=/tmp/rb-s1 RB_KALENDER=beispiel RB_SCREENSHOT=/tmp/x.png RB_JS='(async()=>{…; return ergebnis})()' npx electron .` (vorher `npx electron-vite build`). Das Ergebnis von `RB_JS` erscheint als `RB_JS → …` auf der Konsole.
- Testdaten in Stufen: `npm run testdaten -- <stufe>`. **Löscht alle Events im Datenordner!** Nur auf Anweisung des Nutzers gegen die echten Daten laufen lassen; für eigene Prüfungen `RB_DATEN=/tmp/…` setzen.
- Echte Daten: `~/Dropbox/Apps/Rundblick/events/<gerät>.jsonl` (+ `anhaenge/`). Profil/Layouts: `~/Library/Application Support/Rundblick/geraet.json`.

## Architektur (Kurzfassung)
- `src/client` (Renderer, Preload, IPC- und HTTP-Adapter) kennt nur `src/body/interface.ts`.
- `src/body` koordiniert, kennt nur Domain- und Provider-Interfaces, keine Node-/Electron-APIs.
- `src/domain`: Commands über Kontextmodelle (lesen → entscheiden → bedingt anhängen), Projektion `bestand.ts`; kennt nur das Event-Store-Interface.
- `src/providers/*`: Event Store (JSONL pro Gerät, HLC), Uhr, IDs, Einstellungen, Kalender (EventKit-Helfer `helfer/rb-kalender.swift`), Anhänge (Dateien).
- `src/basis`: pure Helfer (Datum, Markdown). `src/main`: Composition Root.
- Events sind feingranular und werden nie umgeschrieben (Schema in `src/schema/events.ts`).

## UI-Entscheidungen des Nutzers (verbindlich)
**Allgemein**
- **Nur Lucide-Icons** (`src/client/ui/icons.ts`, Objekt `I`). Keine Unicode-Symbole als Icons, keine eigenen SVGs. `<select>`-Optionen können kein SVG → Icon daneben.
- **Zerstörende Aktionen zweistufig, keine Bestätigungsdialoge:** Symbol (Mülleimer, bei Bildern „×“) → 1. Klick verwandelt es in ein rotes „?“ → 2. Klick führt aus. Klick woanders oder 5 s ohne Klick → zurück. Umsetzung: `data-zweistufig="<aktion>"` + Handler `ZWEISTUFIG` in `interaktion.ts`.
- Oberfläche = frei teilbares Raster mit Arbeitsbereichen; Überblick ist King.

**Aufgabenliste**
- Abschnitte: Überfällig (hellrot) · Heute fällig (tiefrot) · Diese Woche bis Sonntag (orange) · Später (gelb) · Ohne Frist · Zurückgestellt · Abgeschlossen · (Archiv nur auf Wunsch). Alle klappbar, feine Trennlinie zwischen Abschnitten.
- In jedem Abschnitt gilt eine **manuelle Reihenfolge** (Priorisierung): neue Aufgaben kommen oben hinein; per Drag & Drop (nur innerhalb des Abschnitts) oder ⌥↑/⌥↓ für die geöffnete Aufgabe verschieben. Technisch: Rang je Aufgabe, Event `AufgabeEinsortiert`, Body-Command `aufgabeVerschieben(oben, unten)`.
- Neue Aufgaben: 5 s hervorgehoben und in den Blick gerollt (`frisch.ts`).
- Fälligkeit (Raute + Datum) steht **direkt hinter dem Titel**.
- Mülleimer erscheint beim Überfahren einer Zeile.
- Die in der Schublade geöffnete Aufgabe bleibt in Liste/Board **markiert und sichtbar**, auch wenn sie den Abschnitt wechselt.

**Kanban-Board**
- Kategorien und Spalten per Chevron zuklappbar (zugeklappt = schmaler Streifen mit senkrechter Beschriftung); Zustand je Board-Zelle gespeichert.
- Unten in jeder Spalte zwei eigene, anfangs zugeklappte Bereiche: „Zurückgestellt“ (Wiedervorlage in der Zukunft, mit Datum-Chip) und darunter „Abgeschlossen“ (durchgestrichen). Zähler zeigen nur offene Karten; archivierte erscheinen nicht.
- Karte wie Listenzeile: Abschließen-Kreis vor dem Titel, Frist dahinter, Mülleimer (zweistufig) schwebt beim Überfahren oben rechts.
- Spalten mindestens 150 px breit; Breite per Griff am rechten Spaltenrand einstellbar (Doppelklick = automatisch), wird im Board-Zustand gespeichert; wird es eng, scrollt das Board waagerecht.
- Zahlen in zugeklappten (senkrechten) Streifen stehen aufrecht.
- Offene Karten lassen sich senkrecht verschieben (Einfügelinie wie in der Liste), auch in eine andere Spalte (setzt dann zusätzlich den Status). Reihenfolge = derselbe manuelle Rang wie in der Liste.

**Schublade (Aufgabe)**
- Kopf: Abschließen-Kreis links vom Titel · Archiv · Mülleimer · ×. „×“ und Esc schließen.
- Reihenfolge: Status als Chips · Frist, Wiedervorlage · Verantwortlich, Ort · Tags · Notiz (füllt den Rest) · Bildanhänge · Buchung hinzufügen · bisherige Buchungen.
- Feldbezeichnungen klein und dezent: normale Schreibweise (keine Versalien), 11 px, hellgrau, ohne Sperrung.
- Verantwortlich, Ort, Tags sind **Chip-Felder** mit Vorschlägen; ↵ macht einen Chip mit ×; **Cursor bleibt nach ↵ im Feld**; Verantwortlich/Ort je ein Wert (neue Eingabe ersetzt), Tags mehrere; kein Platzhaltertext, sobald ein Chip gesetzt ist; Felder einzeilig, lange Chips mit „…“.
- **Notiz mit Markdown** (fett, kursiv, Links, Listen, abhakbare Checklisten): leer → Bearbeiten-Modus mit Cursor darin beim Öffnen; sonst Ansicht, in der man abhaken kann; ✎ oder Doppelklick → Bearbeiten.
- **Bilder an der Notiz:** per Drag & Drop auf die Schublade oder ⌘V; Vorschau unter der Notiz mit **Nummer im Kreis**; „×“ (zweistufig) löscht; Klick → Großansicht. Dateien in `<datenordner>/anhaenge/<id>`, Events `AnhangHinzugefuegt`/`AnhangEntfernt`.

**Fachlich**
- „Abgeschlossen“ ist ein eigener Zustand, unabhängig vom Board-Status; abgeschlossene Karten bleiben auf dem Board.
- **Archivieren** verbirgt eine Aufgabe überall (auch unter Abgeschlossen); **Verwerfen** löscht sie.
- Buchungen haben eigenen Titel/Notiz; freie Buchungen (ohne Aufgabe) können später zur Aufgabe werden.
- Board-Spalten gehören zu einer von drei Kategorien (nicht begonnen / begonnen / beendet).
- Kapazität je Wochentag; Buchungen und externe Kalender (pro Kalender einstellbar) belegen sie; Standarddauer für neue Buchungen.
