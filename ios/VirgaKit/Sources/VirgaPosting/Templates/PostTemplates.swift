// Ports src/posting/templates/postTemplates.js
//
// Post templates: saved replies kept as net.anisota.feed.template records in
// the account's own repo. The record format is Anisota's, so a template made
// in either app shows up in the other.
//
// A template's text may hold `{{key}}` blanks. Keys under `their.` and `my.`,
// and `today`, fill themselves from the post being replied to and the
// signed-in account; every other key is asked for when the template is
// used. A context key whose context is missing (no display name, or no post
// being replied to) is asked too, so a template never posts a hole.
//
// Everything here is pure. Templates are read loosely, as the web reads its
// plain objects (`some TemplateFields`: a JSONValue, a PostTemplate, a
// TemplateDraft). Where the web would throw a TypeError on a malformed shape
// (a null in `variables`, `variables` that isn't an array, a null template
// in a list), the port reads the value as absent. Where it would pass a
// value of the wrong type through into a question or a list (a number as a
// label, a hint or a choice, a number as a keyword), the port gives its
// String form, which is what the web then shows.

import Foundation
import VirgaCore
import VirgaNetwork

public enum PostTemplates {
  // MARK: Constants

  public static let templateCollection = TemplateRecord.nsid

  public static let templateLimits = TemplateLimits()

  public static let templateUses = ["any", "reply", "post"]

  /// The fields the lexicon declares, on a record and on one of its blanks.
  public static let templateRecordFields = [
    "name", "text", "variables", "embed", "use", "group", "shortcut", "keywords", "langs", "createdAt", "updatedAt",
  ]
  public static let templateVariableFields = ["key", "label", "hint", "kind", "choices", "default", "optional"]

  /// The keys that fill themselves, in the order an editor offers them.
  public static let contextKeys = ["their.firstName", "their.name", "their.handle", "my.handle", "today"]

  /// Lower-case names for context keys, for blank chips and questions.
  public static let contextLabels: [String: String] = [
    "their.firstName": "their first name",
    "their.name": "their name",
    "their.handle": "their handle",
    "my.handle": "your handle",
    "today": "today's date",
  ]

