# Rundblick (rb) – Hinweise für jede Session

Electron-App für Aufgaben, Board und Kalender. Sprache in Oberfläche, Code-Bezeichnern und Commits: **Deutsch**.
Architektur und Entscheidungen: `requirements/design.html` (Abschnitte 13–15). Bedienung: `README.md`.

## Arbeitsweise
- **Regelmäßig committen** (Repo `rundblick/`), Commit-Nachrichten auf Deutsch.
- Vor jedem Commit: `npm run check` (Typecheck, Schichtregeln mit dependency-cruiser, Tests mit **≥ 90 % Abdeckung** für `src/body`, `src/domain`, `src/providers` – sonst bricht der Check ab).
- App bauen und starten: `npm run app` → `dist/mac-arm64/Rundblick.app`, signiert mit **„HyperRec Code Signing“** (Schlüsselbund). Läuft die App, vorher `osascript -e 'quit app "Rundblick"'`, danach `open dist/mac-arm64/Rundblick.app`.
- Sichtprüfung ohne die Daten des Nutzers anzufassen: `RB_PROFIL=/tmp/rb-prof RB_DATEN=/tmp/rb-s1 RB_KALENDER=beispiel RB_SCREENSHOT=/tmp/x.png RB_JS='(async()=>{…; return ergebnis})()' npx electron .` (vorher `npx electron-vite build`). Das Ergebnis von `RB_JS` erscheint als `RB_JS → …` auf der Konsole. Achtung: In diesem Modus hat das Fenster keinen System-Fokus – `focus()`/`blur()` lösen **keine** focusin/focusout-Ereignisse aus; im Test selbst `dispatchEvent(new FocusEvent('focusin'|'focusout', {bubbles:true}))` senden.
- Testdaten in Stufen: `npm run testdaten -- <stufe>` (Stufen: `1`, `2`, `logbuch`). **Löscht alle Events im Datenordner!** Nur auf Anweisung des Nutzers gegen die echten Daten laufen lassen; für eigene Prüfungen `RB_DATEN=/tmp/…` setzen.
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
- Oberfläche = frei teilbares Raster mit Arbeitsbereichen; Überblick ist King. Sichten je Zelle: **Aufgabenliste · Kanban-Board · Kalender · Timeline · Logbuch**. Der Kalender hat die Zeitraum-Auswahl **1 Tag · 3 Tage · Woche · Monat · 3 Monate** (früher getrennt in Tages-/Mehrtageskalender – alte Layouts werden beim Laden umgestellt).
- Kopfzeile: Arbeitsbereiche · „+“ neuer Arbeitsbereich · „−“ aktuellen löschen (zweistufig) · Kalender aktualisieren · Einstellungen. Ein „Arbeitsbereiche zurücksetzen“ gibt es bewusst nicht.
- **Uhrzeiten nie mit nativem `<input type="time">`**, sondern mit `uhrzeitFeld()` (`uhrzeitfeld.ts`): Textfeld + Liste nur in Viertelstunden (00/15/30/45), an aktueller Zeit bzw. Beginn der Tageszeit; Stunden außerhalb der Tageszeit blasser; Tippen „930“/„9:30“/„9“ – getippte Minuten bleiben **exakt** (10:33 bleibt 10:33), nur die Liste bietet Viertelstunden; ↑/↓ springt zur vorigen/nächsten Viertelstunde, ↵ übernimmt, Esc verwirft; leer erlaubt.
- Scrollbalken überall schmal (6 px) und dezent (hellgrau, ohne Spur) – global in `stil.css`.

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
- Karte wie Listenzeile: Abschließen-Kreis vor dem Titel, Frist dahinter, darunter Chips für Tags, @Verantwortlich und Ort (wie in der Liste); Mülleimer (zweistufig) schwebt beim Überfahren oben rechts.
- Spalten mindestens 150 px breit; Breite per Griff am rechten Spaltenrand einstellbar (Doppelklick = automatisch), wird im Board-Zustand gespeichert; wird es eng, scrollt das Board waagerecht.
- Zahlen in zugeklappten (senkrechten) Streifen stehen aufrecht.
- Neue Spalte direkt auf dem Board: „+“ hinter dem Gruppennamen (erscheint beim Überfahren) → am Ende der Gruppe eine Spalte mit Eingabefeld und Cursor; ↵ legt an, Esc/leer verwirft (wie in den Einstellungen, kein Dialog).
- Offene Karten lassen sich senkrecht verschieben (Einfügelinie wie in der Liste), auch in eine andere Spalte (setzt dann zusätzlich den Status). Reihenfolge = derselbe manuelle Rang wie in der Liste.

