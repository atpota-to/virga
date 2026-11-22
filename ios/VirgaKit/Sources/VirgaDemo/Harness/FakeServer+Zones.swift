// Ports harness/fakeServer.js (validateRepeat's check of a zone)
//
// A repeating post's zone is taken where
// `new Intl.DateTimeFormat('en-US', { timeZone })` takes it: an IANA name
// or link, or one of ICU's legacy ids, in any case; or an offset time zone
// (ECMA-402: '±HH', '±HHMM', '±HH:MM', up to 23:59 either side, the minus
// also as U+2212). Foundation's TimeZone(identifier:) reads more than that
// ("GMT+5", "UTC-03:00", tzdata's "Factory") and only in the case it is
// written, and can't hold an offset past 18 hours, so the names are looked
// up in several spellings and the made-up ones refused. Links whose
// capitals are irregular (Mexico/BajaNorte, America/Knox_IN, GB-Eire) are
// found only as written.

import Foundation
import VirgaCore

extension FakeServer {
  /// A zone as Intl reads `timeZone`: a fixed offset (ECMA-402's offset
  /// time zones, which may be up to 23:59 either side, past what a
  /// Foundation TimeZone can hold) or a named zone.
  enum IntlZone {
    case offset(seconds: Int)
    case named(TimeZone)

    /// What the zone's clock is ahead of UTC at `ms`, in ms.
    func offsetMs(at ms: Double) -> Double {
      switch self {
      case .offset(let seconds): return Double(seconds) * 1000
      case .named(let zone): return JSDate.offsetMs(at: ms, timeZone: zone)
      }
    }
  }

  /// `new Intl.DateTimeFormat('en-US', { timeZone: name })`'s zone, or nil
  /// where Intl throws (a RangeError). Intl reads an IANA name, a link or
  /// ICU's own legacy ids in any case; it doesn't take Foundation's own
  /// "GMT+5" or "UTC-03:00" forms, nor tzdata's "Factory".
  static func intlZone(named name: String) -> IntlZone? {
    if let seconds = offsetSeconds(name) { return .offset(seconds: seconds) }
    let upper = String(name.unicodeScalars.map { s -> Character in
      (0x61...0x7A).contains(s.value) ? Character(Unicode.Scalar(s.value - 0x20)!) : Character(s)
    })
    if ["UTC", "GMT", "ETC/UTC", "ETC/GMT"].contains(upper) { return TimeZone(identifier: "UTC").map(IntlZone.named) }
    if upper == "FACTORY" { return nil }
    let units = Array(upper.utf16)
    if units.count > 3, upper.hasPrefix("GMT") || upper.hasPrefix("UTC"), units[3] == 0x2B || units[3] == 0x2D {
      // Only IANA's GMT+0 and GMT-0 links; Foundation would read any offset.
      return upper == "GMT+0" || upper == "GMT-0" ? TimeZone(identifier: "UTC").map(IntlZone.named) : nil
    }
    for candidate in caseForms(name, upper) {
      guard !candidate.isEmpty, let zone = TimeZone(identifier: candidate) else { continue }
      // A custom zone Foundation made up from an offset in the name isn't one Intl knows.
      if zone.identifier.hasPrefix("GMT+") || zone.identifier.hasPrefix("GMT-") { return nil }
      return .named(zone)
    }
    return nil
  }

  /// The spellings of a zone name to look up, since Intl matches them in
  /// any case and Foundation only as written: as given, as one of the
  /// canonical names, then each part between the slashes title-cased (as
  /// V8 writes a location: `America/Port-au-Prince`) or in capitals (`US`,
  /// `GB`, `EST5EDT`).
  static func caseForms(_ name: String, _ upper: String) -> [String] {
    var out = [name]
    if let known = TimeZone.knownTimeZoneIdentifiers.first(where: { $0.uppercased() == upper }) { out.append(known) }
    func title(_ part: Substring, small: Bool) -> String {
      var word = ""
      var out = ""
      func flush() {
        let lower = word.lowercased()
        // V8's own: of, es and au stay in lower case inside a name.
        if small, !out.isEmpty, ["of", "es", "au"].contains(lower) {
          out += lower
        } else {
          out += lower.prefix(1).uppercased() + lower.dropFirst()
        }
        word = ""
      }
      for c in part {
        if c == "_" || c == "-" {
          flush()
          out.append(c)
        } else {
          word.append(c)
        }
      }
      flush()
      return out
    }
    let parts = name.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count <= 4 else { return out }
    for small in [true, false] {
      for mask in 0..<(1 << parts.count) {
        let form = parts.enumerated().map { i, part in mask & (1 << i) != 0 ? part.uppercased() : title(part, small: small) }
        out.append(form.joined(separator: "/"))
      }
    }
    out.append(upper)
    if upper.hasPrefix("SYSTEMV/") { out.append("SystemV/" + upper.dropFirst(8)) }
    return out
  }

  /// ECMA-402's offset time zones, '±HH', '±HHMM' or '±HH:MM' (the minus
  /// sign also as U+2212), as seconds east of UTC.
  static func offsetSeconds(_ text: String) -> Int? {
    var scalars = Array(text.unicodeScalars)
    guard let sign = scalars.first, ["+", "-", "\u{2212}"].contains(sign) else { return nil }
    scalars.removeFirst()
    let rest = scalars.map { $0.value }
    func digits(_ slice: ArraySlice<UInt32>) -> Int? {
      guard !slice.isEmpty, slice.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }) else { return nil }
      return slice.reduce(0) { $0 * 10 + Int($1 - 0x30) }
    }
    var hours: Int?
    var minutes = 0
    switch rest.count {
    case 2: hours = digits(rest[0..<2])
    case 4:
      hours = digits(rest[0..<2])
      minutes = digits(rest[2..<4]) ?? 99
    case 5:
      guard rest[2] == 0x3A else { return nil }
      hours = digits(rest[0..<2])
      minutes = digits(rest[3..<5]) ?? 99
    default: return nil
    }
    guard let hours, hours <= 23, minutes <= 59 else { return nil }
    return (sign == "+" ? 1 : -1) * (hours * 3600 + minutes * 60)
  }

  /// Whether `new Intl.DateTimeFormat('en-US', { timeZone: z })` takes `z`
  /// (fakeServer.js's own check of a repeating post's zone).
  static func isZone(_ z: JSONValue?) -> Bool {
    guard let z, z.isTruthy else { return false }
    return intlZone(named: z.jsString) != nil
  }
}
