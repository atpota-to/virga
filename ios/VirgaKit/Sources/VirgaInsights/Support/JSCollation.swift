// `a.localeCompare(b)` with no locale: the order the reports break ties in
// (tags, linked sites, languages and list names by name).
//
// JavaScript hands this to ICU's collator, which sorts by the Unicode
// Collation Algorithm over CLDR's root order, at three levels: the base
// letter first ("a" before "b" whatever the case or accent), then the
// accents ("e" before "é"), then the case ("a" before "A"). Punctuation and
// symbols are not skipped: they sort before digits, digits before letters.
// Swift's own comparisons are by code point (`<`) or by the device's
// locale (`localizedCompare`, not the same on Linux and iOS), so neither
// gives the web's order.
//
// This is that algorithm over a table read from Node's own collator
// (JSCollationTable.swift, written by ios/scripts/generate-collation-
// table.mjs): text is decomposed canonically, each code point gives its
// weights, and the three levels are compared in turn. The table covers
// Latin, Greek, Cyrillic, Hebrew, Arabic, Devanagari, Hangul jamo, kana,
// punctuation, symbols and emoji; other letters sort after the table's in
// code point order (Han ideographs last, as ICU puts them), and other
// symbols just before the digits. ios/parity/cases/insights.collation.js
// holds the result to localeCompare itself.

import Foundation
import VirgaCore

public enum JSCollation {
  /// `a.localeCompare(b)`: negative, zero or positive, as -1, 0 or 1.
  public static func localeCompare(_ a: String, _ b: String) -> Int {
    if a.utf16.elementsEqual(b.utf16) { return 0 }
    return compare(elements(a), elements(b))
  }

  /// One collation element: a primary (base letter) weight, a secondary
  /// (accent) and a tertiary (case). A primary of zero is an accent alone.
  struct Element: Hashable {
    var p: UInt64
    var s: UInt32
    var t: UInt32
  }

  enum Entry {
    case ignorable
    case mark(UInt32)
    case expansion([UInt32], accented: Bool)
    case weights(p: UInt32, mark: UInt32?, t: UInt32)
  }

  static let common: UInt32 = 0x20
  /// The accent between an expansion's first two parts (æ is not ae).
  static let expansionAccent: UInt32 = 0x1FF
  /// How much heavier the case of an expansion's parts is (ﬁ after fi).
  static let expansionCase: UInt32 = 0x40

  static let table: [UInt32: Entry] = parse(tableSource)

  static func parse(_ source: String) -> [UInt32: Entry] {
    var out: [UInt32: Entry] = [:]
    for entry in source.split(whereSeparator: { $0 == ";" || $0 == "\n" }) {
      if let eq = entry.firstIndex(of: "=") {
        guard let cp = UInt32(entry[..<eq], radix: 16) else { continue }
        var rest = entry[entry.index(after: eq)...]
        let accented = rest.hasSuffix("!")
        if accented { rest = rest.dropLast() }
        out[cp] = .expansion(rest.split(separator: ",").compactMap { UInt32($0, radix: 16) }, accented: accented)
        continue
      }
      guard let colon = entry.firstIndex(of: ":"), let cp = UInt32(entry[..<colon], radix: 16) else { continue }
      let value = entry[entry.index(after: colon)...]
      if value == "I" {
        out[cp] = .ignorable
      } else if value.hasPrefix("M") {
        out[cp] = UInt32(value.dropFirst(), radix: 16).map(Entry.mark) ?? .ignorable
      } else {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, let p = UInt32(parts[0], radix: 16), let t = UInt32(parts[2], radix: 16) else { continue }
        out[cp] = .weights(p: p, mark: parts[1].isEmpty ? nil : UInt32(parts[1], radix: 16), t: t)
      }
    }
    return out
  }

  /// The primary weight of a table rank; ranks sit 2²² apart so that code
  /// points the table doesn't cover fit between them.
  static func primary(_ rank: UInt32) -> UInt64 { UInt64(rank) << 22 }

  /// A symbol the table doesn't cover: after every symbol it does, before '0'.
  static func otherSymbol(_ cp: UInt32) -> UInt64 { primary(digitPrimary - 1) + (1 << 21) + UInt64(cp) }

  /// A letter the table doesn't cover: after every letter it does.
  static func otherLetter(_ cp: UInt32) -> UInt64 { primary(topPrimary + 1) + UInt64(cp) }

  /// A Han ideograph: last of all, in code point order (ICU's implicit weights).
  static func han(_ cp: UInt32) -> UInt64 { primary(topPrimary + 2) + UInt64(cp) }

  static func elements(_ text: String) -> [Element] {
    var out: [Element] = []
    for scalar in text.decomposedStringWithCanonicalMapping.unicodeScalars {
      append(scalar, to: &out)
    }
    return out
  }

  static func append(_ scalar: Unicode.Scalar, to out: inout [Element], caseBoost: UInt32 = 0) {
    let cp = scalar.value
    if let entry = table[cp] {
      switch entry {
      case .ignorable:
        return
      case .mark(let s):
        out.append(Element(p: 0, s: s, t: caseBoost))
      case .expansion(let parts, let accented):
        for (index, part) in parts.enumerated() {
          guard let next = Unicode.Scalar(part) else { continue }
          append(next, to: &out, caseBoost: caseBoost + expansionCase)
          if index == 0 && accented { out.append(Element(p: 0, s: expansionAccent, t: caseBoost)) }
        }
      case .weights(let p, let mark, let t):
        out.append(Element(p: primary(p), s: common, t: t + caseBoost))
        if let mark { out.append(Element(p: 0, s: mark, t: caseBoost)) }
      }
      return
    }
    let properties = scalar.properties
    switch properties.generalCategory {
    case .control, .format, .surrogate, .privateUse, .unassigned:
      return
    case .nonspacingMark, .spacingMark, .enclosingMark:
      out.append(Element(p: 0, s: 0x400 + (cp & 0x3FF), t: caseBoost))
    case .decimalNumber:
      // Every script's digits weigh what the ASCII digit of the same value does.
      if let value = properties.numericValue, value >= 0, value <= 9,
        let digit = Unicode.Scalar(0x30 + UInt32(value)), table[digit.value] != nil
      {
        append(digit, to: &out, caseBoost: caseBoost)
      } else {
        out.append(Element(p: otherLetter(cp), s: common, t: caseBoost))
      }
    case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter, .letterNumber,
      .otherNumber:
      if properties.isIdeographic {
        out.append(Element(p: han(cp), s: common, t: caseBoost))
        return
      }
      // Case is a tertiary difference: a capital weighs its small letter's
      // primary.
      let lower = properties.lowercaseMapping.unicodeScalars
      if lower.count == 1, let small = lower.first, small.value != cp {
        out.append(Element(p: otherLetter(small.value), s: common, t: caseBoost + 1))
      } else {
        out.append(Element(p: otherLetter(cp), s: common, t: caseBoost))
      }
    default:
      out.append(Element(p: otherSymbol(cp), s: common, t: caseBoost))
    }
  }

  static func compare(_ a: [Element], _ b: [Element]) -> Int {
    let levels: [(Element) -> UInt64?] = [
      { $0.p == 0 ? nil : $0.p },
      { UInt64($0.s) },
      { UInt64($0.t) },
    ]
    for weight in levels {
      let x = a.compactMap(weight)
      let y = b.compactMap(weight)
      if x == y { continue }
      return x.lexicographicallyPrecedes(y) ? -1 : 1
    }
    return 0
  }
}
