// Ports src/posting/adviser/sheet.js
//
// The posting adviser's read, laid out for the sheet that shows the draft
// marked up. Pure: the sheet renders what these return.
//
// The sheet shows facts only: the verdict, the tone label, each goal's
// status, and the draft with the passages the adviser flagged. The one place
// model prose survives is a writing note with no mechanical fix (usually
// clarity).

import Foundation
import VirgaCore
import VirgaNetwork

/// A piece of a marked post: `{ type: 'text', text }`, `{ type: 'fix', key,
/// text }` or `{ type: 'span', keys, children }` (children are text and fix
/// pieces).
public indirect enum AdviserSegment: Codable, Hashable, Sendable {
  case text(String)
  case fix(key: String, text: String)
  case span(keys: [String], children: [AdviserSegment])

  private enum CodingKeys: String, CodingKey { case type, text, key, keys, children }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(String.self, forKey: .type) {
    case "fix": self = .fix(key: try c.decode(String.self, forKey: .key), text: try c.decode(String.self, forKey: .text))
    case "span":
      self = .span(
        keys: try c.decode([String].self, forKey: .keys), children: try c.decode([AdviserSegment].self, forKey: .children))
    default: self = .text(try c.decode(String.self, forKey: .text))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .text(let text):
      try c.encode("text", forKey: .type)
      try c.encode(text, forKey: .text)
    case .fix(let key, let text):
      try c.encode("fix", forKey: .type)
      try c.encode(key, forKey: .key)
      try c.encode(text, forKey: .text)
    case .span(let keys, let children):
      try c.encode("span", forKey: .type)
      try c.encode(keys, forKey: .keys)
      try c.encode(children, forKey: .children)
    }
  }
}

/// One post of the draft, marked: `{ text, segments }`.
public struct AdviserMarkedPost: Codable, Hashable, Sendable {
  public var text: String
  public var segments: [AdviserSegment]
}

/// A passage a goal check or a writing note is about: `{ key, excerpt }`.
public struct AdviserMarkSpan: Hashable, Sendable {
  public var key: String
  public var excerpt: JSONValue?

  public init(key: String, excerpt: JSONValue?) {
    self.key = key
    self.excerpt = excerpt
  }
}

/// A slip with a correction: `{ key, found }`.
public struct AdviserMarkFix: Hashable, Sendable {
  public var key: String
  public var found: JSONValue?

  public init(key: String, found: JSONValue?) {
    self.key = key
    self.found = found
  }
}

/// placeAdviserMarks' answer: the marked posts, and the keys placed (a Set
/// on the web, here in its insertion order).
public struct AdviserPlacedMarks: Hashable, Sendable {
  public var posts: [AdviserMarkedPost]
  public var placed: [String]

  public func has(_ key: String) -> Bool { placed.jsIncludes(key) }
}

/// A row of the sheet's notes. A goal's carries `label`; a writing note's
/// `type` (as the server sent it) and `detail`. `number` is set when its
/// passage was placed in the draft.
public struct AdviserSheetNote: Hashable, Sendable {
  public var key: String
  /// 'goal' | 'writing'.
  public var kind: String
  /// 'conflict' | 'caution' | 'note'.
  public var tone: String
  public var label: JSONValue?
  public var type: JSONValue?
  public var detail: String?
  public var number: Int?

  public var json: JSONValue {
    var out: JSONValue = [
      "key": .string(key), "kind": .string(kind), "tone": .string(tone),
      "number": number.map { .number(Double($0)) } ?? .null,
    ]
    if kind == "goal" {
      out["label"] = label ?? .null
    } else {
      if let type { out["type"] = type }
      out["detail"] = .string(detail ?? "")
    }
    return out
  }
}

/// A fix the sheet offers: `{ key, issue }` (the issue as the server sent it).
public struct AdviserSheetFix: Hashable, Sendable {
  public var key: String
  public var issue: JSONValue

  public init(key: String, issue: JSONValue) {
    self.key = key
    self.issue = issue
  }

  public var json: JSONValue { ["key": .string(key), "issue": issue] }
}

/// A numbered mark: `{ number, tone }`.
public struct AdviserSheetMark: Codable, Hashable, Sendable {
  public var number: Int
  public var tone: String
}

