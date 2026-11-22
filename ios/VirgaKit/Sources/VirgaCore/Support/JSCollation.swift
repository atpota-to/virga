// `String.prototype.localeCompare`, as the web calls it: plainly
// (`a.localeCompare(b)`: the reports' ties, the composer's language list,
// rkeys) and at base strength (`a.localeCompare(b, undefined,
// { sensitivity: 'base' })`: template groups and names, the library's
// names).
//
// JavaScript hands this to ICU's collator, which sorts by the Unicode
// Collation Algorithm over CLDR's root order, at three levels: the base
// letter first ("a" before "b" whatever the case or accent), then the
// accents ("e" before "é"), then the case and form ("a" before "A", "a"
// before "ａ"). Base strength stops after the first. Punctuation and
// symbols are not skipped: they sort before digits, digits before letters.
// Swift's own comparisons are by code point (`<`) or by Foundation's ICU
// (`compare(_:options:range:locale:)`), whose answers differ from Node's
// and between Apple's platforms and Linux, so neither gives the web's
// order.
//
// This is that algorithm over a table read from Node's own collator
// (JSCollationTable.swift, written by ios/scripts/generate-collation-
// table.mjs), the same on every platform: text is decomposed canonically
// (by the table's own decompositions and combining classes, not the
// platform's), the decompositions the collator weighs as letters of their
// own put back together (й, أ, ো: contractions), a Thai or Lao vowel
// written before its consonant weighed after it, each code point gives
// its weights, and the levels are compared in turn. Every assigned code
// point is in the table; the ideographs come in the collator's own order
// (Han by radical and stroke), and unassigned and private-use code points
// after them by code point, as ICU weighs them.
// ios/parity/cases/core.collation.js holds the result to localeCompare,
// with each option the app passes and in each locale it offers. The one
// deliberate difference: Node's collator isn't canonically closed for the
// Kirat Rai vowel signs U+16D68..U+16D6A (their decompositions are runs of
// starters), so it can sort canonically equal text apart there; this
// sorts it together, as the algorithm says.

public enum JSCollation {
  /// The `sensitivity` the web passes.
  public enum Sensitivity: Sendable, Hashable {
    /// `{ sensitivity: 'base' }`: base letters only, not accents or case.
    case base
    /// The default: base letters, then accents, then case and form.
    case variant
  }

  /// `a.localeCompare(b, locale, { sensitivity })`: -1, 0 or 1.
  ///
  /// `locale` is the one the web passes, nil for `undefined` (the
  /// runtime's). Every locale the app offers (`AppLocale.localeChoices`,
  /// English in each region) collates in CLDR's root order, which is what
  /// the table holds, so it doesn't change the answer. A locale with an
  /// order of its own (Swedish, Turkish, German phone-book order) would
  /// need a tailoring this doesn't have, and gets root order too.
  public static func localeCompare(
    _ a: String, _ b: String, locale: String? = nil, sensitivity: Sensitivity = .variant
  ) -> Int {
    if a.utf16.elementsEqual(b.utf16) { return 0 }
    return compare(elements(a), elements(b), through: sensitivity == .base ? 1 : 3)
  }

  // MARK: Weights

  /// One collation element: a primary (base letter) weight, a secondary
  /// (accent) and a tertiary (case and form). A primary of zero is an
  /// accent alone.
  struct Element: Hashable, Sendable {
    var p: UInt64
    var s: UInt32
    var t: UInt32
  }

  enum Entry: Sendable {
    case ignorable
    /// An accent alone: its secondary weight, and its tertiary.
    case mark(UInt32, t: UInt32)
    /// A run of other code points (or contractions), each weighing as it
    /// does, but from part `from` on, which weigh `cases` (a compatibility
    /// form's: ICU weighs ﬁ's f after the small f and ｆ and before ⓕ and
    /// F, so ﬁ sorts after "fI" and before "Fi"; parts past the end of
    /// `cases` are a step heavier than their own). With an `accent`, a
    /// letter like æ: that accent after its first part, which weighs
    /// `cases[0]`, and the rest of its parts heavier than every case.
    case expansion([UInt32], accent: UInt32?, from: Int?, cases: [PartCase])
    /// A base letter's primary weight, the accent that sets it apart from
    /// the first of its base letters, and its tertiary (case and form).
    case weights(p: UInt64, mark: UInt32?, t: UInt32)
  }

  /// What a part of an expansion weighs for its case.
  enum PartCase: Sendable, Hashable {
    /// Its own tertiary.
    case own
    /// A step heavier than its own: what nothing can weigh it against.
    case step
    /// That tertiary, read from the collator.
    case value(UInt32)
  }

