// Ports src/legal/version.js
//
// Which Terms of Service and Privacy Policy an account agrees to. Virga's
// server reads the same file, so the gate and the ledger can't name
// different documents. ios/parity/cases/session.legal.js holds these to it.

import Foundation
import VirgaCore
import VirgaNetwork

public enum LegalVersion {
  /// Goes up by one when either document changes in a way people should
  /// agree to again. A build is stuck with the number it was made with:
  /// once the server's goes past it, the build can't record an agreement
  /// and the agreement screen asks for an update (TermsGateView), so a bump
  /// ships with a release that carries it (src/legal/version.js).
  public static let termsVersion = 2

  /// The "Last updated" date both documents carry, as YYYY-MM-DD.
  public static let termsEffectiveDate = "2026-11-23"

  /// Where the documents are read on the site (and in the app's routes).
  public static let termsPath = "/terms"
  public static let privacyPath = "/privacy"

  static let months = [
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
    "December",
  ]

  /// A YYYY-MM-DD date as the documents write it: "November 14, 2026". Nil
  /// for anything that isn't such a date (`/^(\d{4})-(\d{2})-(\d{2})$/`, a
  /// month 1–12 and a day 1–31).
  public static func formatLegalDate(_ isoDate: String?) -> String? {
    let units = Array((isoDate ?? "").utf16)
    guard units.count == 10, units[4] == 0x2D, units[7] == 0x2D else { return nil }
    let digitsAt = [0, 1, 2, 3, 5, 6, 8, 9]
    guard digitsAt.allSatisfy({ (0x30...0x39).contains(units[$0]) }) else { return nil }
    func number(_ range: Range<Int>) -> Int { range.reduce(0) { $0 * 10 + Int(units[$1] - 0x30) } }
    let month = number(5..<7)
    let day = number(8..<10)
    guard month >= 1, month <= 12, day >= 1, day <= 31 else { return nil }
    let year = String(decoding: units[0..<4], as: UTF16.self)
    return "\(months[month - 1]) \(day), \(year)"
  }

  /// `formatLegalDate(value)` for any value: `String(isoDate || '')`.
  public static func formatLegalDate(_ value: JSONValue?) -> String? {
    formatLegalDate(value.truthy?.jsString ?? "")
  }
}