/// Everything the sheet draws for one read.
public struct AdviserSheetModel: Hashable, Sendable {
  public var verdict: String?
  public var tone: String?
  public var posts: [AdviserMarkedPost]
  /// Each numbered note's mark, in note order (the web's object).
  public var marks: [(key: String, mark: AdviserSheetMark)]
  public var notes: [AdviserSheetNote]
  /// The goals met, by label.
  public var met: [JSONValue]
  public var fixes: [AdviserSheetFix]
  public var writingNoteCount: Int
  public var writingRequested: Bool

  public func mark(_ key: String) -> AdviserSheetMark? { marks.first { $0.key.jsEquals(key) }?.mark }

  public static func == (a: Self, b: Self) -> Bool { a.json == b.json }
  public func hash(into hasher: inout Hasher) { hasher.combine(json) }

  public var json: JSONValue {
    var marksObject: [String: JSONValue] = [:]
    for (key, mark) in marks { marksObject[key] = ["number": .number(Double(mark.number)), "tone": .string(mark.tone)] }
    return [
      "verdict": verdict.map(JSONValue.string) ?? .null,
      "tone": tone.map(JSONValue.string) ?? .null,
      "posts": (try? JSONValue(encoding: posts)) ?? [],
      "marks": .object(marksObject),
      "notes": .array(notes.map(\.json)),
      "met": .array(met),
      "fixes": .array(fixes.map(\.json)),
      "writingNoteCount": .number(Double(writingNoteCount)),
      "writingRequested": .bool(writingRequested),
    ]
  }
}

public enum AdviserSheet {
  static let flagged = ["conflict", "caution"]

  /// `typeof v === 'object'` for a value read from JSON (null aside).
  static func isObjectLike(_ value: JSONValue?) -> Bool {
    switch value {
    case .object?, .array?: return true
    default: return false
    }
  }

  /// The overall verdict, or nil when the read had no goal checks (writing
  /// only).
  public static func adviserVerdict(_ result: JSONValue?) -> String? {
    let checks = result?["checks"]?.arrayValue ?? []
    if checks.isEmpty { return nil }
    if let status = result?["overallStatus"]?.stringValue, (flagged + ["ok"]).jsIncludes(status) { return status }
    if checks.contains(where: { $0["status"]?.stringValue == "conflict" }) { return "conflict" }
    if checks.contains(where: { $0["status"]?.stringValue == "caution" }) { return "caution" }
    return "ok"
  }

  struct Range: Hashable {
    var start: Int
    var end: Int
    var keys: [String] = []
    var key: String = ""
  }

  static func findFirst(_ texts: [String], _ excerpt: JSONValue?) -> (post: Int, start: Int, end: Int)? {
    guard let excerpt = excerpt?.stringValue, !excerpt.jsTrimmed().isEmpty else { return nil }
    for (post, text) in texts.enumerated() {
      let start = text.jsIndexOf(excerpt)
      if start != -1 { return (post, start, start + excerpt.utf16.count) }
    }
    return nil
  }

  static func overlaps(_ a: Range, _ b: Range) -> Bool { a.start < b.end && b.start < a.end }
  static func contains(_ outer: Range, _ inner: Range) -> Bool {
    outer.start <= inner.start && inner.end <= outer.end
  }

  /// Passages that overlap become one, carrying every key that flagged them.
  static func mergeOverlapping(_ ranges: [Range]) -> [Range] {
    var merged: [Range] = []
    let sorted = JSSort.sort(ranges) { a, b in
      let byStart = Double(a.start - b.start)
      return byStart != 0 ? byStart : Double(a.end - b.end)
    }
    for range in sorted {
      if let last = merged.last, range.start < last.end {
        merged[merged.count - 1].end = Swift.max(last.end, range.end)
        merged[merged.count - 1].keys.append(contentsOf: range.keys)
      } else {
        merged.append(Range(start: range.start, end: range.end, keys: range.keys))
      }
    }
    return merged
  }

  static func fixSegments(_ units: [UInt16], _ from: Int, _ to: Int, _ fixes: [Range]) -> [AdviserSegment] {
    func slice(_ a: Int, _ b: Int) -> String { String(jsUnits: units[a..<b]) }
    var out: [AdviserSegment] = []
    var cursor = from
    for fix in fixes {
      if fix.start < from || fix.end > to { continue }
      if fix.start > cursor { out.append(.text(slice(cursor, fix.start))) }
      out.append(.fix(key: fix.key, text: slice(fix.start, fix.end)))
      cursor = fix.end
    }
    if cursor < to { out.append(.text(slice(cursor, to))) }
    return out
  }