  /// The primary weight of a table rank: ranks sit 2³² apart, so that the
  /// ideographs (in their order) and the code points weighed by code point
  /// fit after theirs.
  static func primary(_ rank: UInt32) -> UInt64 { UInt64(rank) << 32 }

  /// The primary weight of the ideograph at `order` in the collator's order.
  static func implicitPrimary(_ order: UInt32) -> UInt64 { primary(implicitRank) + UInt64(order) }

  /// A code point the table doesn't list (unassigned, private use): after
  /// every ideograph, by code point.
  static func unassignedPrimary(_ cp: UInt32) -> UInt64 { primary(unassignedRank) + UInt64(cp) }

  // MARK: The table

  struct Table: Sendable {
    var entries: [UInt32: Entry] = [:]
    /// The ideographs as runs of consecutive code points, by first code
    /// point: (first, count, the first's place in the collator's order).
    var implicitRuns: [(first: UInt32, count: UInt32, order: UInt32)] = []
    var decompositions: [UInt32: [UInt32]] = [:]
    var combiningClass: [UInt32: UInt8] = [:]
    /// The runs of code points the collator weighs as one (contractions),
    /// with the code the table weighs each under, and every run's prefixes.
    var contractions: [[UInt32]: UInt32] = [:]
    var contractionPrefixes: Set<[UInt32]> = []
    /// The vowels weighed after the consonant they're written before, with those consonants.
    var swaps: [UInt32: Set<UInt32>] = [:]

    func implicitOrder(_ cp: UInt32) -> UInt32? {
      var lo = 0
      var hi = implicitRuns.count
      while lo < hi {
        let mid = (lo + hi) / 2
        if implicitRuns[mid].first <= cp { lo = mid + 1 } else { hi = mid }
      }
      guard lo > 0 else { return nil }
      let run = implicitRuns[lo - 1]
      return cp - run.first < run.count ? run.order + (cp - run.first) : nil
    }
  }

  static let table: Table = {
    var table = Table()
    // The ideographs first: `~i` entries weigh what ideograph i does.
    var order: UInt32 = 0
    for item in items(implicitSource) {
      let parts = item.split(separator: "+")
      guard let first = hex(parts[0]) else { continue }
      let count = parts.count > 1 ? hex(parts[1]) ?? 1 : 1
      table.implicitRuns.append((first, count, order))
      order += count
    }
    table.implicitRuns.sort { $0.first < $1.first }
    for item in items(tableSource) { parseEntry(item, into: &table) }
    for item in items(decompositionSource) {
      guard let (cp, parts) = mapping(item) else { continue }
      table.decompositions[cp] = parts
    }
    for item in items(combiningClassSource) {
      guard let (cp, value, count) = run(item) else { continue }
      for k in 0..<count { table.combiningClass[cp + k] = UInt8(truncatingIfNeeded: value) }
    }
    for item in items(contractionSource) {
      guard let (cp, parts) = mapping(item) else { continue }
      table.contractions[parts] = cp
      for n in 1...parts.count { table.contractionPrefixes.insert(Array(parts.prefix(n))) }
    }
    for item in items(swapSource) {
      guard let gt = item.firstIndex(of: ">"), let vowel = hex(item[..<gt]) else { continue }
      var consonants = Set<UInt32>()
      for range in item[item.index(after: gt)...].split(separator: ",") {
        let ends = range.split(separator: "-").compactMap { hex($0) }
        guard let low = ends.first else { continue }
        for cp in low...(ends.last ?? low) { consonants.insert(cp) }
      }
      table.swaps[vowel] = consonants
    }
    return table
  }()

  static func items(_ source: String) -> [Substring] {
    source.split(whereSeparator: { $0 == ";" || $0 == "\n" })
  }

  static func hex(_ text: Substring) -> UInt32? { UInt32(text, radix: 16) }

  /// `code=a,b,…`.
  static func mapping(_ item: Substring) -> (UInt32, [UInt32])? {
    guard let eq = item.firstIndex(of: "="), let cp = hex(item[..<eq]) else { return nil }
    let parts = item[item.index(after: eq)...].split(separator: ",").compactMap { hex($0) }
    return parts.isEmpty ? nil : (cp, parts)
  }

