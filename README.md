# Rundblick (rb)

Aufgaben, Board und Kalender im Überblick – Electron-App für den Mac.
Eigene Daten liegen als Events in der Dropbox, Termine aus macOS-Kalendern (iCloud, Google …) kommen über EventKit dazu.

## Starten

```sh
npm install            # lädt auch Electron und trägt die Kalender-Begründung ein
npm run app            # baut Helfer + App → dist/mac-arm64/Rundblick.app
open dist/mac-arm64/Rundblick.app
```

Beim ersten Start fragt macOS nach dem Kalenderzugriff. Danach erscheinen alle Kalender aus der macOS-Kalender-App; unter ⚙︎ lässt sich pro Kalender einstellen, ob er sichtbar ist und ob er Kapazität belegt.

Zum Ausprobieren ohne echte Daten:

```sh
npm run demo           # Beispieldaten in /tmp/rundblick-demo, Beispiel-Kalender statt EventKit
```

Entwicklung: `npm run dev` (Hot Reload), `npm run check` (Typecheck, Schichtregeln, Tests).

## Im Browser (z. B. für die Feedback-Extension)

In der laufenden App: **Ansicht › Im Browser öffnen** (`⇧⌘B`). Das startet ein lokales Web-API auf `http://127.0.0.1:4718/` und öffnet die gleiche Oberfläche im Standardbrowser – mit denselben Daten, Änderungen erscheinen live in beiden. Nur über `127.0.0.1` erreichbar; Commands brauchen den Header `X-Rundblick: 1`, damit fremde Webseiten nichts auslösen können. Sofort beim Start: `RB_WEB=1` (Port: `RB_WEB_PORT`).

## Daten

| Was | Wo |
|---|---|
| Domain state (Events) | `~/Dropbox/Apps/Rundblick/events/<gerät>.jsonl` – eine Datei pro Gerät |
| Layouts, Kalender-Einstellungen, Gerätename | `~/Library/Application Support/Rundblick/geraet.json` |
| Cache externer Termine | `~/Library/Application Support/Rundblick/kalendercache.json` |

Umgebungsvariablen: `RB_DATEN` (anderer Datenordner), `RB_KALENDER=beispiel`, `RB_DEMO=1`, `RB_SCREENSHOT=datei.png` (+ `RB_JS`).

## Bedienung

- **Raster:** Jede Zelle per Symbol oben rechts teilen (nebeneinander/untereinander), Sicht im Zellkopf wählen, Trenner ziehen, Doppelklick auf den Zellkopf maximiert. Layouts sind **Arbeitsbereiche** (Tasten `1`–`9`).
- **Neue Aufgabe:** `N` oder oben eintippen, `↵`. Syntax: `#tag @person /ort !frist ^wiedervorlage =status >datum [hh:mm] [dauer]`; beginnt die Zeile mit `>`, entsteht nur eine Buchung.
- **Planen per Ziehen:** Aufgabe aufs Reservierungsband → Reservierung, ins Raster → Termin, auf eine Board-Spalte → Status. Freie Buchung auf Liste/Board → wird zur Aufgabe.
- **Freie Buchung:** Doppelklick ins Reservierungsband oder Zeitraster.
- **Details:** Klick auf Aufgabe oder Buchung öffnet die Schublade; alle Felder sind direkt editierbar.

## Architektur

Siehe [`requirements/design.html`](requirements/design.html). Kurz:

```
src/client   Oberfläche (Renderer), Preload-Brücke, IPC-Adapter   → kennt nur body/interface.ts
src/body     Koordination aller Commands/Queries                   → kennt Domain- und Provider-Interfaces
src/domain   Entscheidungen über Kontextmodelle + Projektion       → kennt nur das Event-Store-Interface
src/providers Event Store (JSONL/HLC), Uhr, IDs, Einstellungen, Kalender (EventKit, Beispiel, Cache)
src/schema   Events und Typen (Application state schema)
src/main     Composition Root
helfer/      EventKit-Helfer in Swift (JSON-Zeilen über stdin/stdout)
```

Die Schichtregeln prüft `npm run lint:deps` (dependency-cruiser).