  static func postSegments(_ text: String, _ spans: [Range], _ fixes: [Range]) -> [AdviserSegment] {
    let units = Array(text.utf16)
    let sortedFixes = JSSort.sort(fixes) { Double($0.start - $1.start) }
    var out: [AdviserSegment] = []
    var cursor = 0
    for span in JSSort.sort(spans, by: { Double($0.start - $1.start) }) {
      out.append(contentsOf: fixSegments(units, cursor, span.start, sortedFixes))
      out.append(.span(keys: span.keys, children: fixSegments(units, span.start, span.end, sortedFixes)))
      cursor = span.end
    }
    out.append(contentsOf: fixSegments(units, cursor, units.count, sortedFixes))
    return out
  }

  /// Place findings in the draft, in two layers, since a slip can sit inside
  /// a passage a goal flags: spans (passages a goal check or a writing note
  /// is about) and fixes (slips with a correction; may nest inside a span).
  ///
  /// A finding goes where the composer would act on it: the first post
  /// holding its excerpt, at the first occurrence. Spans that overlap merge
  /// into one passage carrying all their keys. A fix that overlaps another
  /// fix, or crosses a span's edge, is left unplaced. Earlier fixes win.
  /// `posts` is the draft as read, one string per post (anything else in
  /// the list reads as '').
  public static func placeAdviserMarks(
    _ posts: JSONValue?, spans: [AdviserMarkSpan] = [], fixes: [AdviserMarkFix] = []
  ) -> AdviserPlacedMarks {
    let texts = (posts?.arrayValue ?? []).map { $0.stringValue ?? "" }
    var found: [[Range]] = texts.map { _ in [] }
    for span in spans {
      if let at = findFirst(texts, span.excerpt) {
        found[at.post].append(Range(start: at.start, end: at.end, keys: [span.key]))
      }
    }
    let spanRanges = found.map(mergeOverlapping)
    var fixRanges: [[Range]] = texts.map { _ in [] }
    var placed: [String] = []
    func place(_ key: String) { if !placed.jsIncludes(key) { placed.append(key) } }
    for range in spanRanges.joined() { range.keys.forEach(place) }

    for fix in fixes {
      guard let at = findFirst(texts, fix.found) else { continue }
      let range = Range(start: at.start, end: at.end, key: fix.key)
      if fixRanges[at.post].contains(where: { overlaps($0, range) }) { continue }
      if spanRanges[at.post].contains(where: { overlaps($0, range) && !contains($0, range) }) { continue }
      fixRanges[at.post].append(range)
      place(fix.key)
    }

    return AdviserPlacedMarks(
      posts: texts.enumerated().map { i, text in
        AdviserMarkedPost(text: text, segments: postSegments(text, spanRanges[i], fixRanges[i]))
      },
      placed: placed)
  }

  public static func placeAdviserMarks(
    _ posts: [String], spans: [AdviserMarkSpan] = [], fixes: [AdviserMarkFix] = []
  ) -> AdviserPlacedMarks {
    placeAdviserMarks(.array(posts.map(JSONValue.string)), spans: spans, fixes: fixes)
  }

  /// `check.label || check.id || 'Goal'`.
  static func goalLabel(_ check: JSONValue) -> JSONValue {
    check["label"].truthy ?? check["id"].truthy ?? "Goal"
  }