  // The capture is the key; whitespace inside the braces is tolerated.
  static let blankPattern = JSRegex(#"\{\{[\#(JSRegex.space)]*([A-Za-z][A-Za-z0-9_.\-]{0,31})[\#(JSRegex.space)]*\}\}"#)
  // The first run of letters, so "🌿 Wren Okafor" gives "Wren".
  static let firstWord = JSRegex(#"[\p{L}\p{M}][\p{L}\p{M}'’\-]*"#)
  // Letters and numbers, with apostrophes only inside a word ("don't").
  static let words = JSRegex(#"[\p{L}\p{N}](?:[\p{L}\p{N}']*[\p{L}\p{N}])?"#)

  static func contextLabel(_ key: String) -> String? { contextLabels.jsValue(key) }

  // MARK: Blanks

  /// True for keys the client fills from context rather than asking.
  public static func isContextKey(_ key: String?) -> Bool {
    guard let key else { return false }
    return TemplateJS.startsWith(key, "their.") || TemplateJS.startsWith(key, "my.") || key.jsEquals("today")
  }

  @_disfavoredOverload
  public static func isContextKey(_ key: JSONValue?) -> Bool {
    isContextKey(key?.stringValue)
  }

  /// Unique blank keys in `text`, in first-appearance order.
  public static func placeholderKeys(_ text: String?) -> [String] {
    let source = text ?? ""
    let units = Array(source.utf16)
    var keys: [String] = []
    for match in blankPattern.matches(in: source) {
      guard let key = match.group(1, in: units) else { continue }
      if !keys.jsIncludes(key) { keys.append(key) }
    }
    return keys
  }

  /// `placeholderKeys(String(text || ''))`.
  @_disfavoredOverload
  public static func placeholderKeys(_ text: JSONValue?) -> [String] {
    placeholderKeys(TemplateJS.orEmpty(text))
  }

  /// `text` as alternating literal and blank segments.
  public static func splitTemplateText(_ text: String?) -> [TemplateSegment] {
    let source = text ?? ""
    let units = Array(source.utf16)
    var out: [TemplateSegment] = []
    var last = 0
    for match in blankPattern.matches(in: source) {
      if match.range.lowerBound > last {
        out.append(.text(String(jsUnits: units[last..<match.range.lowerBound])))
      }
      out.append(.blank(key: match.group(1, in: units) ?? ""))
      last = match.range.upperBound
    }
    if last < units.count { out.append(.text(String(jsUnits: units[last...]))) }
    return out
  }

  @_disfavoredOverload
  public static func splitTemplateText(_ text: JSONValue?) -> [TemplateSegment] {
    splitTemplateText(TemplateJS.orEmpty(text))
  }

  // MARK: Context

  /// The values context keys can draw on. `replyTo` is the post being
  /// replied to (a postView, or anything with an `author`), `self` the
  /// signed-in account (`{ handle }`). `today` is formatted in `locale` and
  /// `timeZone` (the active ones when nil; the web uses the runtime's).
  public static func buildTemplateContext(
    replyTo: JSONValue? = nil,
    self account: JSONValue? = nil,
    now: Date = Date(),
    locale: String? = nil,
    timeZone: TimeZone? = nil
  ) -> TemplateContext {
    let author = replyTo?.templateField("author")?.truthy
    let name = author?.templateField("displayName")?.stringValue?.jsTrimmed() ?? ""
    let first = firstWord.firstMatch(in: name).flatMap { $0.group(0, in: Array(name.utf16)) } ?? ""
    let today = AppLocale.toLocaleDateString(
      now.timeIntervalSince1970 * 1000, DateFormatOptions(month: "long", day: "numeric"),
      locale: locale, timeZone: timeZone)
    return TemplateContext(
      their: author.map { author in
        TemplateContext.Their(
          name: name.isEmpty ? nil : name,
          firstName: first.isEmpty ? nil : first,
          handle: TemplateJS.text(author.templateField("handle")))
      },
      my: TemplateContext.My(handle: TemplateJS.text(account?.templateField("handle"))),
      today: today)
  }

  /// The value a context key fills with, or nil when the context lacks it.
  public static func contextValue(_ key: String?, _ context: TemplateContext?) -> String? {
    guard let context, let key else { return nil }
    func present(_ value: String?) -> String? { value?.isEmpty == false ? value : nil }
    switch key {
    case "their.firstName": return present(context.their?.firstName)
    case "their.name": return present(context.their?.name)
    case "their.handle": return present(context.their?.handle).map { "@" + $0 }
    case "my.handle": return present(context.my?.handle).map { "@" + $0 }
    case "today": return present(context.today)
    default: return nil
    }
  }

  /// `s.charAt(0).toUpperCase() + s.slice(1)`, by code unit.
  static func capitalise(_ s: String) -> String {
    let units = Array(s.utf16)
    guard let first = units.first else { return s }
    // toUpperCase leaves half a surrogate pair as it is.
    if UTF16.isLeadSurrogate(first) || UTF16.isTrailSurrogate(first) { return s }
    return String(jsUnits: [first]).jsUppercased() + String(jsUnits: units[1...])
  }

  // MARK: Questions

  /// The blanks a template declares, by key (the last of two with one key
  /// wins, as a Map's set does).
  static func variablesByKey(_ template: some TemplateFields) -> [JSKey: JSONValue] {
    var out: [JSKey: JSONValue] = [:]
    for v in TemplateJS.list(template.templateField("variables")) {
      if let key = v.templateField("key")?.stringValue { out[JSKey(key)] = v }
    }
    return out
  }

  /// The questions a template asks with this context, in text order.
  public static func templateQuestions(_ template: some TemplateFields, _ context: TemplateContext?) -> [TemplateQuestion] {
    let vars = variablesByKey(template)
    var questions: [TemplateQuestion] = []
    for key in placeholderKeys(template.templateField("text")) {
      let ctx = isContextKey(key)
      if ctx && contextValue(key, context) != nil { continue }
      let v = vars[JSKey(key)] ?? .object([:])
      let choices = v.templateField("choices")?.arrayValue
      let isChoice = v.templateField("kind")?.stringValue == "choice" && !(choices ?? []).isEmpty
      var defaultValue = v.templateField("default")?.stringValue ?? ""
      var note = ""
      if ctx {
        let handle = context?.their?.handle ?? ""
        // their.handle is never missing while there is a post, so only the names land here.
        if TemplateJS.startsWith(key, "their."), !handle.isEmpty {
          if defaultValue.isEmpty { defaultValue = capitalise(TemplateJS.split(handle, on: 0x2E)[0]) }
          note = "@\(handle) has no display name, so this is asked. It starts from their handle."
        } else if TemplateJS.startsWith(key, "their.") {
          note = "There's no post being replied to, so this is asked."
        }
      }
      let label = TemplateJS.text(v.templateField("label"))
        ?? (ctx ? capitalise(contextLabel(key) ?? key) : "Fill in “\(key)”")
      questions.append(TemplateQuestion(
        key: key,
        label: label,
        hint: TemplateJS.text(v.templateField("hint")) ?? "",
        kind: isChoice ? "choice" : "text",
        choices: isChoice ? (choices ?? []).map { $0.stringValue ?? $0.jsString } : [],
        optional: v.templateField("optional")?.isTruthy ?? false,
        defaultValue: defaultValue,
        note: note,
        isContext: ctx))
    }
    return questions
  }

  /// `{ key: defaultValue }` for every question.
  public static func initialAnswers(_ questions: [TemplateQuestion]?) -> [String: String] {
    var out: [String: String] = [:]
    for q in questions ?? [] { out[q.key] = q.defaultValue }
    return out
  }

  /// The keys among `questions` that still need an answer.
  public static func missingAnswers(_ questions: [TemplateQuestion]?, _ answers: some TemplateAnswers) -> [String] {
    (questions ?? []).filter { !$0.optional && answers.templateAnswer($0.key).isEmpty }.map(\.key)
  }

  // MARK: Filling

  /// What tidyTemplateParts works on: a part's code units, or an empty blank.
  struct RawPart {
    var units: [UInt16]
    var empty: Bool
  }

  /// The text each part keeps after tidyTemplateParts' rules (an empty
  /// array for a part left with nothing, and for every empty blank).
  static func tidy(_ list: [RawPart]) -> [[UInt16]] {
    // One entry per code unit, naming its part; `part: -1` is an empty blank.
    var chars: [(ch: UInt16, part: Int)] = []
    for (index, part) in list.enumerated() {
      if part.empty {
        chars.append((0, -1))
        continue
      }
      for unit in part.units { chars.append((unit, index)) }
    }
    func isEmpty(_ k: Int) -> Bool { k >= 0 && k < chars.count && chars[k].part < 0 }
    func isSpace(_ k: Int) -> Bool { k >= 0 && k < chars.count && chars[k].part >= 0 && (chars[k].ch == 0x20 || chars[k].ch == 0x09) }
    func isLineBreak(_ k: Int?) -> Bool {
      guard let k else { return true }
      return chars[k].ch == 0x0A || chars[k].ch == 0x0D
    }
    func isPunctuation(_ unit: UInt16) -> Bool { [0x2E, 0x2C, 0x3B, 0x3A, 0x21, 0x3F].contains(unit) }
    var drop = [Bool](repeating: false, count: chars.count)

    var i = 0
    while i < chars.count {
      if !isEmpty(i) {
        i += 1
        continue
      }
      // A run of empty blanks with only spaces between them closes as one.
      let first = i
      var last = i
      var end = i + 1
      while end < chars.count && (isEmpty(end) || isSpace(end)) {
        if isEmpty(end) { last = end }
        end += 1
      }
      end = last + 1
      while end < chars.count && isSpace(end) { end += 1 }
      var start = first
      while start > 0 && isSpace(start - 1) { start -= 1 }
      for k in first...last { drop[k] = true }

      let prev: Int? = start > 0 ? start - 1 : nil
      let next: Int? = end < chars.count ? end : nil
      let spaceBefore = start < first
      let spaceAfter = end > last + 1
      var dropBefore = false
      var dropAfter = false
      if isLineBreak(next) {
        dropBefore = true
        dropAfter = true
      } else if let next, isPunctuation(chars[next].ch) {
        dropBefore = true
      } else if isLineBreak(prev) || (spaceBefore && spaceAfter) {
        dropAfter = true
      }
      if dropBefore { for k in start..<first { drop[k] = true } }
      if dropAfter { for k in (last + 1)..<end { drop[k] = true } }
      i = end
    }

    func kept(_ k: Int) -> Bool { !drop[k] && !isEmpty(k) }
    func isWhite(_ k: Int) -> Bool { chars[k].part >= 0 && PostingJS.isSpace(chars[k].ch) }
    var from = 0
    while from < chars.count && (!kept(from) || isWhite(from)) { from += 1 }
    var to = chars.count
    while to > from && (!kept(to - 1) || isWhite(to - 1)) { to -= 1 }

    var texts = [[UInt16]](repeating: [], count: list.count)
    if from < to {
      for k in from..<to where kept(k) { texts[chars[k].part].append(chars[k].ch) }
    }
    return texts
  }

  /// `parts` with the gaps left by blanks that filled with nothing closed,
  /// and the ends trimmed. A part of kind 'empty' marks such a blank. Spaces
  /// are dropped only beside an empty blank, so the template's own words
  /// keep their spacing (":)", "Bonjour !", indents). Beside an empty blank:
  /// before a line end both sides' spaces go; before punctuation the space
  /// before the blank goes; at a line start, or with a space on both sides,
  /// the space after it goes. Empty blanks, and parts left with no text, are
  /// dropped.
  public static func tidyTemplateParts(_ parts: [TemplatePart]?) -> [TemplatePart] {
    let list = parts ?? []
    let texts = tidy(list.map { RawPart(units: Array($0.text.utf16), empty: $0.kind == "empty") })
    var out: [TemplatePart] = []
    for (index, part) in list.enumerated() where part.kind != "empty" && !texts[index].isEmpty {
      var kept = part
      kept.text = String(jsUnits: texts[index])
      out.append(kept)
    }
    return out
  }

  /// tidyTemplateParts over parts as the web takes them: any objects with
  /// `text` and `kind` (their other fields kept); falsy entries skipped,
  /// and `text` read as `String(part.text ?? '')`.
  public static func tidyTemplateParts(_ parts: JSONValue?) -> [JSONValue] {
    let list = TemplateJS.list(parts).filter(\.isTruthy)
    func isEmptyKind(_ part: JSONValue) -> Bool { part.templateField("kind")?.stringValue == "empty" }
    let texts = tidy(list.map { part in
      let text = part.templateField("text")
      let string = text.nonNull.map(\.jsString) ?? ""
      return RawPart(units: Array(string.utf16), empty: isEmptyKind(part))
    })
    var out: [JSONValue] = []
    for (index, part) in list.enumerated() where !isEmptyKind(part) && !texts[index].isEmpty {
      guard case .object(var members) = part else { continue }
      members["text"] = .string(String(jsUnits: texts[index]))
      out.append(.object(members))
    }
    return out
  }

  // What a blank fills with. A context key the context can fill always
  // takes the context's value: it isn't asked (templateQuestions), so an
  // answer left from when it was asked has no field to see or change it in.
  static func filledValue(_ key: String, _ answers: some TemplateAnswers, _ context: TemplateContext?) -> String {
    if isContextKey(key), let value = contextValue(key, context) { return value }
    return answers.templateAnswer(key)
  }

  /// The template's text with every blank filled from context, then answers.
  public static func fillTemplate(
    _ template: some TemplateFields, _ answers: some TemplateAnswers, _ context: TemplateContext?
  ) -> String {
    let parts = splitTemplateText(template.templateField("text")).map { seg -> RawPart in
      switch seg {
      case .text(let value): return RawPart(units: Array(value.utf16), empty: false)
      case .blank(let key):
        let value = filledValue(key, answers, context)
        return value.isEmpty ? RawPart(units: [], empty: true) : RawPart(units: Array(value.utf16), empty: false)
      }
    }
    return String(jsUnits: tidy(parts).flatMap { $0 })
  }

  /// The template's text as preview parts: `text` (the template's own
  /// words), `context` (filled from context), `answer` (filled from an
  /// answer) or `blank` (still needs one; `text` is the label to show). An
  /// unanswered optional blank renders nothing, and the gap it leaves is
  /// closed as fillTemplate closes it, so once every required blank is
  /// answered the parts join to fillTemplate's text.
  public static func templatePreviewParts(
    _ template: some TemplateFields, _ answers: some TemplateAnswers, _ context: TemplateContext?
  ) -> [TemplatePart] {
    var questions: [JSKey: TemplateQuestion] = [:]
    for q in templateQuestions(template, context) { questions[JSKey(q.key)] = q }
    var parts: [TemplatePart] = []
    for seg in splitTemplateText(template.templateField("text")) {
      switch seg {
      case .text(let value):
        parts.append(TemplatePart(text: value, kind: "text"))
      case .blank(let key):
        if let q = questions[JSKey(key)] {
          let answered = answers.templateAnswer(key)
          if !answered.isEmpty {
            parts.append(TemplatePart(text: answered, kind: "answer", key: key))
          } else if !q.optional {
            let text = isContextKey(key) ? contextLabel(key) ?? key : key
            parts.append(TemplatePart(text: text, kind: "blank", key: key))
          } else {
            parts.append(TemplatePart(text: "", kind: "empty", key: key))
          }
        } else {
          // Not asked, so the context fills it (templateQuestions asks the rest).
          parts.append(TemplatePart(text: contextValue(key, context) ?? "", kind: "context", key: key))
        }
      }
    }
    return tidyTemplateParts(parts)
  }

  /// What a template does, for a one-line description.
  public static func describeTemplate(_ template: some TemplateFields, _ context: TemplateContext?) -> TemplateDescription {
    let keys = placeholderKeys(template.templateField("text"))
    return TemplateDescription(
      questions: templateQuestions(template, context).count,
      quotes: template.templateField("embed")?.isTruthy ?? false,
      fillsContext: keys.contains { isContextKey($0) && contextValue($0, context) != nil })
  }

  /// Whether a template is offered when replying (`replying`) or on a new post.
  public static func templateOffered(_ template: some TemplateFields, replying: Bool) -> Bool {
    let raw = template.templateField("use")?.stringValue
    let use = raw.map { templateUses.jsIncludes($0) } == true ? raw! : "any"
    return use == "any" || (replying ? use == "reply" : use == "post")
  }

  // MARK: Matching

  // Lower-cased words, with a curly apostrophe read as a straight one.
  // Anything else ("#", "-", spaces) only separates words.
  static func wordsOf(_ text: String) -> [String] {
    let lower = String(jsUnits: text.jsLowercased().utf16.map { $0 == 0x2019 ? 0x27 : $0 })
    let units = Array(lower.utf16)
    return words.matches(in: lower).compactMap { $0.group(0, in: units) }
  }

  static func wordsOf(_ value: JSONValue?) -> [String] {
    wordsOf(TemplateJS.orEmpty(value))
  }

  // A keyword of four or more characters also matches words it starts.
  static func wordMatches(_ word: String, _ keyword: String) -> Bool {
    word.jsEquals(keyword) || (keyword.utf16.count >= 4 && TemplateJS.startsWith(word, keyword))
  }

  /// The template's keywords that appear in `text`, case-insensitively. A
  /// keyword of four or more characters also matches words it starts, so
  /// "reset" finds "resetting". A keyword is split into words as the text
  /// is, so "#mothweek" finds "#mothweek" and "mothweek", and "dark mode" or
  /// "e-mail" match those words in a row (the last of them may start a
  /// longer word).
  public static func keywordMatches(_ template: some TemplateFields, _ text: String?) -> [String] {
    let keywords = template.templateField("keywords")?.arrayValue ?? []
    guard !keywords.isEmpty, let text, !text.isEmpty else { return [] }
    let words = wordsOf(text)
    return keywords.filter { kw in
      let phrase = wordsOf(kw)
      if phrase.isEmpty { return false }
      let last = phrase.count - 1
      var i = 0
      while i + last < words.count {
        var all = true
        var j = 0
        while j <= last && all {
          all = j < last ? words[i + j].jsEquals(phrase[j]) : wordMatches(words[i + j], phrase[j])
          j += 1
        }
        if all { return true }
        i += 1
      }
      return false
    }.map { $0.stringValue ?? $0.jsString }
  }

  /// A shortcut as stored: lower case, no leading slash, trimmed.
  public static func normalizeShortcut(_ value: String?) -> String {
    let lower = (value ?? "").jsTrimmed().jsLowercased()
    let units = Array(lower.utf16)
    let start = units.firstIndex { $0 != 0x2F } ?? units.count
    return String(jsUnits: units[start...])
  }

  @_disfavoredOverload
  public static func normalizeShortcut(_ value: JSONValue?) -> String {
    normalizeShortcut(TemplateJS.orEmpty(value))
  }

  // Shorter queries match shortcuts only: "/s" and "/j" are tone tags as
  // often as they are the start of a shortcut, and nearly every name
  // contains an "s".
  static let nameQueryMin = 3

  /// Templates for a typed `/query`, best first: an exact shortcut, then
  /// shortcuts it starts, then (for three characters or more) names
  /// containing it. Templates not offered in this context sort after the
  /// rest; ties keep the order of `templates`.
  public static func matchShortcut<T: TemplateFields>(
    _ templates: [T]?, _ query: String?, replying: Bool = false, limit: Int = 5
  ) -> [T] {
    let q = normalizeShortcut(query)
    var scored: [(t: T, score: Double)] = []
    for t in templates ?? [] {
      let s = normalizeShortcut(t.templateField("shortcut"))
      var score: Double = -1
      if !s.isEmpty && s.jsEquals(q) {
        score = 3
      } else if !s.isEmpty && !q.isEmpty && TemplateJS.startsWith(s, q) {
        score = 2
      } else if q.utf16.count >= nameQueryMin && TemplateJS.orEmpty(t.templateField("name")).jsLowercased().jsIndexOf(q) >= 0 {
        score = 1
      } else if q.isEmpty && !s.isEmpty {
        score = 1
      }
      if score < 0 { continue }
      if !templateOffered(t, replying: replying) { score -= 0.5 }
      scored.append((t, score))
    }
    let sorted = PostingJS.stableSorted(scored) { -$0.score }
    return TemplateJS.prefix(sorted, limit).map(\.t)
  }

  /// A blank key from a human label: "device type" → "deviceType".
  public static func blankKeyFromLabel(_ label: String?) -> String {
    // Runs of ASCII letters and digits; everything else separates.
    var words: [String] = []
    var current = ""
    for unit in (label ?? "").jsTrimmed().utf16 {
      let isAlnum = (0x30...0x39).contains(unit) || (0x41...0x5A).contains(unit) || (0x61...0x7A).contains(unit)
      if isAlnum {
        current.unicodeScalars.append(Unicode.Scalar(UInt8(unit)))
      } else if !current.isEmpty {
        words.append(current)
        current = ""
      }
    }
    if !current.isEmpty { words.append(current) }
    // A key starts with a letter, so leading numbers are dropped before casing.
    while let first = words.first?.utf8.first, (0x30...0x39).contains(first) { words.removeFirst() }
    let key = words.enumerated().map { index, word -> String in
      let head = String(word.prefix(1))
      return (index == 0 ? head.lowercased() : head.uppercased()) + word.dropFirst()
    }.joined()
    return String(key.prefix(templateLimits.keyLength))
  }

  @_disfavoredOverload
  public static func blankKeyFromLabel(_ label: JSONValue?) -> String {
    blankKeyFromLabel(TemplateJS.orEmpty(label))
  }

  // MARK: Records

  /// One blank as a record holds it, or nil without a key: its label, hint,
  /// default (trimmed, when not empty), choices (for a choice question with
  /// any), and `optional` only when true.
  static func normalizeVariable(_ v: JSONValue?) -> TemplateVariable? {
    guard let v, v.isTruthy, let key = v.templateField("key")?.stringValue, !key.isEmpty else { return nil }
    var out = TemplateVariable(key: key)
    let label = TemplateJS.clean(v.templateField("label"))
    if !label.isEmpty { out.label = label }
    let hint = TemplateJS.clean(v.templateField("hint"))
    if !hint.isEmpty { out.hint = hint }
    if v.templateField("kind")?.stringValue == "choice" {
      let choices = TemplateJS.prefix(
        (v.templateField("choices")?.arrayValue ?? []).map(TemplateJS.clean).filter { !$0.isEmpty },
        templateLimits.choices)
      if !choices.isEmpty {
        out.kind = "choice"
        out.choices = choices
      }
    }
    let defaultValue = TemplateJS.clean(v.templateField("default"))
    if !defaultValue.isEmpty { out.default = defaultValue }
    if v.templateField("optional") == .bool(true) { out.optional = true }
    return out
  }

  /// How many members normalizeVariable's object has.
  static func memberCount(_ v: TemplateVariable) -> Int {
    1 + [v.label != nil, v.hint != nil, v.kind != nil, v.choices != nil, v.default != nil, v.optional != nil]
      .filter { $0 }.count
  }

  /// A listRecords entry as the template the app works with. Unknown `use`
  /// values read as `any`, and missing arrays as empty, so a record written
  /// by a newer build still loads.
  public static func normalizeTemplateRecord(_ entry: JSONValue?) -> PostTemplate {
    let uri = entry?.templateField("uri")
    let cid = entry?.templateField("cid")
    let v = entry?.templateField("value")?.truthy ?? .object([:])
    let embed = v.templateField("embed")
    let embedKept: JSONValue? = {
      guard let embed, embed.isTruthy else { return nil }
      switch embed {
      case .object, .array: return embed
      default: return nil
      }
    }()
    let use = v.templateField("use")?.stringValue
    let shortcut = v.templateField("shortcut")?.stringValue
    return PostTemplate(
      uri: TemplateJS.text(uri),
      cid: TemplateJS.text(cid),
      rkey: TemplateJS.rkeyOf(uri),
      name: v.templateField("name")?.stringValue ?? "",
      text: v.templateField("text")?.stringValue ?? "",
      variables: (v.templateField("variables")?.arrayValue ?? []).compactMap(normalizeVariable),
      embed: embedKept,
      use: use.map { templateUses.jsIncludes($0) } == true ? use! : "any",
      group: v.templateField("group")?.stringValue ?? "",
      shortcut: shortcut.map { normalizeShortcut($0) } ?? "",
      keywords: (v.templateField("keywords")?.arrayValue ?? []).compactMap { k in
        guard let k = k.stringValue, !k.jsTrimmed().isEmpty else { return nil }
        return k
      },
      langs: (v.templateField("langs")?.arrayValue ?? []).compactMap(\.stringValue),
      createdAt: v.templateField("createdAt")?.stringValue,
      updatedAt: v.templateField("updatedAt")?.stringValue)
  }

  /// normalizeTemplateRecord for `{ uri, cid, value }`.
  public static func normalizeTemplateRecord(uri: String?, cid: String?, value: JSONValue?) -> PostTemplate {
    var entry: [String: JSONValue] = [:]
    if let uri { entry["uri"] = .string(uri) }
    if let cid { entry["cid"] = .string(cid) }
    if let value { entry["value"] = value }
    return normalizeTemplateRecord(.object(entry))
  }

  /// The record to write for a template. Empty optional fields are left
  /// out, and variables are kept only for blanks the text still has.
  /// `isUpdate` stamps `updatedAt`.
  public static func templateToRecord(_ template: some TemplateFields, now: Date = Date(), isUpdate: Bool = false) -> JSONValue {
    let stamp = JSDate.toISOString(now.timeIntervalSince1970 * 1000) ?? ""
    let keys = Set(placeholderKeys(template.templateField("text")).map(JSKey.init))
    let variables = TemplateJS.prefix(
      TemplateJS.list(template.templateField("variables")).compactMap(normalizeVariable).filter {
        keys.contains(JSKey($0.key)) && memberCount($0) > 1
      },
      templateLimits.variables)
    var record: [String: JSONValue] = [
      "$type": .string(templateCollection),
      "name": .string(TemplateJS.clean(template.templateField("name"))),
      "text": .string(TemplateJS.orEmpty(template.templateField("text"))),
    ]
    if !variables.isEmpty { record["variables"] = .array(variables.map(\.templateJSON)) }
    if let embed = template.templateField("embed"), embed.isTruthy { record["embed"] = embed }
    let use = template.templateField("use")?.stringValue
    record["use"] = .string(use.map { templateUses.jsIncludes($0) } == true ? use! : "any")
    let group = TemplateJS.clean(template.templateField("group"))
    if !group.isEmpty { record["group"] = .string(group) }
    let shortcut = normalizeShortcut(template.templateField("shortcut"))
    if !shortcut.isEmpty { record["shortcut"] = .string(shortcut) }
    var seen = Set<JSKey>()
    var keywords: [String] = []
    for k in TemplateJS.list(template.templateField("keywords")) {
      let lower = TemplateJS.clean(k).jsLowercased()
      if lower.isEmpty || !seen.insert(JSKey(lower)).inserted { continue }
      keywords.append(lower)
    }
    keywords = TemplateJS.prefix(keywords, templateLimits.keywords)
    if !keywords.isEmpty { record["keywords"] = .array(keywords.map(JSONValue.string)) }
    let langs = TemplateJS.prefix(TemplateJS.list(template.templateField("langs")).filter(\.isTruthy), templateLimits.langs)
    if !langs.isEmpty { record["langs"] = .array(langs) }
    record["createdAt"] = template.templateField("createdAt")?.truthy ?? .string(stamp)
    if isUpdate { record["updatedAt"] = .string(stamp) }
    return .object(record)
  }

  /// Problems with a template about to be saved, as `{ field: message }`;
  /// empty when it can be saved. `others` are the account's other
  /// templates, for the shortcut clash check.
  public static func validateTemplate<T: TemplateFields, O: TemplateFields>(
    _ template: T, _ others: [O]
  ) -> TemplateFieldErrors {
    var errors = TemplateFieldErrors()
    let limits = templateLimits
    let name = TemplateJS.clean(template.templateField("name"))
    if name.isEmpty {
      errors["name"] = "Give it a name so you can find it later."
    } else if Graphemes.countGraphemes(name) > limits.nameGraphemes {
      errors["name"] = "Keep the name under \(limits.nameGraphemes) characters."
    }

    let text = TemplateJS.orEmpty(template.templateField("text"))
    if text.jsTrimmed().isEmpty && !(template.templateField("embed")?.isTruthy ?? false) {
      errors["text"] = "Write some text or choose something to quote."
    } else if Graphemes.countGraphemes(text) > limits.textGraphemes {
      errors["text"] = "The text is longer than a post can be."
    }

    if Graphemes.countGraphemes(TemplateJS.clean(template.templateField("group"))) > limits.groupGraphemes {
      errors["group"] = "Keep the group under \(limits.groupGraphemes) characters."
    }

    let shortcut = normalizeShortcut(template.templateField("shortcut"))
    if !shortcut.isEmpty && !isShortcut(shortcut) {
      errors["shortcut"] = "Use letters, numbers and dashes only."
    } else if !shortcut.isEmpty {
      let rkey = template.templateField("rkey")
      let clash = others.first { t in
        !TemplateJS.strictEquals(t.templateField("rkey"), rkey)
          && normalizeShortcut(t.templateField("shortcut")).jsEquals(shortcut)
      }
      if let clash {
        errors["shortcut"] = "/\(shortcut) already opens “\(TemplateJS.string(clash.templateField("name")))”."
      }
    }

    let asked = placeholderKeys(text).filter { !isContextKey($0) }
    if asked.count > limits.variables {
      errors["variables"] = "A template can ask at most \(limits.variables) questions."
    }
    for v in TemplateJS.list(template.templateField("variables")) {
      guard v.templateField("kind")?.stringValue == "choice",
        let key = v.templateField("key")?.stringValue, asked.jsIncludes(key)
      else { continue }
      let choices = TemplateJS.list(v.templateField("choices")).map(TemplateJS.clean).filter { !$0.isEmpty }
      if choices.isEmpty {
        let named = TemplateJS.text(v.templateField("label")) ?? key
        errors["variables"] = "Add at least one choice for “\(named)”."
        break
      }
    }

    let keywords = TemplateJS.list(template.templateField("keywords")).map(TemplateJS.clean).filter { !$0.isEmpty }
    if keywords.count > limits.keywords {
      errors["keywords"] = "Use at most \(limits.keywords) words."
    } else if keywords.contains(where: { $0.utf16.count > limits.keywordLength }) {
      errors["keywords"] = "One of the words is too long."
    } else if keywords.contains(where: { wordsOf($0).isEmpty }) {
      // keywordMatches reads only letters and numbers, so this one could never match.
      errors["keywords"] = "Each word needs a letter or a number in it."
    }
    return errors
  }

  /// validateTemplate with no other templates to clash with.
  public static func validateTemplate(_ template: some TemplateFields) -> TemplateFieldErrors {
    validateTemplate(template, [JSONValue]())
  }

  /// `/^[a-z0-9-]{1,32}$/`.
  static func isShortcut(_ text: String) -> Bool {
    let units = Array(text.utf16)
    guard (1...32).contains(units.count) else { return false }
    return units.allSatisfy { (0x61...0x7A).contains($0) || (0x30...0x39).contains($0) || $0 == 0x2D }
  }
}
