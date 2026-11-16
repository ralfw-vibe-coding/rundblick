// rb-kalender – EventKit-Helfer für Rundblick.
// Spricht JSON-Zeilen über stdin/stdout:
//   → {"id":1,"op":"zugriff"}                       ← {"id":1,"ok":true,"daten":"erlaubt"}
//   → {"id":2,"op":"kalender"}                      ← {"id":2,"ok":true,"daten":[{id,name,konto,farbe}]}
//   → {"id":3,"op":"termine","von":"2026-11-01","bis":"2026-11-30"}
//   ← {"ereignis":"geaendert"}   (wenn macOS Kalenderänderungen meldet)
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

func hex(_ c: CGColor?) -> String {
  guard let c = c, let srgb = CGColorSpace(name: CGColorSpace.sRGB),
        let k = c.converted(to: srgb, intent: .defaultIntent, options: nil)?.components, k.count >= 3 else { return "#888888" }
  return String(format: "#%02x%02x%02x", Int(k[0] * 255), Int(k[1] * 255), Int(k[2] * 255))
}

func kalender() -> [[String: Any]] {
  store.calendars(for: .event).map { k in
    ["id": k.calendarIdentifier, "name": k.title, "konto": k.source?.title ?? "", "farbe": hex(k.cgColor)]
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
        ergebnis.append(["id": id, "kalenderId": e.calendar.calendarIdentifier, "titel": e.title ?? "", "datum": tagFormat.string(from: s), "start": zeitFormat.string(from: s), "dauer": dauer, "ort": e.location ?? ""])
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