  /// Everything the sheet draws for one read (`result`, the analyze-post
  /// answer) of the draft as read (`posts`, one string per post).
  ///
  /// Notes list the flagged goals (conflicts before cautions, each in check
  /// order) and then the writing notes. A note whose passage was placed in
  /// the draft is numbered, in list order, and its mark carries the same
  /// number.
  public static func adviserSheetModel(_ result: JSONValue?, _ posts: JSONValue?) -> AdviserSheetModel {
    let checks = (result?["checks"]?.arrayValue ?? []).filter(isObjectLike)
    let writing = result?["writing"]
    let writingRequested = writing?.isTruthy == true && isObjectLike(writing)
    let issues =
      writingRequested
      ? (writing?["issues"]?.arrayValue ?? []).filter { issue in
        issue.isTruthy && !(issue["found"]?.stringValue?.jsTrimmed().isEmpty ?? true)
      } : []

    func fixable(_ issue: JSONValue) -> Bool { !AdviserAnalysis.fixableWritingIssues(.array([issue])).isEmpty }
    let fixes = issues.enumerated().filter { fixable($0.element) }.map {
      AdviserSheetFix(key: "fix:\($0.offset)", issue: $0.element)
    }
    let writingNotes = issues.enumerated().filter { !fixable($0.element) }.map {
      (key: "note:\($0.offset)", issue: $0.element)
    }

    var entries: [(note: AdviserSheetNote, excerpt: JSONValue?)] = []
    for status in flagged {
      for (index, check) in checks.enumerated() where check["status"]?.stringValue == status {
        entries.append(
          (AdviserSheetNote(key: "check:\(index)", kind: "goal", tone: status, label: goalLabel(check)), check["excerpt"]))
      }
    }
    for (key, issue) in writingNotes {
      entries.append(
        (
          AdviserSheetNote(
            key: key, kind: "writing", tone: "note", type: issue["type"], detail: issue["note"]?.stringValue ?? ""),
          issue["found"]
        ))
    }

    let marked = placeAdviserMarks(
      posts, spans: entries.map { AdviserMarkSpan(key: $0.note.key, excerpt: $0.excerpt) },
      fixes: fixes.map { AdviserMarkFix(key: $0.key, found: $0.issue["found"]) })

    var number = 0
    let notes: [AdviserSheetNote] = entries.map { entry in
      var note = entry.note
      if marked.has(note.key) {
        number += 1
        note.number = number
      }
      return note
    }
    let marks = notes.compactMap { note in
      note.number.map { (key: note.key, mark: AdviserSheetMark(number: $0, tone: note.tone)) }
    }

    return AdviserSheetModel(
      verdict: adviserVerdict(result),
      tone: result?["sentiment"]?["label"]?.stringValue,
      posts: marked.posts,
      marks: marks,
      notes: notes,
      met: checks.filter { !flagged.jsIncludes($0["status"]?.stringValue ?? "\u{0}") }.map(goalLabel),
      fixes: fixes,
      writingNoteCount: writingNotes.count,
      writingRequested: writingRequested)
  }

  public static func adviserSheetModel(_ result: JSONValue?, _ posts: [String]) -> AdviserSheetModel {
    adviserSheetModel(result, .array(posts.map(JSONValue.string)))
  }

  static func plural(_ n: Int, _ one: String, _ many: String) -> String { "\(n) \(n == 1 ? one : many)" }

  /// The draft panel's count line: what the proofread found, less what has
  /// been fixed. "1 typo", "2 slips · 1 note", "1 typo · 1 fixed", "no
  /// slips". Nil when the read had no proofread. `taken` holds the keys of
  /// fixes already taken.
  public static func adviserWritingTally(_ model: AdviserSheetModel?, taken: [String] = []) -> String? {
    guard let model, model.writingRequested else { return nil }
    let remaining = model.fixes.filter { !taken.jsIncludes($0.key) }
    let fixed = model.fixes.count - remaining.count
    var parts: [String] = []
    if !remaining.isEmpty {
      parts.append(
        remaining.allSatisfy { $0.issue["type"]?.stringValue == "typo" }
          ? plural(remaining.count, "typo", "typos") : plural(remaining.count, "slip", "slips"))
    }
    if model.writingNoteCount > 0 { parts.append(plural(model.writingNoteCount, "note", "notes")) }
    if fixed > 0 { parts.append("\(fixed) fixed") }
    return parts.isEmpty ? "no slips" : parts.joined(separator: " · ")
  }

  static let draftLabels = [
    "post": "your post", "thread": "your thread", "reply": "your reply", "selfReply": "your reply",
    "quote": "your quote post",
  ]

  static let contextLabels = [
    "reply": "read with its thread", "quote": "read with the quoted post", "selfReply": "read with your thread",
  ]

  /// The draft panel's caption: what was read, and what it was read
  /// alongside.
  public static func adviserDraftLabel(_ scenario: String?, _ readWithContext: Bool = false) -> String {
    let draft = scenario.flatMap { draftLabels.jsValue($0) } ?? draftLabels["post"]!
    let context = readWithContext ? scenario.flatMap { contextLabels.jsValue($0) } : nil
    return context.map { "\(draft) · \($0)" } ?? draft
  }
}
