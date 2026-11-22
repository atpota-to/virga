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
// with each option the app passes and in each locale it offers.

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
    /// An accent alone: its secondary weight, and its case rank.
    case mark(UInt32, rank: UInt32)
    /// A run of other code points: a compatibility form (ﬁ, ½) whose first
    /// part weighs the case `slot`, or with `accented` a letter like æ, an
    /// accent after its first part and its parts heavier than every case.
    case expansion([UInt32], accented: Bool, slot: UInt32?)
    /// A base letter's primary weight, the accent that sets it apart from
    /// the first of its base letters, and its case rank.
    case weights(p: UInt64, mark: UInt32?, rank: UInt32)
  }

  /// How much heavier the case of an accented expansion's parts is (Æ after AE).
  static let expansionCase: UInt32 = 0x80

  /// A case rank's tertiary weight. Ranks sit two apart so that the case
  /// of a compatibility form fits between two of its letter's own: ICU
  /// weighs ﬁ's parts after the small f and ｆ and before ⓕ and F, so ﬁ
  /// sorts after "fI" and before "Fi".
  static func tertiary(_ rank: UInt32) -> UInt32 { 2 * rank + 1 }

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
    /// Contractions by the first code point of their decomposition, longest first.
    var contractions: [UInt32: [(parts: [UInt32], cp: UInt32)]] = [:]
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
      table.contractions[parts[0], default: []].append((parts, cp))
    }
    for (first, list) in table.contractions {
      table.contractions[first] = list.sorted { $0.parts.count > $1.parts.count }
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
      var rest = item[item.index(after: eq)...]
      let accented = rest.hasSuffix("!")
      if accented { rest = rest.dropLast() }
      var slot: UInt32?
      if let at = rest.firstIndex(of: "@") {
        slot = hex(rest[rest.index(after: at)...])
        rest = rest[..<at]
      }
      table.entries[cp] = .expansion(rest.split(separator: ",").compactMap { hex($0) }, accented: accented, slot: slot)
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
      let rank = parts.count > 1 ? hex(parts[1]) ?? 0 : 0
      for k in 0..<count { table.entries[cp + k] = .mark(w + k, rank: rank) }
    } else {
      let parts = value.split(separator: ".", omittingEmptySubsequences: false)
      guard parts.count == 3, let rank = hex(parts[2]) else { return }
      let mark = parts[1].isEmpty ? nil : hex(parts[1])
      if parts[0].hasPrefix("~") {
        guard let ideograph = hex(parts[0].dropFirst()), let order = table.implicitOrder(ideograph) else { return }
        for k in 0..<count { table.entries[cp + k] = .weights(p: implicitPrimary(order), mark: mark, rank: rank) }
      } else {
        guard let p = hex(parts[0]) else { return }
        for k in 0..<count { table.entries[cp + k] = .weights(p: primary(p + k), mark: mark, rank: rank) }
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
      if let candidates = table.contractions[cps[i]] { contract(candidates, at: i, in: &cps, table: table) }
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

  /// Puts the contraction starting at `i` back together: its parts become
  /// the one code point the table weighs. The parts in a row, or (UCA
  /// S2.1) a first code point and a mark further on that nothing between
  /// blocks, as with the shadda in و + ّ + ٔ (canonical order puts it
  /// before the hamza of ؤ).
  static func contract(
    _ candidates: [(parts: [UInt32], cp: UInt32)], at i: Int, in cps: inout [UInt32], table: Table
  ) {
    for candidate in candidates {
      let n = candidate.parts.count
      guard i + n <= cps.count, cps[i..<(i + n)].elementsEqual(candidate.parts) else { continue }
      cps.replaceSubrange(i..<(i + n), with: [candidate.cp])
      return
    }
    // A mark is unblocked when no code point between it and the first has
    // combining class 0 or one at least its own.
    var highest: UInt8 = 0
    var j = i + 1
    while j < cps.count {
      let ccc = table.combiningClass[cps[j]] ?? 0
      if ccc == 0 { break }
      if ccc > highest || j == i + 1,
        let candidate = candidates.first(where: { $0.parts.count == 2 && $0.parts[1] == cps[j] })
      {
        cps.remove(at: j)
        cps[i] = candidate.cp
        return
      }
      highest = Swift.max(highest, ccc)
      j += 1
    }
  }

  /// Appends the elements `cp` weighs: its case rank's own tertiary plus
  /// `caseBoost`, or `slot` for every element (an expansion's parts).
  static func append(_ cp: UInt32, to out: inout [Element], caseBoost: UInt32 = 0, slot: UInt32? = nil) {
    func t(_ rank: UInt32) -> UInt32 { slot ?? tertiary(rank) + caseBoost }
    let table = Self.table
    guard let entry = table.entries[cp] else {
      let p = table.implicitOrder(cp).map(implicitPrimary) ?? unassignedPrimary(cp)
      out.append(Element(p: p, s: common, t: t(0)))
      return
    }
    switch entry {
    case .ignorable:
      return
    case .mark(let s, let rank):
      out.append(Element(p: 0, s: s, t: t(rank)))
    case .expansion(let parts, let accented, let partSlot):
      for (index, part) in parts.enumerated() {
        if let partSlot = slot ?? partSlot, !accented {
          // The first part's case is the one read from the collator; the
          // rest keep their own (ǅ is D and a small z), a step heavier.
          if index == 0 { append(part, to: &out, slot: partSlot) } else { append(part, to: &out, caseBoost: caseBoost + 1) }
        } else {
          append(part, to: &out, caseBoost: caseBoost + expansionCase, slot: slot)
        }
        if index == 0 && accented { out.append(Element(p: 0, s: expansionAccent, t: t(0))) }
      }
    case .weights(let p, let mark, let rank):
      out.append(Element(p: p, s: common, t: t(rank)))
      if let mark { out.append(Element(p: 0, s: mark, t: t(0))) }
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
