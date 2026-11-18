// rb-kalender – EventKit-Helfer für Rundblick.
// Spricht JSON-Zeilen über stdin/stdout:
//   → {"id":1,"op":"zugriff"}                       ← {"id":1,"ok":true,"daten":"erlaubt"}
//   → {"id":2,"op":"kalender"}                      ← {"id":2,"ok":true,"daten":[{id,name,konto,farbe}]}
//   → {"id":3,"op":"termine","von":"2026-11-01","bis":"2026-11-30"}
//   → {"id":4,"op":"anlegen","kalenderId":"…","titel":"…","notiz":"…","datum":"2026-11-19","start":"10:00","dauer":60}  ← Termin (mit uid)
//   → {"id":5,"op":"aendern","uid":"…", titel, notiz, datum, start, dauer}   ← Termin oder null (nicht gefunden)
//   → {"id":6,"op":"loeschen","uid":"…"}                                       ← true/false
//   → {"id":7,"op":"lesen","uid":"…"}                                          ← Termin oder null
//   ← {"ereignis":"geaendert"}   (wenn macOS Kalenderänderungen meldet)
// Termine tragen „uid“ (Kennung beim Anbieter, geräteübergreifend gleich), „notiz“ und „geaendert“ (ISO-Zeit).
import EventKit
import Foundation
import CoreGraphics

let store = EKEventStore()
let ausgabe = FileHandle.standardOutput
let sperre = NSLock()

func sende(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
  sperre.lock(); defer { sperre.unlock() }
  ausgabe.write(data)
  ausgabe.write("\n".data(using: .utf8)!)
}

func status() -> String {
  let s = EKEventStore.authorizationStatus(for: .event)
  switch s {
  case .fullAccess: return "erlaubt"
  case .notDetermined: return "unbestimmt"
  case .denied, .restricted, .writeOnly: return "verweigert"
  @unknown default:
    return s.rawValue == 3 ? "erlaubt" : "verweigert"
  }
}

let tagFormat: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f }()
let zeitFormat: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "HH:mm"; return f }()

let isoFormat: ISO8601DateFormatter = ISO8601DateFormatter()

/** Kennung beim Anbieter (iCloud/Google) – geräteübergreifend gleich; Ersatz: lokale Kennung */
func uid(_ e: EKEvent) -> String { e.calendarItemExternalIdentifier ?? e.calendarItemIdentifier }

func finde(_ u: String) -> EKEvent? {
  if let e = store.calendarItems(withExternalIdentifier: u).compactMap({ $0 as? EKEvent }).first { return e }
  return store.calendarItem(withIdentifier: u) as? EKEvent
}

func eintrag(_ e: EKEvent) -> [String: Any] {
  let s = e.startDate ?? Date(), en = e.endDate ?? s
  return ["id": "\(e.calendarItemIdentifier)@\(Int(s.timeIntervalSince1970))", "kalenderId": e.calendar.calendarIdentifier, "titel": e.title ?? "",
          "datum": tagFormat.string(from: s), "start": e.isAllDay ? NSNull() : zeitFormat.string(from: s) as Any,
          "dauer": e.isAllDay ? 0 : max(0, Int(en.timeIntervalSince(s) / 60)), "ort": e.location ?? "",
          "uid": uid(e), "notiz": e.notes ?? "", "geaendert": e.lastModifiedDate.map { isoFormat.string(from: $0) } ?? NSNull()]
}

/** Setzt Titel, Notiz, Beginn und Dauer (Termin mit Uhrzeit) */
func setze(_ e: EKEvent, _ a: [String: Any]) -> Bool {
  guard let datum = a["datum"] as? String, let start = a["start"] as? String, let tag = tagFormat.date(from: datum) else { return false }
  let teile = start.split(separator: ":").compactMap { Int($0) }
  guard teile.count == 2, let beginn = Calendar.current.date(bySettingHour: teile[0], minute: teile[1], second: 0, of: tag) else { return false }
  e.title = a["titel"] as? String ?? e.title
  e.notes = a["notiz"] as? String ?? e.notes
  e.isAllDay = false
  e.startDate = beginn
  e.endDate = beginn.addingTimeInterval(Double((a["dauer"] as? Int) ?? 60) * 60)
  return true
}

func hex(_ c: CGColor?) -> String {
  guard let c = c, let srgb = CGColorSpace(name: CGColorSpace.sRGB),
        let k = c.converted(to: srgb, intent: .defaultIntent, options: nil)?.components, k.count >= 3 else { return "#888888" }
  return String(format: "#%02x%02x%02x", Int(k[0] * 255), Int(k[1] * 255), Int(k[2] * 255))
}

func kalender() -> [[String: Any]] {
  store.calendars(for: .event).map { k in
    ["id": k.calendarIdentifier, "name": k.title, "konto": k.source?.title ?? "", "farbe": hex(k.cgColor), "schreibbar": k.allowsContentModifications]
  }
}