  /// `code:value` or `code:value*count`.
  static func run(_ item: Substring) -> (UInt32, UInt32, UInt32)? {
    guard let colon = item.firstIndex(of: ":"), let cp = hex(item[..<colon]) else { return nil }
    var value = item[item.index(after: colon)...]
    var count: UInt32 = 1
    if let star = value.firstIndex(of: "*") {
      count = hex(value[value.index(after: star)...]) ?? 1
      value = value[..<star]
    }
    guard let number = hex(value) else { return nil }
    return (cp, number, count)
  }

  static func parseEntry(_ item: Substring, into table: inout Table) {
    if let eq = item.firstIndex(of: "="), !item[..<eq].contains(":") {
      guard let cp = hex(item[..<eq]) else { return }
      // `a,b,…`, then `!accent` and `@from:case/case/…` (a tertiary, `=`
      // its own, empty a step heavier), each when present.
      var rest = item[item.index(after: eq)...]
      var from: Int?
      var cases: [PartCase] = []
      if let sign = rest.firstIndex(of: "@") {
        let place = rest[rest.index(after: sign)...].split(separator: ":", omittingEmptySubsequences: false)
        from = hex(place[0]).map(Int.init)
        if place.count > 1 {
          cases = place[1].split(separator: "/", omittingEmptySubsequences: false).map { text in
            text == "=" ? .own : hex(text).map(PartCase.value) ?? .step
          }
        }
        rest = rest[..<sign]
      }
      var accent: UInt32?
      if let bang = rest.firstIndex(of: "!") {
        accent = hex(rest[rest.index(after: bang)...])
        rest = rest[..<bang]
      }
      let parts = rest.split(separator: ",").compactMap { hex($0) }
      table.entries[cp] = .expansion(parts, accent: accent, from: from, cases: cases)
      return
    }
    guard let colon = item.firstIndex(of: ":"), let cp = hex(item[..<colon]) else { return }
    var value = item[item.index(after: colon)...]
    var count: UInt32 = 1
    if let star = value.firstIndex(of: "*") {
      count = hex(value[value.index(after: star)...]) ?? 1
      value = value[..<star]
    }
    if value == "I" {
      for k in 0..<count { table.entries[cp + k] = .ignorable }
    } else if value.hasPrefix("M") {
      let parts = value.dropFirst().split(separator: ".")
      guard let w = parts.first.flatMap(hex) else { return }
      let t = parts.count > 1 ? hex(parts[1]) ?? plainTertiary : plainTertiary
      for k in 0..<count { table.entries[cp + k] = .mark(w + k, t: t) }
    } else {
      let parts = value.split(separator: ".", omittingEmptySubsequences: false)
      guard parts.count == 3, let t = hex(parts[2]) else { return }
      let mark = parts[1].isEmpty ? nil : hex(parts[1])
      if parts[0].hasPrefix("~") {
        guard let ideograph = hex(parts[0].dropFirst()), let order = table.implicitOrder(ideograph) else { return }
        for k in 0..<count { table.entries[cp + k] = .weights(p: implicitPrimary(order), mark: mark, t: t) }
      } else {
        guard let p = hex(parts[0]) else { return }
        for k in 0..<count { table.entries[cp + k] = .weights(p: primary(p + k), mark: mark, t: t) }
      }
    }
  }

  // MARK: Taking text apart

  static let hangulFirst: UInt32 = 0xAC00
  static let hangulCount: UInt32 = 11172

  /// The canonical decomposition of `text` (NFD), by the table.
  static func decompose(_ text: String) -> [UInt32] {
    let table = Self.table
    var out: [UInt32] = []
    out.reserveCapacity(text.utf16.count)
    for scalar in text.unicodeScalars {
      let cp = scalar.value
      if cp >= hangulFirst && cp < hangulFirst + hangulCount {
        let index = cp - hangulFirst
        out.append(0x1100 + index / 588)
        out.append(0x1161 + (index % 588) / 28)
        if index % 28 != 0 { out.append(0x11A7 + index % 28) }
      } else if let parts = table.decompositions[cp] {
        out.append(contentsOf: parts)
      } else {
        out.append(cp)
      }
    }
    // Canonical order: marks in a row sorted by class, stably.
    var i = 1
    while i < out.count {
      let ccc = table.combiningClass[out[i]] ?? 0
      if ccc != 0 {
        var j = i
        while j > 0, let before = table.combiningClass[out[j - 1]], before > ccc {
          out.swapAt(j - 1, j)
          j -= 1
        }
      }
      i += 1
    }
    return out
  }

