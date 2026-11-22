// Ports harness/fakeServer.js (the adviser's stand-in judgement, the style
// reading and the alt text)
//
// What /api/ai/analyze-post, /api/ai/synthesize-style and /api/ai/alt-text
// answer, decided by a few word lists so the harness gives the same read
// every time. The web's regexes are written out for ICU: JavaScript's `\b`
// and `\w` are ASCII-only and its `i` flag (without `u`) folds only what
// toUpperCase maps, so the word lists are explicit classes between explicit
// ASCII boundaries, and the doubled word, the lone "i" and the sentence
// split are walked over the UTF-16 code units as the regexes walk them.

import Foundation
import VirgaCore

extension FakeServer {
  /// A word list as `/\b(a|b)\b/i` matches it: explicit case classes for
  /// ASCII letters, ASCII word boundaries.
  final class WordList: @unchecked Sendable {
    let regex: NSRegularExpression

    init(_ words: [String], extra: String? = nil) {
      func fold(_ word: String) -> String {
        word.unicodeScalars.map { s -> String in
          let c = Character(s)
          if c.isASCII, c.isLetter { return "[\(c.lowercased())\(c.uppercased())]" }
          return NSRegularExpression.escapedPattern(for: String(c))
        }.joined()
      }
      var pattern = "(?<![A-Za-z0-9_])(?:\(words.map(fold).joined(separator: "|")))(?![A-Za-z0-9_])"
      if let extra { pattern += "|\(extra)" }
      regex = try! NSRegularExpression(pattern: pattern)
    }

    /// `re.exec(text)`: where the first match starts and its length, in
    /// code units.
    func exec(_ text: String) -> (index: Int, length: Int)? {
      let (subject, length) = JSRegexSubject.make(text)
      guard let m = regex.firstMatch(in: subject, range: NSRange(location: 0, length: length)) else { return nil }
      return (m.range.location, m.range.length)
    }

    func test(_ text: String) -> Bool { exec(text) != nil }
  }

