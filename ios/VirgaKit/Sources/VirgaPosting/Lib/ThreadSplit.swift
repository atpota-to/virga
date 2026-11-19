// Ports src/posting/lib/threadSplit.js
//
// Turning one over-long post into a thread.
//
// `splitIntoThread` cuts the composer's text into posts that each fit the
// limit as the composer counts it: inline links collapsed to their labels and
// links shortened (`countComposerGraphemes`), in grapheme clusters, and inside
// the lexicon's byte cap as well. The count of a post is added up from the
// counts of its words, each measured with the composer's own function, so the
// two can't disagree.
//
// Where it cuts:
// - Only between words, unless one unbroken run is longer than a whole post;
//   that run is cut between grapheme clusters, and after 。！？ in text written
//   without spaces.
// - Never inside a URL, a mention, an email address, a hashtag or an inline
//   link, and never where the cut would make one that wasn't there. One of
//   those longer than a post is left whole in a post of its own, over the
//   limit, where the composer flags it.
// - At the best breaks it can find. Every cut has a cost by what it breaks
//   (nothing for a blank line, little for a line break, more for a sentence
//   end, far more for the middle of a sentence, most for the middle of a
//   word) and every post has a small cost. The cheapest split wins; among
//   equals the earlier posts are the fuller ones.
//
// Numbering is a counter on a line of its own at the end of each post
// ("…the words of the post.\n\n2/5"). Room is kept for two digits each side,
// so numbering never changes with the count.
//
// The split is stable: `splitIntoThread(joinThread(posts, options), options)`
// gives `posts` back.
//
// Everything here indexes in UTF-16 code units, as the web does, and counts
// grapheme clusters with Swift's Character (UAX #29, as Intl.Segmenter).

import Foundation
import VirgaCore

/// How a split numbers its posts: not at all, or "2/5".
public enum ThreadNumbering: String, Codable, Hashable, Sendable, CaseIterable {
  case off
  case counter
}

/// Whether a thread's posts carry counters, and whether they are right.
public enum ThreadNumberingState: String, Codable, Hashable, Sendable {
  case none
  case current
  case stale
}

/// The counter at the end of a post.
public struct ThreadCounter: Codable, Hashable, Sendable {
  public var number: Int
  public var total: Int
  /// The text without the counter.
  public var body: String
}

public enum ThreadSplit {
  /// THREAD_NUMBERING: the ways a split can number its posts.
  public static let threadNumberingOptions: [String] = ThreadNumbering.allCases.map(\.rawValue)

  // What a cut breaks, from worst to best.
  static let hard = 0  // the middle of a word
  static let word = 1  // the middle of a sentence
  static let sentence = 2
  static let line = 3
  static let paragraph = 4

  // A post costs more than a line break and less than a sentence end.
  static let postCost: Double = 4
  static let cutCost: [Double] = [200, 30, 5, 1, 0]

  // "\n\n" and two digits each side of the slash.
  static let counterDigits = 2
  static func counterRoom(_ digits: Int) -> Int { 2 + digits * 2 + 1 }

