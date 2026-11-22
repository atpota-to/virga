// Ports src/posting/composer/editing.js
//
// Pure text edits the composer's editor makes: replacing a range, picking a
// mention, turning a pasted address into an inline link, and taking a
// pasted post link out once it has become a quote. Offsets are UTF-16
// indexes into the text view's value. (Splitting an over-long post into a
// thread is in ThreadSplit and ThreadEdits.)

import Foundation
import VirgaCore

/// An edit's result: the text and where the caret goes (`{ text, caret }`).
public struct TextEdit: Codable, Hashable, Sendable {
  public var text: String
  /// A UTF-16 offset (fractional only when the web's would be).
  public var caret: Double
}

/// What a paste over a selection does: the linked text, or the sentence
/// saying why the words stay as typed (`{ text, caret }` or `{ refused }`).
public enum InlineLinkPaste: Codable, Hashable, Sendable {
  case linked(TextEdit)
  case refused(String)

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .linked(let edit): try edit.encode(to: encoder)
    case .refused(let sentence):
      var container = encoder.container(keyedBy: Key.self)
      try container.encode(sentence, forKey: .refused)
    }
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: Key.self)
    if let sentence = try container.decodeIfPresent(String.self, forKey: .refused) {
      self = .refused(sentence)
    } else {
      self = .linked(try TextEdit(from: decoder))
    }
  }

  enum Key: String, CodingKey { case refused }
}

public enum ComposerEditing {
  /// How close a post's count is to the limit, from this many characters left.
  public static let nearLimitLeft = 20

  /// `Math.max(lo, Math.min(hi, n))`.
  static func clamp(_ n: Double, _ lo: Double, _ hi: Double) -> Double {
    if n.isNaN { return .nan }
    return Swift.max(lo, Swift.min(hi, n))
  }

  /// A number as `slice` reads an index (ToIntegerOrInfinity), as an Int.
  static func index(_ n: Double) -> Int {
    if n.isNaN { return 0 }
    if n >= 1e15 { return Int(1e15) }
    if n <= -1e15 { return Int(-1e15) }
    return Int(n.rounded(.towardZero))
  }

  /// `text` with `[start, end)` replaced by `insertion`; the caret goes
  /// after it. Loose arguments are read as the web reads them.
  public static func replaceRange(_ text: JSONValue?, _ start: JSONValue?, _ end: JSONValue?, _ insertion: JSONValue?)
    -> TextEdit
  {
    let source = ComposerJS.str(text)
    let length = Double(source.jsLength)
    let n = start.jsNumber
    let from = clamp(n.isNaN || n == 0 ? 0 : n, 0, length)
    let endValue = end?.doubleValue.flatMap { $0.isFinite ? $0 : nil } ?? from
    let to = clamp(endValue, from, length)
    let add = ComposerJS.str(insertion)
    return TextEdit(
      text: source.jsSlice(0, index(from)) + add + source.jsSlice(index(to)),
      caret: from + Double(add.jsLength))
  }

  public static func replaceRange(_ text: String, _ start: Int, _ end: Int?, _ insertion: String) -> TextEdit {
    replaceRange(.string(text), .number(Double(start)), end.map { .number(Double($0)) }, .string(insertion))
  }

  /// The text once a typeahead pick replaces the partial mention at `range`
  /// (`{ start, end }`, `start` at the "@"): "@handle " with one space after
  /// it, unless a space already follows.
  public static func insertMention(_ text: JSONValue?, _ range: JSONValue?, _ handle: JSONValue?) -> TextEdit {
    let source = ComposerJS.str(text)
    let clean = stripAt(ComposerJS.str(handle)).jsTrimmed()
    guard !clean.isEmpty, let range, range.isTruthy else {
      return TextEdit(text: source, caret: Double(source.jsLength))
    }
    let after = Highlight.slice(source, range["end"].jsNumber, nil)
    let spacer = after.utf16.first.map(PostingJS.isSpace) == true ? "" : " "
    let edit = replaceRange(.string(source), range["start"], range["end"], .string("@\(clean)\(spacer)"))
    return TextEdit(text: edit.text, caret: spacer.isEmpty ? edit.caret + 1 : edit.caret)
  }

  public static func insertMention(_ text: String, _ range: PartialMention, _ handle: String) -> TextEdit {
    insertMention(
      .string(text), ["start": .number(Double(range.start)), "end": .number(Double(range.end))], .string(handle))
  }

  /// `.replace(/^@/, '')`.
  static func stripAt(_ text: String) -> String {
    text.utf16.first == 0x40 ? String(decoding: text.utf16.dropFirst(), as: UTF16.self) : text
  }