**Kalender**
- Ziehen einer Aufgabe (aus Liste/Board) oder eines Termins in Tag/3 Tage/Woche: **keine Einfärbung der ganzen Tagesspalte**, sondern eine **Einfügemarke** – Linie am Terminbeginn (15-Minuten-Raster) mit Uhrzeit „von–bis“ und blassem Block in der Länge des Termins. Neue Termine bekommen die **Standarddauer** (Einstellungen), verschobene behalten ihre Dauer; beim Verschieben folgt die Marke der Oberkante des Termins (Anfasspunkt wird berücksichtigt), auch auf andere Tage.
- **Auslastungsbalken** in Stufen (überall gleich: Band, Monat, Schublade, Timeline; Funktion `auslastungsStufe` in `bausteine.ts`): grün bis 66 % · gelb bis 85 % · rot bis 100 % · darüber rot mit Warndreieck (Lucide `TriangleAlert`). Tag ohne Kapazität mit Buchungen = überbucht.
- **Sichtbare Tageszeit** (Einstellungen, pro Gerät, Standard 7–21 Uhr): Tag/3 Tage/Woche zeigen diese Stunden; liegen an den angezeigten Tagen Termine davor/danach (eigene oder externe), wächst das Raster automatisch bis dorthin; Stunden außerhalb der Tageszeit sind dezent schraffiert. Schalter in der Kalenderleiste (Lucide `ChevronsUpDown`/`ChevronsDownUp`) zeigt pro Zelle den ganzen Tag 0–24 (gespeichert im Zellzustand `ganzerTag`). Interaktionen lesen das Fenster aus `data-h0/data-h1` am Raster (`fensterVon`).
- **Monatsansicht** je Tag: alle Einträge untereinander über die volle Breite – ganztägige, Reservierungen (gestrichelt, Dauer), Termine nach Uhrzeit als „HH:MM Titel“ mit farbigem Streifen links (Kalenderfarbe); zu viele → „+n weitere“. **Doppelklick in die freie Fläche** eines Tages = Buchung ohne Aufgabe (Eintragefeld mit Uhrzeitfeld: leer = Reservierung, sonst Termin); **Doppelklick auf die Tageszahl** oder „+n weitere“ = Tag öffnen (Tag, sonst 3 Tage). Links ein schmaler Streifen mit **Punkten** an der Tageszeit jedes Termins (zeigt, wo es sich ballt). Unten der Auslastungsbalken.
- **Heute hervorheben:** ab 3 Tagen (3 Tage, Woche) dünner Rahmen in der Heute-Farbe um die ganze Tagesspalte (Kopf + Reservierungsband + Raster); in Monat/3 Monate um die Tageszelle; bei „1 Tag“ kein Rahmen.
- **Fristen-Marke** (Raute + Anzahl im Tageskopf von Tag/3 Tage/Woche/Monat): Klick öffnet eine knappe Liste „Fällig <Tag>“ (Raute in Listenfarbe + Titel); Klick auf eine Zeile → Schublade, Ziehen → in den Kalender einplanen (Liste schließt danach). Esc/Klick daneben schließt.
- **Externe Kalender** werden aktualisiert: beim Start, beim Fokussieren des Fensters, bei Änderungsmeldung von macOS (EventKit) und **alle 5 Minuten** (`src/main/index.ts`); manuell über den Knopf mit Lucide `CalendarSync` links neben dem Zahnrad – pulsiert während des Ladens, Tooltip zeigt „zuletzt HH:MM Uhr“.
- **Seitenleiste der Tagesansicht:** nur „Überfällig“ und „Fällig <Tag>“ (plus „Taucht wieder auf“), als ziehbare Zeilen wie in der Aufgabenliste (Abschließen-Kreis, Raute in Listenfarben, gebuchte Zeit, Mülleimer; ohne Statuspunkt) – in den Tag ziehen = Termin. Keine Reservierungen, Termine oder Auslastung (stehen im Raster). Unten Hinweis: Doppelklick ins Raster/Reservierungsband = Buchung ohne Aufgabe (in Monat/3 Monate: in die freie Fläche eines Tages).