  static let negative = WordList([
    "hate", "awful", "terrible", "worst", "stupid", "idiot", "disgusting", "doomed", "pathetic", "useless",
  ])
  static let confrontational = WordList(["actually", "ratio", "you people", "imagine thinking", "cope"], extra: #"\?!"#)
  static let warm = WordList(["thank", "thanks", "love", "glad", "great", "lovely", "welcome", "happy"])

  /// JavaScript's `\w`.
  static func isWordUnit(_ u: UInt16) -> Bool {
    (0x30...0x39).contains(u) || (0x41...0x5A).contains(u) || (0x61...0x7A).contains(u) || u == 0x5F
  }

  /// JavaScript's `\s`.
  static func isSpaceUnit(_ u: UInt16) -> Bool {
    Unicode.Scalar(u).map(JSWhitespace.contains) ?? false
  }

  /// `/\b(\w+)\s+\1\b/i.exec(text)`: the doubled word's whole match and
  /// the word.
  static func doubledWord(_ text: String) -> (found: String, word: String)? {
    let u = Array(text.utf16)
    func lower(_ x: UInt16) -> UInt16 { (0x41...0x5A).contains(x) ? x | 0x20 : x }
    var start = 0
    while start < u.count {
      guard isWordUnit(u[start]), start == 0 || !isWordUnit(u[start - 1]) else {
        start += 1
        continue
      }
      // `\w+` takes the whole run: a shorter one leaves a word character
      // where `\s+` must start.
      var end = start
      while end < u.count, isWordUnit(u[end]) { end += 1 }
      var gap = end
      while gap < u.count, isSpaceUnit(u[gap]) { gap += 1 }
      let length = end - start
      if gap > end, gap + length <= u.count,
        zip(u[start..<end], u[gap..<(gap + length)]).allSatisfy({ lower($0) == lower($1) }),
        gap + length == u.count || !isWordUnit(u[gap + length])
      {
        return (String(jsUnits: u[start..<(gap + length)]), String(jsUnits: u[start..<end]))
      }
      start = end
    }
    return nil
  }

  /// `/(^|\s)i(\s|')/.exec(text)[0]`.
  static func loneI(_ text: String) -> String? {
    let u = Array(text.utf16)
    func closes(_ i: Int) -> Bool { i < u.count && (isSpaceUnit(u[i]) || u[i] == 0x27) }
    for p in 0..<u.count {
      if p == 0, u[0] == 0x69, closes(1) { return String(jsUnits: u[0..<2]) }
      if isSpaceUnit(u[p]), p + 1 < u.count, u[p + 1] == 0x69, closes(p + 2) { return String(jsUnits: u[p..<(p + 3)]) }
    }
    return nil
  }

  /// `text.split(/(?<=[.!?])\s+/)`: the sentences, split at each run of
  /// whitespace that follows a full stop, a question or an exclamation mark.
  static func sentences(_ text: String) -> [String] {
    let u = Array(text.utf16)
    var out: [String] = []
    var from = 0
    var i = 1
    while i < u.count {
      if isSpaceUnit(u[i]), [0x2E, 0x21, 0x3F].contains(u[i - 1]) {
        var end = i
        while end < u.count, isSpaceUnit(u[end]) { end += 1 }
        out.append(String(jsUnits: u[from..<i]))
        from = end
        i = end + 1
      } else {
        i += 1
      }
    }
    out.append(String(jsUnits: u[from...]))
    return out
  }

  /// `s.split(/\s+/).length`.
  static func wordCount(_ text: String) -> Int {
    let u = Array(text.utf16)
    var runs = 0
    var i = 0
    while i < u.count {
      if isSpaceUnit(u[i]) {
        runs += 1
        while i < u.count, isSpaceUnit(u[i]) { i += 1 }
      } else {
        i += 1
      }
    }
    return runs + 1
  }

  /// `analyzePost({ text, goals, writingChecks })`: the writer's presets,
  /// their topics to ease off, their own goals (always fine here), and the
  /// writing checks (a doubled word is a typo, a lone lowercase "i" is
  /// grammar, a sentence over forty words is unclear). Nil when there's
  /// nothing to check against, which the server answers with an "ok" and
  /// doesn't count. `goals` nil is the web's undefined (`{}`).
  public static func analyzePost(text: String, goals: JSONValue? = nil, writingChecks: JSONValue? = nil) -> JSONValue? {
    let goals = goals ?? [:]
    let presets = goals["presets"].flatMap { $0.isTruthy ? $0 : nil } ?? [:]
    var checks: [JSONValue] = []
    func excerptOf(_ list: WordList) -> JSONValue {
      guard let m = list.exec(text) else { return .null }
      let units = Array(text.utf16)
      let before = Swift.max(0, m.index - 12)
      var start = 0
      for i in stride(from: Swift.min(before, units.count - 1), through: 0, by: -1) where units[i] == 0x20 {
        start = i + 1
        break
      }
      let end = text.jsIndexOf(" ", from: m.index + m.length + 12)
      let out = text.jsSlice(start, end == -1 ? text.jsLength : end)
      return out.jsTrimmed() == text.jsTrimmed() ? .null : .string(out)
    }
    func check(_ id: String, _ label: String, _ status: String, _ note: String, _ excerpt: JSONValue) -> JSONValue {
      var c: [String: JSONValue] = [:]
      c["id"] = .string(id)
      c["label"] = .string(label)
      c["status"] = .string(status)
      c["note"] = .string(note)
      c["excerpt"] = excerpt
      return .object(c)
    }
    if presets["reduceNegativity"]?.isTruthy == true {
      let hit = negative.test(text)
      checks.append(
        check(
          "reduceNegativity", "Reduce negativity", hit ? "caution" : "ok",
          hit ? "This reads as harsher than you asked to be." : "Nothing harsh here.", hit ? excerptOf(negative) : .null))
    }
    if presets["lessConfrontational"]?.isTruthy == true {
      let hit = confrontational.test(text)
      checks.append(
        check(
          "lessConfrontational", "Less confrontational", hit ? "caution" : "ok",
          hit ? "This could land as a dig at someone." : "No digs here.", hit ? excerptOf(confrontational) : .null))
    }
    let limit = presets["limitTopic"]
    var topics: [String] = []
    if limit?["enabled"]?.isTruthy == true {
      let topic = limit?["topic"].flatMap { $0.isTruthy ? $0.jsString : nil } ?? ""
      topics = topic.jsSplit(",").map { $0.jsTrimmed() }.filter { !$0.isEmpty }
    }
    if !topics.isEmpty {
      let lower = text.jsLowercased()
      let found = topics.first { lower.jsContains($0.jsLowercased()) }
      let note = found.map { "This is about \($0), which you wanted to post less about." } ?? "None of your topics come up."
      checks.append(check("limitTopic", "Limit topics", found != nil ? "conflict" : "ok", note, .null))
    }
    if case .string(let custom)? = goals["customText"], !custom.jsTrimmed().isEmpty {
      checks.append(check("custom", "Your goals", "ok", "Nothing here goes against what you wrote.", .null))
    }
    var categories: JSONValue?
    switch writingChecks {
    case .some(.object), .some(.array): categories = writingChecks
    default: categories = nil
    }
    let wantsWriting =
      categories.map {
        $0["typos"]?.isTruthy == true || $0["grammar"]?.isTruthy == true || $0["clarity"]?.isTruthy == true
      } ?? false
    if checks.isEmpty && !wantsWriting { return nil }

    let statuses = checks.compactMap { $0["status"]?.stringValue }
    let sentiment: JSONValue
    if negative.test(text) {
      let score: Double = -0.6
      sentiment = ["label": "negative", "score": .number(score)]
    } else if warm.test(text) {
      let score: Double = 0.6
      sentiment = ["label": "positive", "score": .number(score)]
    } else {
      sentiment = ["label": "neutral", "score": .number(0)]
    }
    let overall: String = statuses.contains("conflict") ? "conflict" : statuses.contains("caution") ? "caution" : "ok"
    let suggestion: JSONValue =
      statuses.contains { $0 != "ok" } ? .string("Try saying what you want to happen instead of what went wrong.") : .null
    var out: [String: JSONValue] = [:]
    out["sentiment"] = sentiment
    out["checks"] = .array(checks)
    out["suggestion"] = suggestion
    out["overallStatus"] = .string(overall)
    if wantsWriting, let categories {
      var issues: [JSONValue] = []
      if categories["typos"]?.isTruthy == true, let doubled = doubledWord(text) {
        issues.append([
          "type": "typo", "found": .string(doubled.found), "replacement": .string(doubled.word),
          "note": "The same word twice.",
        ])
      }
      if categories["grammar"]?.isTruthy == true, let lone = loneI(text) {
        issues.append([
          "type": "grammar", "found": .string(lone), "replacement": .string(lone.jsReplacingFirst("i", with: "I")),
          "note": "“I” is always a capital.",
        ])
      }
      if categories["clarity"]?.isTruthy == true, let long = sentences(text).first(where: { wordCount($0) > 40 }) {
        issues.append([
          "type": "clarity", "found": .string(long), "replacement": .null,
          "note": "A long sentence; it may read more easily as two.",
        ])
      }
      out["writing"] = ["issues": .array(issues)]
    }
    return .object(out)
  }

  /// `styleSummary(posts, guidance)`: the style reading's few lines.
  static func styleSummary(_ posts: [String], _ guidance: JSONValue?) -> String {
    let all = posts.joined(separator: " ")
    let letters = String(all.unicodeScalars.filter { $0.isASCII && ($0.properties.isAlphabetic) })
    let lower = !letters.isEmpty && letters == letters.lowercased()
    let total = posts.reduce(0.0) { $0 + Double($1.jsLength) }
    let avg = (total / Double(posts.count)).jsRounded
    var lines = [
      lower ? "Writes in all lowercase on purpose." : "Uses ordinary capitalisation.",
      avg < 80 ? "Short posts, often a single line." : "Posts run to a few sentences.",
      all.utf16.contains(0x21) ? "Uses exclamation marks now and then." : "Rarely uses exclamation marks.",
      all.utf16.contains(where: { $0 == 0x2014 || $0 == 0x2013 }) ? "Likes a dash for an aside." : "Keeps punctuation simple.",
    ]
    if case .string(let text)? = guidance, !text.jsTrimmed().isEmpty {
      lines.append("In their words: \(text.jsTrimmed().jsSlice(0, 300))")
    }
    return lines.joined(separator: " ")
  }

  /// `text.replace(/\.$/, '')`: one full stop off the end.
  static func dropFinalStop(_ text: String) -> String {
    text.utf16.last == 0x2E ? text.jsSlice(0, text.jsLength - 1) : text
  }

  /// `altTextFor({ imageBase64, kind, followUp, previousAltText, context })`.
  /// Throws the web's TypeError for a revision whose note or earlier text
  /// isn't text.
  static func altTextFor(_ body: JSONValue) throws -> String {
    let followUp = body["followUp"]
    let previous = body["previousAltText"]
    if followUp?.isTruthy == true, previous?.isTruthy == true {
      guard case .string(let before)? = previous else {
        throw HarnessJSError.typeError("previousAltText.replace is not a function")
      }
      guard case .string(let note)? = followUp else { throw HarnessJSError.typeError("followUp.trim is not a function") }
      return "\(dropFinalStop(before)), \(dropFinalStop(note.jsTrimmed()).jsLowercased())."
    }
    switch body["kind"] {
    case .some(.string("chart")):
      return "A bar chart with five bars rising from left to right; the last bar is about twice the first."
    case .some(.string("interface")):
      return "A screenshot of an app screen with a list of settings and a button at the bottom."
    case .some(.string("text")): return "A note in neat handwriting that reads: back in ten minutes."
    default: break
    }
    let options = [
      "A wooden bench under a street tree, in late afternoon sun.",
      "Rows of seed jars on a kitchen shelf, each with a handwritten label.",
      "A heron standing in shallow water by a canal towpath.",
      "A table at a repair café with a lamp, a toaster and a box of tools.",
    ]
    let image = body["imageBase64"].map(\.jsString) ?? "undefined"
    let line = options[World.hashOf(image.jsSlice(0, 2000)) % options.count]
    if let context = body["context"], context.isTruthy {
      return "\(dropFinalStop(line)), for a post about \(context.jsString.jsSlice(0, 60))."
    }
    return line
  }
}
