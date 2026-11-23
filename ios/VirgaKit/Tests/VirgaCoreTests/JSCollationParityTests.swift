// String.prototype.localeCompare as the web calls it (ios/parity/cases/
// core.collation.js): pairs compared plainly and at base strength, with no
// locale and in each locale the app offers, and whole lists sorted as the
// app sorts them, all by Node's own collator.

import Foundation
import Testing
import VirgaTestSupport
@testable import VirgaCore

@Suite struct JSCollationParity {
  let fixture = "core.collation"

  /// '<', '=' or '>' a pair, as the generator writes them.
  static func signs(_ value: JSONValue?) -> [Int] {
    (value?.stringValue ?? "").map { $0 == "<" ? -1 : $0 == ">" ? 1 : 0 }
  }

  @Test func pairs() throws {
    var failures: [String] = []
    var count = 0
    let cases = try Parity.cases(fixture, fn: "localeCompare")
    #expect(cases.count > 150)
    for c in cases {
      let a = strings(c["a"])
      let b = strings(c["b"])
      // nil is the runtime's locale, which the web passes as `undefined`.
      let locales: [String?] = [nil] + AppLocale.localeChoices.map { $0 }
      for locale in locales {
        let answers = locale.flatMap { c.output["locales"]?[$0] } ?? c.output
        let variant = Self.signs(answers["variant"])
        let base = Self.signs(answers["base"])
        #expect(variant.count == a.count && base.count == a.count, "\(c.id)")
        for i in a.indices where i < variant.count && i < base.count {
          count += 1
          let plain = JSCollation.localeCompare(a[i], b[i], locale: locale)
          let folded = JSCollation.localeCompare(a[i], b[i], locale: locale, sensitivity: .base)
          if plain != variant[i] || folded != base[i] {
            failures.append(
              "\(c.id) [\(locale ?? "runtime")] \(a[i].debugDescription) vs \(b[i].debugDescription): "
                + "\(plain)/\(folded), expected \(variant[i])/\(base[i])")
          }
        }
      }
    }
    #expect(count > 100_000)
    #expect(failures.isEmpty, "\(failures.count) of \(count):\n\(failures.prefix(40).joined(separator: "\n"))")
  }

  @Test func sortedLists() throws {
    let cases = try Parity.cases(fixture, fn: "sort")
    #expect(cases.count > 20)
    for c in cases {
      let list = strings(c["list"])
      let plain = Self.stableSorted(list) { JSCollation.localeCompare($0, $1) }
      let folded = Self.stableSorted(list) { JSCollation.localeCompare($0, $1, sensitivity: .base) }
      let actual: JSONValue = ["variant": .array(plain.map(JSONValue.string)), "base": .array(folded.map(JSONValue.string))]
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  /// Array.prototype.sort: stable, so ties keep their order.
  static func stableSorted(_ list: [String], by compare: (String, String) -> Int) -> [String] {
    list.enumerated().sorted { x, y in
      let order = compare(x.element, y.element)
      return order != 0 ? order < 0 : x.offset < y.offset
    }.map(\.element)
  }

  func strings(_ value: JSONValue?) -> [String] {
    (value?.arrayValue ?? []).map { $0.stringValue ?? "" }
  }
}

@Suite struct JSCollationBehaviour {
  @Test func signsAndEquality() {
    #expect(JSCollation.localeCompare("a", "b") == -1)
    #expect(JSCollation.localeCompare("b", "a") == 1)
    #expect(JSCollation.localeCompare("", "") == 0)
    #expect(JSCollation.localeCompare("", "a") == -1)
    // Case and accents count plainly, not at base strength.
    #expect(JSCollation.localeCompare("a", "A") == -1)
    #expect(JSCollation.localeCompare("a", "A", sensitivity: .base) == 0)
    #expect(JSCollation.localeCompare("resume", "résumé") == -1)
    #expect(JSCollation.localeCompare("resume", "Résumé", sensitivity: .base) == 0)
  }

  @Test func canonicallyEquivalentTextIsEqual() {
    #expect(JSCollation.localeCompare("café", "cafe\u{301}") == 0)
    #expect(JSCollation.localeCompare("a\u{323}\u{301}", "a\u{301}\u{323}") == 0)
    // Hangul syllables are their jamo.
    #expect(JSCollation.localeCompare("한", "\u{1112}\u{1161}\u{11AB}") == 0)
    // A deliberate difference: Node's collator sorts these Kirat Rai vowel
    // signs (Unicode 16) apart though they're canonically the same text.
    #expect(JSCollation.localeCompare("\u{16D63}\u{16D67}\u{16D68}", "\u{16D6A}\u{16D67}") == 0)
  }

  @Test func completelyIgnorableCodePointsDontCount() {
    #expect(JSCollation.localeCompare("ab", "a\u{200B}b") == 0)
    #expect(JSCollation.localeCompare("ab", "ab\u{0}") == 0)
    #expect(JSCollation.localeCompare("ab", "a\u{AD}b") == 0)
  }

  @Test func theLocaleDoesntChangeTheOrder() {
    for locale in AppLocale.localeChoices {
      #expect(JSCollation.localeCompare("Ärger", "Arger", locale: locale) == 1)
      #expect(JSCollation.localeCompare("Ärger", "Zebra", locale: locale) == -1)
    }
  }

  @Test func theTableCoversEveryAssignedCodePoint() {
    let table = JSCollation.table
    #expect(table.entries.count > 36_000)
    #expect(table.implicitOrder(0x4E00) != nil, "Han ideographs come in the collator's order")
    #expect(table.implicitOrder(0x0041) == nil)
    #expect(table.decompositions[0xE9] == [0x65, 0x301])
    #expect(table.combiningClass[0x301] != nil)
    #expect(table.combiningClass[0x61] == nil)
  }

  @Test func contractionsAcrossMarksThatDontBlockThem() {
    // ෝ is ෙ, ා and ්; a nukta canonical order puts before the ් doesn't
    // stop them weighing as one.
    #expect(JSCollation.localeCompare("\u{DD9}\u{DCF}\u{93C}\u{DCA}", "\u{DDD}\u{93C}") == 0)
    // A mark of the same class in between blocks it.
    #expect(JSCollation.localeCompare("\u{DD9}\u{DCF}\u{DCA}", "\u{DD9}\u{DCF}\u{94D}\u{DCA}") != 0)
  }
}