  static let spaceButNewline = #"\t\u000B\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"#
  static let counterLine = JSRegex(#"(?:^|\n)[\#(spaceButNewline)]*([0-9]{1,4})/([0-9]{1,4})\z"#)

  /// The start of every grapheme cluster in `text`, and its end.
  static func graphemeStarts(_ text: String) -> [Int] {
    var starts: [Int] = []
    var offset = 0
    for character in text {
      starts.append(offset)
      offset += character.utf16.count
    }
    starts.append(offset)
    return starts
  }

  // MARK: Marks

  struct Mark: Hashable {
    var kind: String
    var start: Int
    var end: Int
  }

  static func isEmailLocal(_ unit: UInt16) -> Bool {
    switch unit {
    case 0x30...0x39, 0x41...0x5A, 0x61...0x7A, 0x2E, 0x5F, 0x25, 0x2B, 0x2D: return true
    default: return false
    }
  }

  /// What a cut must leave whole and must not create: inline links, URLs,
  /// mentions (an email address counts from its first letter) and hashtags.
  /// A URL or a mention straight after a quotation mark is its own kind.
  /// Anything found inside an inline link belongs to the link. URLs and
  /// mentions are found a word at a time (neither can hold whitespace).
  static func marksOf(_ text: String) -> [Mark] {
    let units = Array(text.utf16)
    let links = InlineLinks.findInlineLinks(text).map { Mark(kind: "link", start: $0.start, end: $0.end) }
    var found: [Mark] = []
    var i = 0
    while i < units.count {
      if PostingJS.isSpace(units[i]) {
        i += 1
        continue
      }
      let at = i
      while i < units.count, !PostingJS.isSpace(units[i]) { i += 1 }
      let wordUnits = Array(units[at..<i])
      // The URL matcher is slow on a long run of letters with nothing in it;
      // only words with one of these can hold a mark.
      guard wordUnits.contains(where: { $0 == 0x2E || $0 == 0x3A || $0 == 0x40 }) else { continue }
      let word = String(jsUnits: wordUnits)
      func quoted(_ start: Int) -> Bool {
        start > 0 && (wordUnits[start - 1] == 0x22 || wordUnits[start - 1] == 0x201C)
      }
      let hits = UrlMatching.findUrlsAndMentions(word)
      for u in hits.urls where UrlMatching.isValidDomain(u.matchText) {
        found.append(Mark(kind: quoted(u.charStart) ? "quoted-url" : "url", start: at + u.charStart, end: at + u.charEnd))
      }
      for m in hits.mentions {
        var start = m.start
        if m.email {
          while start > 0, isEmailLocal(wordUnits[start - 1]) { start -= 1 }
        }
        let kind = m.email ? "email" : quoted(start) ? "quoted-mention" : "mention"
        found.append(Mark(kind: kind, start: at + start, end: at + m.end))
      }
    }
    for h in Hashtags.findHashtags(text) { found.append(Mark(kind: "tag", start: h.start, end: h.end)) }
    let free = found.filter { m in !links.contains { m.start < $0.end && $0.start < m.end } }
    return links + free
  }

  static func markKey(_ m: Mark, _ offset: Int = 0) -> String {
    "\(m.kind):\(m.start - offset):\(m.end - offset)"
  }

  /// The marks as non-overlapping `[start, end)` spans, in order.
  static func protectedSpans(_ marks: [Mark]) -> [(start: Int, end: Int)] {
    let sorted = marks.map { (start: $0.start, end: $0.end) }
      .enumerated()
      .sorted { a, b in
        if a.element.start != b.element.start { return a.element.start < b.element.start }
        if a.element.end != b.element.end { return a.element.end < b.element.end }
        return a.offset < b.offset
      }
      .map(\.element)
    var spans: [(start: Int, end: Int)] = []
    for span in sorted {
      if let last = spans.last, span.start < last.end {
        spans[spans.count - 1].end = max(last.end, span.end)
      } else {
        spans.append(span)
      }
    }
    return spans
  }

  // MARK: Gaps

  // The end of a sentence, with whatever closes a quote or a bracket after it.
  static let sentenceEnd = JSRegex(#"[.!?…。！？।؟۔][)\]"'»”’」』）】]*\z"#)
  // A full stop that ends no sentence: an initial, a list number, a common
  // abbreviation. The web's `/iu` written out: its `s` also matches ſ, and
  // its `\p{L}` also matches U+0345, a combining mark that case-folds to ι.
  static let notASentence: JSRegex = {
    func ci(_ word: String) -> String {
      word.map { ch -> String in
        switch ch.lowercased() {
        case "s": return "[sS\\u017F]"
        case ".": return "\\."
        default:
          let lower = String(ch).lowercased()
          let upper = String(ch).uppercased()
          return lower == upper ? String(ch) : "[\(lower)\(upper)]"
        }
      }.joined()
    }
    let words = ["Mr", "Mrs", "Ms", "Dr", "Prof", "St", "vs", "etc", "e.g", "i.e"].map(ci).joined(separator: "|")
    return JSRegex(#"^[(\["'“‘]*(?:[\p{L}ͅ]|[0-9]+|"# + words + #")\.\z"#)
  }()
  static let startsLowercase = JSRegex(#"^\p{Ll}"#)
  // Sentence ends in text written without spaces, and what may follow one.
  static let cjkEnd = JSRegex(#"[。！？]"#)
  static let cjkTail = JSRegex(#"^[。！？…!?」』）】〉》”’"]"#)
  static let cjkClosed = JSRegex(#"[。！？][」』）】〉》”’"]*\z"#)

  /// A post that started with one of these would gain a mention or a hashtag.
  static func startsAMark(_ units: ArraySlice<UInt16>) -> Bool {
    guard let first = units.first else { return false }
    return first == 0x40 || first == 0x23 || first == 0xFF03
  }

  static func newlineCount(_ units: ArraySlice<UInt16>) -> Int {
    var count = 0
    var i = units.startIndex
    while i < units.endIndex {
      if units[i] == 0x0D {
        count += 1
        i += (i + 1 < units.endIndex && units[i + 1] == 0x0A) ? 2 : 1
      } else {
        if units[i] == 0x0A { count += 1 }
        i += 1
      }
    }
    return count
  }

  static func gapLevel(_ gap: ArraySlice<UInt16>, _ before: String, _ after: String) -> Int {
    let lines = newlineCount(gap)
    if lines >= 2 { return paragraph }
    if lines == 1 { return line }
    if sentenceEnd.test(before), !notASentence.test(before), !startsLowercase.test(after) { return sentence }
    return word
  }

  /// A run of text's count and bytes, as the composer will write it.
  static func measure(_ run: String) -> (count: Int, bytes: Int) {
    let units = Array(run.utf16)
    let plainASCII = units.allSatisfy { (0x21...0x7E).contains($0) }
    if plainASCII, run.jsIndexOf("://") < 0, run.jsIndexOf("](") < 0 {
      return (units.count, units.count)
    }
    return (InlineLinks.countComposerGraphemes(run), RichText.utf8Length(InlineLinks.composerCountText(run)))
  }

  // MARK: Breaks

  struct Break: Equatable {
    var end: Int
    var next: Int
    var level: Int
    var cEnd: Int
    var cNext: Int
    var bEnd: Int
    var bNext: Int
    var soft: Bool
  }

  struct Room {
    var count: Int
    var bytes: Int
  }

  struct Unit {
    var start: Int
    var end: Int
    var kind: Kind
    var first: Int
    enum Kind { case space, plain, mark }
  }

  /// Every place `text` could be cut, in order, with the running count and
  /// bytes on each side. A post from break `i` to break `j` is
  /// `text.slice(i.next, j.end)`, and its count is `j.cEnd - i.cNext`.
  static func findBreaks(_ text: String, _ marks: [Mark], _ room: Room) -> [Break] {
    let chars = Array(text.utf16)
    func slice(_ a: Int, _ b: Int) -> String { String(jsUnits: chars[a..<max(a, b)]) }
    let starts = graphemeStarts(text)
    let spans = protectedSpans(marks)

    // Units: a whitespace cluster, a protected span (to the end of the
    // cluster it finishes in), or any other cluster.
    var units: [Unit] = []
    var span = 0
    var g = 0
    while g < starts.count - 1 {
      let start = starts[g]
      while span < spans.count, spans[span].end <= start { span += 1 }
      if span < spans.count, spans[span].start <= start {
        let first = g
        while starts[g] < spans[span].end { g += 1 }
        units.append(Unit(start: start, end: starts[g], kind: .mark, first: first))
        continue
      }
      let end = starts[g + 1]
      let isSpace = chars[start..<end].allSatisfy(PostingJS.isSpace) && end > start
      units.append(Unit(start: start, end: end, kind: isSpace ? .space : .plain, first: g))
      g += 1
    }

    var breaks = [Break(end: 0, next: 0, level: paragraph, cEnd: 0, cNext: 0, bEnd: 0, bNext: 0, soft: true)]
    var count = 0
    var bytes = 0

    var u = 0
    while u < units.count {
      // A word: every unit up to the next whitespace.
      var v = u
      while v < units.count, units[v].kind != .space { v += 1 }
      let wordText = slice(units[u].start, units[max(u, v - 1)].end)
      let whole = measure(wordText)
      let tooLong = whole.count > room.count || whole.bytes > room.bytes

      // Places inside the word, only when it must be cut or is written
      // without spaces.
      var inner: [(at: Int, level: Int, c: Int, b: Int)] = []
      if tooLong || cjkEnd.test(wordText) {
        var c = 0
        var b = 0
        var k = u
        while k < v {
          let unit = units[k]
          let own = slice(unit.start, unit.end)
          if unit.kind == .plain {
            c += 1
            b += own.utf8.count
          } else {
            let lead = k > u ? slice(starts[unit.first - 1], unit.start) : ""
            let m = measure(lead + own)
            c += m.count - Graphemes.countGraphemes(lead)
            b += m.bytes - lead.utf8.count
          }
          if k + 1 >= v { break }
          let nextUnits = chars[units[k + 1].start..<units[k + 1].end]
          if startsAMark(nextUnits) {
            k += 1
            continue
          }
          let nextText = String(jsUnits: nextUnits)
          let isSentence =
            unit.kind == .plain
            && cjkClosed.test(slice(max(units[u].start, unit.end - 8), unit.end))
            && !cjkTail.test(nextText)
          if isSentence || tooLong {
            inner.append((unit.end, isSentence ? sentence : hard, c, b))
          }
          k += 1
        }
        // The parts must add up to the composer's own count of the word; if
        // they don't, the word is left whole rather than counted wrongly.
        if c != whole.count || b != whole.bytes { inner.removeAll() }
      }
      for p in inner {
        breaks.append(
          Break(
            end: p.at, next: p.at, level: p.level, cEnd: count + p.c, cNext: count + p.c,
            bEnd: bytes + p.b, bNext: bytes + p.b, soft: false))
      }
      count += whole.count
      bytes += whole.bytes

      // The whitespace after it, to the next word.
      var w = v
      while w < units.count, units[w].kind == .space { w += 1 }
      if v >= units.count { break }
      let gap = chars[units[v].start..<units[w - 1].end]
      var x = w
      while x < units.count, units[x].kind != .space { x += 1 }
      let after = w < units.count ? slice(units[w].start, units[x - 1].end) : ""
      let nextStart = w < units.count ? units[w].start : chars.count
      let cNext = count + (w - v)
      let bNext = bytes + String(jsUnits: gap).utf8.count
      breaks.append(
        Break(
          end: units[v].start, next: nextStart, level: gapLevel(gap, wordText, after), cEnd: count, cNext: cNext,
          bEnd: bytes, bNext: bNext, soft: true))
      count = cNext
      bytes = bNext
      u = w
    }

    breaks.append(
      Break(
        end: chars.count, next: chars.count, level: paragraph, cEnd: count, cNext: count, bEnd: bytes, bNext: bytes,
        soft: true))
    return breaks
  }

  /// The cheapest way through `breaks`, as the indexes of the breaks used
  /// (starting at 0, ending at the last). Worked from the end backwards;
  /// among equals the later break wins, which fills the earlier posts first.
  static func cheapestPath(_ breaks: [Break], _ room: Room) -> [Int] {
    let last = breaks.count - 1
    var cost = [Double](repeating: .infinity, count: breaks.count)
    var choice = [Int](repeating: last, count: breaks.count)
    cost[last] = 0
    var i = last - 1
    while i >= 0 {
      var j = i + 1
      while j <= last {
        let fits =
          breaks[j].cEnd - breaks[i].cNext <= room.count && breaks[j].bEnd - breaks[i].bNext <= room.bytes
        // What can't be cut and doesn't fit still has to go somewhere: alone.
        if !fits, j > i + 1 { break }
        let total = postCost + (j == last ? 0 : cutCost[breaks[j].level]) + cost[j]
        if total <= cost[i] {
          cost[i] = total
          choice[i] = j
        }
        if !fits { break }
        j += 1
      }
      i -= 1
    }
    var path = [0]
    while path[path.count - 1] != last { path.append(choice[path[path.count - 1]]) }
    return path
  }

  /// `text` cut into posts of at most `room`, with no numbering: the first
  /// `maxPosts - 1` cuts are kept, and what is left stays in the last post.
  static func cut(_ text: String, _ room: Room, _ maxPosts: Double) -> [String] {
    let chars = Array(text.utf16)
    let marks = marksOf(text)
    let known = Set(marks.map { markKey($0) })
    var breaks = findBreaks(text, marks, room)

    // A cut inside a word can make a link, a mention or a hashtag that wasn't
    // in the text. Such a cut is taken away and the split worked out again;
    // a handful of rounds settles it.
    var round = 0
    while true {
      var path = cheapestPath(breaks, room)
      // `slice(0, Math.max(1, maxPosts))`: a fractional count is cut down.
      let keep = max(1, maxPosts)
      if keep < Double(path.count) { path = Array(path.prefix(Int(keep))) }
      path.append(breaks.count - 1)
      var posts: [String] = []
      var bad = -1
      var p = 0
      while p + 1 < path.count {
        defer { p += 1 }
        if path[p] == path[p + 1] { continue }
        let from = breaks[path[p]]
        let to = breaks[path[p + 1]]
        let post = String(jsUnits: chars[from.next..<max(from.next, to.end)])
        posts.append(post)
        if bad != -1 || (from.soft && to.soft) { continue }
        if let made = marksOf(post).first(where: { !known.contains(markKey($0, -from.next)) }) {
          bad = !from.soft && (to.soft || made.start == 0) ? path[p] : path[p + 1]
        }
      }
      if bad == -1 || round >= 8 { return posts }
      breaks.remove(at: bad)
      round += 1
    }
  }

  // MARK: Counters

  /// The counter at the end of `text`, on a line of its own, or nil.
  public static func readCounter(_ text: String?) -> ThreadCounter? {
    let trimmed = (text ?? "").jsTrimmingEnd()
    let units = Array(trimmed.utf16)
    guard let m = counterLine.firstMatch(in: trimmed),
      let number = m.group(1, in: units).flatMap({ Int($0) }),
      let total = m.group(2, in: units).flatMap({ Int($0) })
    else { return nil }
    return ThreadCounter(number: number, total: total, body: trimmed.jsSlice(0, m.range.lowerBound).jsTrimmingEnd())
  }

  /// `text` without the counter at its end, if it has one.
  public static func stripCounter(_ text: String?) -> String {
    readCounter(text)?.body ?? (text ?? "")
  }

  static func withCounter(_ body: String, _ number: Int, _ total: Int) -> String {
    body.isEmpty ? "\(number)/\(total)" : "\(body)\n\n\(number)/\(total)"
  }

  // MARK: Splitting

  /// One over-long post as the posts of a thread, in order. A text that
  /// already fits comes back alone and untouched (trimmed).
  ///
  /// - Parameters:
  ///   - limit: graphemes a post holds (300).
  ///   - numbering: `.counter` ends every post with its place and the total
  ///     ("2/5") and keeps room for it.
  ///   - maxPosts: the most posts to make; what doesn't fit in them stays, as
  ///     written, in the last one rather than being dropped.
  ///   - before: posts already in the thread ahead of this one, so the
  ///     counters count the whole thread.
  ///   - after: and after it.
  public static func splitIntoThread(
    _ text: String?,
    limit: Int = PostingLimits.maxPostGraphemes,
    numbering: ThreadNumbering = .off,
    maxPosts: Double = .infinity,
    before: Int = 0,
    after: Int = 0
  ) -> [String] {
    let whole = (text ?? "").jsTrimmed()
    let fitsAsIs =
      InlineLinks.countComposerGraphemes(whole) <= limit
      && RichText.utf8Length(InlineLinks.composerCountText(whole)) <= PostingLimits.maxPostBytes
    if fitsAsIs || !(maxPosts > 1) { return [whole] }

    let numbered = numbering == .counter
    var digits = counterDigits
    while true {
      let reserve = numbered ? counterRoom(digits) : 0
      let room = Room(count: max(1, limit - reserve), bytes: max(1, PostingLimits.maxPostBytes - reserve))
      let posts = cut(whole, room, maxPosts)
      if posts.count < 2 { return [whole] }
      if !numbered { return posts }
      let total = before + posts.count + after
      // A thread past 99 posts needs wider counters, and so shorter posts.
      if String(total).count > digits {
        digits = String(total).count
        continue
      }
      return posts.enumerated().map { withCounter($0.element, before + $0.offset + 1, total) }
    }
  }

  /// A thread's posts as one text again, a blank line between posts; with
  /// `.counter`, each post's counter taken off first.
  public static func joinThread(_ posts: [String]?, numbering: ThreadNumbering = .off) -> String {
    (posts ?? [])
      .map { (numbering == .counter ? stripCounter($0) : $0).jsTrimmed() }
      .filter { !$0.isEmpty }
      .joined(separator: "\n\n")
  }

  /// Whether a thread's posts carry counters, and whether they are right:
  /// `.none` (fewer than two posts end in one), `.current` (every post says
  /// its place and the total) or `.stale`.
  public static func threadNumbering(_ texts: [String]?) -> ThreadNumberingState {
    let list = texts ?? []
    let counters = list.map(readCounter)
    if list.count < 2 || counters.compactMap({ $0 }).count < 2 { return .none }
    let right = counters.enumerated().allSatisfy { index, counter in
      guard let counter else { return false }
      return counter.number == index + 1 && counter.total == list.count
    }
    return right ? .current : .stale
  }

  /// Each post's text with its counter set to its place in the thread. A
  /// thread of one loses its counter.
  public static func renumberThread(_ texts: [String]?) -> [String] {
    let list = texts ?? []
    if list.count < 2 { return list.map { stripCounter($0) } }
    return list.enumerated().map { withCounter(stripCounter($0.element).jsTrimmingEnd(), $0.offset + 1, list.count) }
  }
}
