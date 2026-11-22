// Ports src/posting/composer/highlight.js
//
// The editor's highlight layer: the text cut into runs, each marked as a
// mention, a link, a hashtag, the brackets of an inline link, or plain. The
// overlay draws these runs under a transparent text view, so it must hold
// exactly the same characters; only colour may differ, or the caret drifts.
// Offsets are UTF-16 indexes; facets are byte-indexed, as records carry them.

import Foundation
import VirgaCore

/// A facet's character range and kind: `{ start, end, kind }`.
public struct FacetRange: Codable, Hashable, Sendable {
  public var start: Double
  public var end: Double
  /// 'mention' | 'link' | 'tag' (and, for an inline link's marks, 'syntax').
  public var kind: String
}

/// A run the overlay draws: `{ text, kind }`, kind 'plain', 'mention',
/// 'link', 'tag' or 'syntax'.
public struct HighlightSegment: Codable, Hashable, Sendable {
  public var text: String
  public var kind: String
}

public enum Highlight {
  static let kindByType: [String: String] = [
    "app.bsky.richtext.facet#mention": "mention",
    "app.bsky.richtext.facet#link": "link",
    "app.bsky.richtext.facet#tag": "tag",
  ]

  /// `a > b` for loose values, as JavaScript compares them (two strings
  /// by code unit; absent is NaN, so never greater).
  static func greater(_ a: JSONValue?, _ b: JSONValue?) -> Bool { ComposerJS.greater(a, b) }

  /// byteToCharIndex for any value (a facet's index needn't be whole, or
  /// even a number): the comparisons read it as a number, but only a number
  /// is `===` the text's last offset.
  static func byteToCharIndex(_ map: [Int], _ byteIndex: JSONValue?) -> Double {
    let n = byteIndex.jsNumber
    guard !map.isEmpty else { return 0 }
    for i in 0..<(map.count - 1) where Double(map[i]) <= n && n < Double(map[i + 1]) {
      return Double(i)
    }
    if byteIndex?.doubleValue == Double(map[map.count - 1]) { return Double(map.count - 1) }
    if n < 0 { return 0 }
    if n > Double(map[map.count - 1]) { return Double(map.count - 1) }
    return 0
  }

  /// Character ranges for byte-indexed facets over `text`, each with its
  /// kind. A facet whose range doesn't land inside the text is skipped.
  public static func facetRanges(_ text: JSONValue?, _ facets: JSONValue?) -> [FacetRange] {
    let source = text?.stringValue ?? ""
    guard let list = facets?.arrayValue, !list.isEmpty else { return [] }
    let map = RichText.createByteMap(source)
    var out: [FacetRange] = []
    for f in list {
      let type = f["features"].flatMap { $0[0] ?? $0["0"] }?["$type"]?.stringValue
      guard let type, let kind = kindByType.jsValue(type) else { continue }
      let bs = f["index"]?["byteStart"]
      let be = f["index"]?["byteEnd"]
      guard greater(be, bs) else { continue }
      let start = byteToCharIndex(map, bs)
      let end = byteToCharIndex(map, be)
      guard end > start, end <= Double(source.jsLength) else { continue }
      out.append(FacetRange(start: start, end: end, kind: kind))
    }
    return out
  }

  public static func facetRanges(_ text: String, _ facets: [Facet]) -> [FacetRange] {
    facetRanges(.string(text), json(facets))
  }

  /// The runs the overlay draws, covering `text` end to end. `inlineLinks`
  /// are findInlineLinks' results for the links that will be made: their
  /// brackets and address are marked 'syntax' and their label 'link'.
  public static func highlightSegments(
    _ text: JSONValue?, _ facets: JSONValue? = .array([]), _ inlineLinks: JSONValue? = .array([])
  ) -> [HighlightSegment] {
    let source = text?.stringValue ?? ""
    // A mark keeps the link's offsets as given: the web compares them as
    // they are (two strings by code unit) and only slicing reads numbers.
    struct Mark {
      var start: JSONValue?
      var end: JSONValue?
      var kind: String
    }
    let less = ComposerJS.less
    let greater = ComposerJS.greater
    var marks: [Mark] = []
    for link in inlineLinks?.arrayValue ?? [] {
      guard greater(link["end"], link["start"]) else { continue }
      let (start, end, labelStart, labelEnd) = (link["start"], link["end"], link["labelStart"], link["labelEnd"])
      if greater(labelStart, start) { marks.append(Mark(start: start, end: labelStart, kind: "syntax")) }
      if greater(labelEnd, labelStart) { marks.append(Mark(start: labelStart, end: labelEnd, kind: "link")) }
      if greater(end, labelEnd) { marks.append(Mark(start: labelEnd, end: end, kind: "syntax")) }
    }
    let linkSpans = marks
    for r in facetRanges(.string(source), facets) {
      let (start, end): (JSONValue, JSONValue) = (.number(r.start), .number(r.end))
      // The inline link's own marks win over the facet laid on its label.
      if linkSpans.contains(where: { less(start, $0.end) && less($0.start, end) }) { continue }
      marks.append(Mark(start: start, end: end, kind: r.kind))
    }
    marks = TimerJS.v8Sorted(marks) { a, b in
      let byStart = a.start.jsNumber - b.start.jsNumber
      return byStart != 0 && !byStart.isNaN ? byStart : b.end.jsNumber - a.end.jsNumber
    }

    var out: [HighlightSegment] = []
    var at: JSONValue? = .number(0)
    for m in marks {
      if less(m.start, at) { continue }  // overlapping; the earlier mark stands
      if greater(m.start, at) {
        out.append(HighlightSegment(text: slice(source, at.jsNumber, m.start.jsNumber), kind: "plain"))
      }
      out.append(HighlightSegment(text: slice(source, m.start.jsNumber, m.end.jsNumber), kind: m.kind))
      at = m.end
    }
    if less(at, .number(Double(source.jsLength))) {
      out.append(HighlightSegment(text: slice(source, at.jsNumber, nil), kind: "plain"))
    }
    return out
  }

  public static func highlightSegments(_ text: String, _ facets: [Facet] = [], _ inlineLinks: [InlineLink] = [])
    -> [HighlightSegment]
  {
    highlightSegments(.string(text), json(facets), json(inlineLinks))
  }

  static func json<T: Encodable>(_ value: T) -> JSONValue { (try? JSONValue(encoding: value)) ?? .array([]) }

  /// `text.slice(start, end)` with JavaScript's number handling.
  static func slice(_ text: String, _ start: Double, _ end: Double?) -> String {
    text.jsSlice(ComposerEditing.index(start), end.map(ComposerEditing.index))
  }
}