  /// What pasting `pasted` over the selection `[start, end)` should do when
  /// the selection is words and the paste is one web address. Nil when the
  /// paste isn't one of those (let the system paste it).
  public static func pasteAsInlineLink(_ text: JSONValue?, _ start: JSONValue?, _ end: JSONValue?, _ pasted: JSONValue?)
    -> InlineLinkPaste?
  {
    let source = ComposerJS.str(text)
    guard ComposerJS.greater(end, start) else { return nil }
    let url = ComposerJS.str(pasted).jsTrimmed()
    guard isOneWebAddress(url), let destination = InlineLinks.linkDestination(url) else { return nil }
    let label = Highlight.slice(source, start.jsNumber, end.jsNumber)
    if label.jsTrimmed().isEmpty || label.utf16.contains(where: { $0 == 0x5B || $0 == 0x5D || $0 == 0x0A })
      || InlineLinks.isSingleAddress(label)
    {
      return nil
    }
    if InlineLinks.labelMisleads(label, destination) {
      return .refused(misleadingSentence(label, destination))
    }
    return .linked(replaceRange(.string(source), start, end, .string("[\(label)](\(url))")))
  }

  public static func pasteAsInlineLink(_ text: String, _ start: Int, _ end: Int, _ pasted: String) -> InlineLinkPaste? {
    pasteAsInlineLink(.string(text), .number(Double(start)), .number(Double(end)), .string(pasted))
  }

  /// `/^https?:\/\/\S+$/i`.
  static func isOneWebAddress(_ url: String) -> Bool {
    let units = Array(url.utf16)
    func lower(_ u: UInt16) -> UInt16 { u >= 0x41 && u <= 0x5A ? u + 0x20 : u }
    let http = Array("http".utf16)
    guard units.count > 4, zip(units.prefix(4), http).allSatisfy({ lower($0) == $1 }) else { return false }
    var at = 4
    if at < units.count, lower(units[at]) == 0x73 { at += 1 }
    guard units.count >= at + 3, units[at] == 0x3A, units[at + 1] == 0x2F, units[at + 2] == 0x2F else { return false }
    let rest = units[(at + 3)...]
    return !rest.isEmpty && !rest.contains(where: PostingJS.isSpace)
  }

  static func hostOf(_ uri: String) -> String {
    guard let url = try? WHATWGURL(uri) else { return "" }
    let host = url.hostname
    return PostingJS.hasPrefix(host, "www.") ? String(decoding: host.utf16.dropFirst(4), as: UTF16.self) : host
  }

  static func misleadingSentence(_ label: String, _ uri: String) -> String {
    let host = hostOf(uri)
    return
      "“\(label.jsTrimmed())” names a different site than this link goes to\(host.isEmpty ? "" : " (\(host))"), so it stays as typed."
  }

  /// Sentences for the inline links in `text` that won't become links
  /// because their words name another site, one per link.
  public static func misleadingLinkNotes(_ text: JSONValue?) -> [String] {
    InlineLinks.findInlineLinks(ComposerJS.str(text)).filter(\.misleading).map { misleadingSentence($0.label, $0.uri) }
  }

  /// `text` with the link at `[charStart, charEnd)` taken out, once it has
  /// become an attachment, with the space it leaves. `expect` is what the
  /// range held when the link was found; when the writer has changed it
  /// since, the text comes back unchanged.
  public static func removeLinkFromText(
    _ text: JSONValue?, charStart: JSONValue?, charEnd: JSONValue?, expect: JSONValue? = nil
  ) -> String {
    let source = ComposerJS.str(text)
    guard ComposerJS.greater(charEnd, charStart), !ComposerJS.greater(charEnd, .number(Double(source.jsLength))) else {
      return source
    }
    let start = charStart.jsNumber
    let end = charEnd.jsNumber
    if let expect, !expect.isNull, !ComposerJS.strictEquals(.string(Highlight.slice(source, start, end)), expect) {
      return source
    }
    let before = Highlight.slice(source, 0, start)
    var after = Highlight.slice(source, end, nil)
    let blank: (UInt16) -> Bool = { $0 == 0x20 || $0 == 0x09 }
    if before.jsTrimmed().isEmpty || (before.utf16.last.map(blank) == true && after.utf16.first.map(blank) == true) {
      after = String(decoding: Array(after.utf16).drop(while: blank), as: UTF16.self)
    }
    if after.jsTrimmed().isEmpty {
      return String(decoding: Array(before.utf16).reversed().drop(while: PostingJS.isSpace).reversed(), as: UTF16.self)
    }
    return before + after
  }

  public static func removeLinkFromText(_ text: String, charStart: Int, charEnd: Int, expect: String? = nil) -> String {
    removeLinkFromText(
      .string(text), charStart: .number(Double(charStart)), charEnd: .number(Double(charEnd)),
      expect: expect.map(JSONValue.string))
  }

  /// What a screen reader is told about a post's length: a sentence only
  /// when the count crosses into "close to the limit" or "over it". '' while
  /// there's room.
  public static func limitAnnouncement(_ count: Double, max: Double = Double(ComposerModel.maxPostGraphemes)) -> String {
    if count > max { return "Over the \(JSNumber.format(max))-character limit." }
    if max - count <= Double(nearLimitLeft) { return "Close to the \(JSNumber.format(max))-character limit." }
    return ""
  }
}