  static func elements(_ text: String) -> [Element] {
    let table = Self.table
    var cps = decompose(text)
    var out: [Element] = []
    out.reserveCapacity(cps.count)
    var i = 0
    while i < cps.count {
      if table.contractionPrefixes.contains([cps[i]]) { contract(at: i, in: &cps, table: table) }
      if let consonants = table.swaps[cps[i]], i + 1 < cps.count, consonants.contains(cps[i + 1]) {
        append(cps[i + 1], to: &out)
        append(cps[i], to: &out)
        i += 2
        continue
      }
      append(cps[i], to: &out)
      i += 1
    }
    return out
  }

  /// Puts the contraction starting at `i` back together (UCA S2.1): the
  /// longest run in a row the table weighs as one, then the marks further
  /// on that nothing skipped blocks and that make a longer one, as with the
  /// shadda in و + ّ + ٔ (canonical order puts it before the hamza of ؤ) or
  /// ෝ's al-lakuna after a nukta. The contraction's code takes the first
  /// code point's place and the rest of its parts go; skipped marks stay.
  static func contract(at i: Int, in cps: inout [UInt32], table: Table) {
    var matched = [cps[i]]
    var used: [Int] = []
    var best: (cp: UInt32, used: [Int])?
    var k = i + 1
    while k < cps.count, table.contractionPrefixes.contains(matched + [cps[k]]) {
      matched.append(cps[k])
      used.append(k)
      if let cp = table.contractions[matched] { best = (cp, used) }
      k += 1
    }
    // A mark is blocked by one skipped before it whose class is at least its own.
    var skipped: UInt8 = 0
    while k < cps.count, let ccc = table.combiningClass[cps[k]], ccc != 0 {
      if ccc > skipped, table.contractionPrefixes.contains(matched + [cps[k]]) {
        matched.append(cps[k])
        used.append(k)
        if let cp = table.contractions[matched] { best = (cp, used) }
      } else {
        skipped = Swift.max(skipped, ccc)
      }
      k += 1
    }
    guard let best else { return }
    cps[i] = best.cp
    for index in best.used.reversed() { cps.remove(at: index) }
  }

  /// Appends the elements `cp` weighs: each its own tertiary plus
  /// `caseBoost`, or `slot` for every element (an expansion's first part).
  static func append(_ cp: UInt32, to out: inout [Element], caseBoost: UInt32 = 0, slot: UInt32? = nil) {
    func t(_ own: UInt32) -> UInt32 { slot ?? own + caseBoost }
    let table = Self.table
    guard let entry = table.entries[cp] else {
      let p = table.implicitOrder(cp).map(implicitPrimary) ?? unassignedPrimary(cp)
      out.append(Element(p: p, s: common, t: t(plainTertiary)))
      return
    }
    switch entry {
    case .ignorable:
      return
    case .mark(let s, let own):
      out.append(Element(p: 0, s: s, t: t(own)))
    case .expansion(let parts, let accent, let from, let cases):
      for (index, part) in parts.enumerated() {
        if let accent, index > 0 {
          append(part, to: &out, caseBoost: caseBoost + expansionCase, slot: slot)
          continue
        }
        let partCase: PartCase
        if let from, index >= from {
          partCase = index - from < cases.count ? cases[index - from] : .step
        } else {
          partCase = .own
        }
        switch partCase {
        case .own: append(part, to: &out, caseBoost: caseBoost, slot: slot)
        case .step: append(part, to: &out, caseBoost: caseBoost + 1, slot: slot)
        case .value(let value): append(part, to: &out, slot: slot ?? value)
        }
        if index == 0, let accent { out.append(Element(p: 0, s: accent, t: t(plainTertiary))) }
      }
    case .weights(let p, let mark, let own):
      out.append(Element(p: p, s: common, t: t(own)))
      if let mark { out.append(Element(p: 0, s: mark, t: t(plainTertiary))) }
    }
  }

  // MARK: Comparing

  /// Compares level by level, through `levels` (1: base letters only).
  static func compare(_ a: [Element], _ b: [Element], through levels: Int) -> Int {
    var x: [UInt64] = []
    var y: [UInt64] = []
    for level in 1...levels {
      x.removeAll(keepingCapacity: true)
      y.removeAll(keepingCapacity: true)
      for e in a { if let w = weight(e, level) { x.append(w) } }
      for e in b { if let w = weight(e, level) { y.append(w) } }
      if x == y { continue }
      return x.lexicographicallyPrecedes(y) ? -1 : 1
    }
    return 0
  }

  static func weight(_ e: Element, _ level: Int) -> UInt64? {
    switch level {
    case 1: e.p == 0 ? nil : e.p
    case 2: e.s == 0 ? nil : UInt64(e.s)
    default: e.t == 0 ? nil : UInt64(e.t)
    }
  }
}