**Logbuch**
- Eigene Sicht: was an einem Tag **explizit abgehakt** wurde – abgeschlossene Aufgaben (Zeitpunkt = Event `AufgabeAbgeschlossen`) und abgehakte Checklisten-Punkte in Aufgaben-Notizen (Zeitpunkt des `BeschreibungGeaendert`, in dem der Punkt abgehakt wurde) – plus **Notizen**. Wieder geöffnet/aufgehakt/verworfen → raus; archiviert bleibt (mit Archiv-Symbol).
- **Endlos:** neuester Tag oben, „Heute“ steht immer da; ältere Tage werden beim Scrollen in Portionen nachgeladen. Auch **innerhalb eines Tages umgekehrt chronologisch** (neuester Eintrag oben), mit Uhrzeit; nachgetragene Notizen ohne Uhrzeit stehen unten in ihrem Tag. Filter (Text, #tag) und Sprung zu einem Datum („Heute“ führt zurück).
- **Notiz** = abgespeckte, quasi erledigte Aufgabe: **nur Text** (erste Zeile = Titel, Markdown), Tags, Bilder und der Tag im Logbuch (änderbar, nachgetragene Notizen stehen ohne Uhrzeit unten in ihrem Tag). Kein Status, keine Frist/Wiedervorlage/Verantwortlich/Ort, keine Buchungen. Eigene Events `Notiz*`, kein Sonderfall von Aufgabe.
- Eingabe oben im Logbuch: ↵ speichert, ⇧↵ neue Zeile, `#tag` wird übernommen. Klick → Notiz-Schublade (Kopf: Notiz-Symbol · Titel · „Aufgabe daraus machen“ (Lucide `ListPlus`) · Mülleimer zweistufig · ×; darunter Tag im Logbuch, Erfasst, Tags, Notiz, Bilder). Doppelklick → direkt bearbeiten.
- **Aus Notiz wird Aufgabe** (Event `AufgabeAusNotizErstellt`): erste Zeile = Titel, Rest = Notiz der Aufgabe, Tags und Bilder wandern mit; die Notiz verschwindet aus dem Logbuch. Umgekehrt nicht.

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
- Board-Spalten gehören zu einer von drei Kategorien (nicht begonnen / begonnen / beendet). Die drei Kategorien sind fest, ihre Namen (Spaltengruppen) sind in den Einstellungen umbenennbar (Event `KategorieUmbenannt`). Neue Spalte: „+“ direkt hinter dem Gruppennamen in den Einstellungen → leere Zeile mit Cursor, ↵ legt an, Esc/leer verwirft (kein Dialog).
- **Kalender:** Rundblick-Einträge (Buchungen von Aufgaben, freie Buchungen) erscheinen im Kalender als **eigene, zu Rundblick gehörende Einträge** – wie die Karten auf dem Board – neben den Terminen aus Google/iCloud. Sie sind **keine** Google-/iCloud-Einträge und werden dort (noch) nicht angelegt.
- **Später (Backlog, noch nicht umsetzen):** Rundblick-Aufgaben/Buchungen in Google Calendar oder iCloud übernehmen bzw. umwandeln.
- **Web-App (später, entschieden):** Browser greift direkt auf die Dropbox zu (Dropbox-API, App-Ordner), Body/Domain/UI laufen unverändert im Browser; neu nur Browser-Provider + Web-Composition-Root, dazu eine Kalenderquelle für Google/iCloud ohne EventKit. Kein zentraler Server (keine Datendopplung). Details: `requirements/design.html` §16. Deshalb Body und Domain weiterhin frei von Node-/Electron-APIs halten.
- Kapazität je Wochentag; Buchungen und externe Kalender (pro Kalender einstellbar) belegen sie; Standarddauer für neue Buchungen.