func termine(von: String, bis: String) -> [[String: Any]] {
  guard let start = tagFormat.date(from: von), let endeTag = tagFormat.date(from: bis),
        let ende = Calendar.current.date(byAdding: .day, value: 1, to: endeTag) else { return [] }
  var ergebnis: [[String: Any]] = []
  // EventKit liefert Serien bereits aufgelöst; große Bereiche in Jahresstücken abfragen
  var a = start
  while a < ende {
    let b = min(Calendar.current.date(byAdding: .day, value: 365, to: a)!, ende)
    let p = store.predicateForEvents(withStart: a, end: b, calendars: nil)
    for e in store.events(matching: p) {
      guard let s = e.startDate, let en = e.endDate else { continue }
      if s < a && a != start { continue } // Doppelte an Stückgrenzen vermeiden
      let id = "\(e.calendarItemIdentifier)@\(Int(s.timeIntervalSince1970))"
      if e.isAllDay {
        // ganztägig: ein Eintrag pro Tag
        var t = Calendar.current.startOfDay(for: s)
        while t < en && t < ende {
          if t >= start { ergebnis.append(["id": "\(id)#\(tagFormat.string(from: t))", "kalenderId": e.calendar.calendarIdentifier, "titel": e.title ?? "", "datum": tagFormat.string(from: t), "start": NSNull(), "dauer": 0, "ort": e.location ?? ""]) }
          t = Calendar.current.date(byAdding: .day, value: 1, to: t)!
        }
      } else {
        let tagEnde = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: s))!
        let dauer = max(0, Int(min(en, tagEnde).timeIntervalSince(s) / 60))
        ergebnis.append(["id": id, "kalenderId": e.calendar.calendarIdentifier, "titel": e.title ?? "", "datum": tagFormat.string(from: s), "start": zeitFormat.string(from: s), "dauer": dauer, "ort": e.location ?? "",
                         "uid": uid(e), "notiz": e.notes ?? "", "geaendert": e.lastModifiedDate.map { isoFormat.string(from: $0) } ?? NSNull()])
      }
    }
    a = b
  }
  return ergebnis
}

func bearbeite(_ zeile: String) {
  guard let data = zeile.data(using: .utf8), let anfrage = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let op = anfrage["op"] as? String else { return }
  let id = anfrage["id"] ?? NSNull()
  switch op {
  case "zugriff":
    if status() == "unbestimmt" {
      store.requestFullAccessToEvents { _, _ in
        store.reset()
        sende(["id": id, "ok": true, "daten": status()])
      }
    } else {
      sende(["id": id, "ok": true, "daten": status()])
    }
  case "status":
    sende(["id": id, "ok": true, "daten": status()])
  case "kalender":
    sende(["id": id, "ok": true, "daten": status() == "erlaubt" ? kalender() : []])
  case "termine":
    let von = anfrage["von"] as? String ?? "", bis = anfrage["bis"] as? String ?? ""
    sende(["id": id, "ok": true, "daten": status() == "erlaubt" ? termine(von: von, bis: bis) : []])
  case "anlegen":
    guard status() == "erlaubt", let kid = anfrage["kalenderId"] as? String, let kal = store.calendar(withIdentifier: kid) else {
      sende(["id": id, "ok": false, "fehler": "Kalender nicht gefunden oder kein Zugriff"]); return
    }
    let e = EKEvent(eventStore: store)
    e.calendar = kal
    guard setze(e, anfrage) else { sende(["id": id, "ok": false, "fehler": "Datum/Uhrzeit ungültig"]); return }
    do { try store.save(e, span: .thisEvent, commit: true); sende(["id": id, "ok": true, "daten": eintrag(e)]) }
    catch { sende(["id": id, "ok": false, "fehler": error.localizedDescription]) }
  case "aendern":
    guard let u = anfrage["uid"] as? String, let e = finde(u) else { sende(["id": id, "ok": true, "daten": NSNull()]); return }
    guard setze(e, anfrage) else { sende(["id": id, "ok": false, "fehler": "Datum/Uhrzeit ungültig"]); return }
    do { try store.save(e, span: .thisEvent, commit: true); sende(["id": id, "ok": true, "daten": eintrag(e)]) }
    catch { sende(["id": id, "ok": false, "fehler": error.localizedDescription]) }
  case "loeschen":
    guard let u = anfrage["uid"] as? String, let e = finde(u) else { sende(["id": id, "ok": true, "daten": false]); return }
    do { try store.remove(e, span: .thisEvent, commit: true); sende(["id": id, "ok": true, "daten": true]) }
    catch { sende(["id": id, "ok": false, "fehler": error.localizedDescription]) }
  case "lesen":
    guard let u = anfrage["uid"] as? String, let e = finde(u) else { sende(["id": id, "ok": true, "daten": NSNull()]); return }
    sende(["id": id, "ok": true, "daten": eintrag(e)])
  default:
    sende(["id": id, "ok": false, "fehler": "unbekannte Operation \(op)"])
  }
}

NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: nil) { _ in
  sende(["ereignis": "geaendert"])
}

DispatchQueue.global().async {
  while let zeile = readLine() { bearbeite(zeile) }
  exit(0)
}
RunLoop.main.run()
