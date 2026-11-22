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
// table.mjs): text is decomposed canonically, the decompositions the
// collator weighs as letters of their own put back together (й, أ, ো:
// contractions), each code point gives its weights, and the three levels
// are compared in turn. The table covers
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
    /// A run of other code points: a compatibility form (ﬁ, ½) whose first
    /// part weighs the case `slot`, or with `accented` a letter like æ, an
    /// accent after its first part and its parts heavier than every case.
    case expansion([UInt32], accented: Bool, slot: UInt32?)
    case weights(p: UInt32, mark: UInt32?, t: UInt32)
  }

  static let common: UInt32 = 0x20
  /// The accent between an expansion's first two parts (æ is not ae).
  static let expansionAccent: UInt32 = 0x1FF
  /// How much heavier the case of an accented expansion's parts is (Æ after AE).
  static let expansionCase: UInt32 = 0x80

  /// A case rank's tertiary weight. Ranks sit two apart so that the case
  /// of a compatibility form fits between two of its letter's own: ICU
  /// weighs ﬁ's parts after the small f and ｆ and before ⓕ and F, so ﬁ
  /// sorts after "fI" and before "Fi".
  static func tertiary(_ rank: UInt32) -> UInt32 { 2 * rank + 1 }

  static let table: [UInt32: Entry] = parse(tableSource)

  static func parse(_ source: String) -> [UInt32: Entry] {
    var out: [UInt32: Entry] = [:]
    for entry in source.split(whereSeparator: { $0 == ";" || $0 == "\n" }) {
      if let eq = entry.firstIndex(of: "=") {
        guard let cp = UInt32(entry[..<eq], radix: 16) else { continue }
        var rest = entry[entry.index(after: eq)...]
        let accented = rest.hasSuffix("!")
        if accented { rest = rest.dropLast() }
        var slot: UInt32?
        if let at = rest.firstIndex(of: "@") {
          slot = UInt32(rest[rest.index(after: at)...], radix: 16)
          rest = rest[..<at]
        }
        out[cp] = .expansion(rest.split(separator: ",").compactMap { UInt32($0, radix: 16) }, accented: accented, slot: slot)
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

  /// The table's contractions, by the first code point of their canonical
  /// decomposition: a code point the table lists that decomposes is one
  /// the collator weighs as a letter of its own (й is not и with a breve,
  /// أ not ا with a hamza, ো not two vowel signs). Longest first.
  static let contractions: [UInt32: [(parts: [UInt32], cp: UInt32)]] = {
    var out: [UInt32: [(parts: [UInt32], cp: UInt32)]] = [:]
    for cp in table.keys.sorted() {
      guard let scalar = Unicode.Scalar(cp) else { continue }
      let parts = String(scalar).decomposedStringWithCanonicalMapping.unicodeScalars.map(\.value)
      guard parts.count > 1 else { continue }
      out[parts[0], default: []].append((parts, cp))
    }
    return out.mapValues { list in list.sorted { $0.parts.count > $1.parts.count } }
  }()

  static func elements(_ text: String) -> [Element] {
    var scalars = Array(text.decomposedStringWithCanonicalMapping.unicodeScalars)
    var out: [Element] = []
    var i = 0
    while i < scalars.count {
      if let candidates = contractions[scalars[i].value] { contract(candidates, at: i, in: &scalars) }
      append(scalars[i], to: &out)
      i += 1
    }
    return out
  }

  /// Puts the contraction starting at `i` back together: its parts become
  /// the one code point the table weighs. The parts in a row, or (UCA
  /// S2.1) a first code point and a mark further on that nothing between
  /// blocks, as with the shadda in و + ّ + ٔ (canonical order puts it
  /// before the hamza of ؤ).
  static func contract(_ candidates: [(parts: [UInt32], cp: UInt32)], at i: Int, in scalars: inout [Unicode.Scalar]) {
    for candidate in candidates {
      let n = candidate.parts.count
      guard i + n <= scalars.count, zip(candidate.parts, scalars[i..<(i + n)]).allSatisfy({ $0 == $1.value }) else {
        continue
      }
      guard let cp = Unicode.Scalar(candidate.cp) else { return }
      scalars.replaceSubrange(i..<(i + n), with: [cp])
      return
    }
    // A mark is unblocked when no code point between it and the first has
    // combining class 0 or one at least its own.
    var highest: UInt8 = 0
    var j = i + 1
    while j < scalars.count {
      let ccc = scalars[j].properties.canonicalCombiningClass.rawValue
      if ccc == 0 { break }
      if ccc > highest || j == i + 1,
        let candidate = candidates.first(where: { $0.parts.count == 2 && $0.parts[1] == scalars[j].value }),
        let cp = Unicode.Scalar(candidate.cp)
      {
        scalars.remove(at: j)
        scalars[i] = cp
        return
      }
      highest = Swift.max(highest, ccc)
      j += 1
    }
  }

  /// Appends the elements `scalar` weighs: its case rank's own tertiary
  /// plus `caseBoost`, or `slot` for every element (an expansion's parts).
  static func append(_ scalar: Unicode.Scalar, to out: inout [Element], caseBoost: UInt32 = 0, slot: UInt32? = nil) {
    func t(_ rank: UInt32) -> UInt32 { slot ?? tertiary(rank) + caseBoost }
    let cp = scalar.value
    if let entry = table[cp] {
      switch entry {
      case .ignorable:
        return
      case .mark(let s):
        out.append(Element(p: 0, s: s, t: t(0)))
      case .expansion(let parts, let accented, let partSlot):
        for (index, part) in parts.enumerated() {
          guard let next = Unicode.Scalar(part) else { continue }
          if let partSlot = slot ?? partSlot, !accented {
            // The first part's case is the one read from the collator; the
            // rest keep their own (ǅ is D and a small z), a step heavier.
            if index == 0 { append(next, to: &out, slot: partSlot) } else { append(next, to: &out, caseBoost: caseBoost + 1) }
          } else {
            append(next, to: &out, caseBoost: caseBoost + expansionCase, slot: slot)
          }
          if index == 0 && accented { out.append(Element(p: 0, s: expansionAccent, t: t(0))) }
        }
      case .weights(let p, let mark, let rank):
        out.append(Element(p: primary(p), s: common, t: t(rank)))
        if let mark { out.append(Element(p: 0, s: mark, t: t(0))) }
      }
      return
    }
    let properties = scalar.properties
    switch properties.generalCategory {
    case .control, .format, .surrogate, .privateUse, .unassigned:
      return
    case .nonspacingMark, .spacingMark, .enclosingMark:
      out.append(Element(p: 0, s: 0x400 + (cp & 0x3FF), t: t(0)))
    case .decimalNumber:
      // Every script's digits weigh what the ASCII digit of the same value does.
      if let value = properties.numericValue, value >= 0, value <= 9,
        let digit = Unicode.Scalar(0x30 + UInt32(value)), table[digit.value] != nil
      {
        append(digit, to: &out, caseBoost: caseBoost, slot: slot)
      } else {
        out.append(Element(p: otherLetter(cp), s: common, t: t(0)))
      }
    case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter, .letterNumber,
      .otherNumber:
      if properties.isIdeographic {
        out.append(Element(p: han(cp), s: common, t: t(0)))
        return
      }
      // Case is a tertiary difference: a capital weighs its small letter's
      // primary.
      let lower = properties.lowercaseMapping.unicodeScalars
      if lower.count == 1, let small = lower.first, small.value != cp {
        out.append(Element(p: otherLetter(small.value), s: common, t: t(1)))
      } else {
        out.append(Element(p: otherLetter(cp), s: common, t: t(0)))
      }
    default:
      out.append(Element(p: otherSymbol(cp), s: common, t: t(0)))
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
