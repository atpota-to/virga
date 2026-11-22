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

  /// `a > b` for loose numbers (absent is NaN, so never greater).
  static func greater(_ a: JSONValue?, _ b: JSONValue?) -> Bool { a.jsNumber > b.jsNumber }

  /// byteToCharIndex for any number (a facet's index needn't be whole).
  static func byteToCharIndex(_ map: [Int], _ byteIndex: Double) -> Double {
    guard !map.isEmpty else { return 0 }
    for i in 0..<(map.count - 1) where Double(map[i]) <= byteIndex && byteIndex < Double(map[i + 1]) {
      return Double(i)
    }
    if byteIndex == Double(map[map.count - 1]) { return Double(map.count - 1) }
    if byteIndex < 0 { return 0 }
    if byteIndex > Double(map[map.count - 1]) { return Double(map.count - 1) }
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
      let start = byteToCharIndex(map, bs.jsNumber)
      let end = byteToCharIndex(map, be.jsNumber)
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
    var marks: [FacetRange] = []
    for link in inlineLinks?.arrayValue ?? [] {
      guard greater(link["end"], link["start"]) else { continue }
      let start = link["start"].jsNumber
      let end = link["end"].jsNumber
      let labelStart = link["labelStart"].jsNumber
      let labelEnd = link["labelEnd"].jsNumber
      if labelStart > start { marks.append(FacetRange(start: start, end: labelStart, kind: "syntax")) }
      if labelEnd > labelStart { marks.append(FacetRange(start: labelStart, end: labelEnd, kind: "link")) }
      if end > labelEnd { marks.append(FacetRange(start: labelEnd, end: end, kind: "syntax")) }
    }
    let linkSpans = marks
    for r in facetRanges(.string(source), facets) {
      // The inline link's own marks win over the facet laid on its label.
      if linkSpans.contains(where: { r.start < $0.end && $0.start < r.end }) { continue }
      marks.append(r)
    }
    marks = TimerJS.v8Sorted(marks) { a, b in
      let byStart = a.start - b.start
      return byStart != 0 && !byStart.isNaN ? byStart : b.end - a.end
    }

    var out: [HighlightSegment] = []
    var at = 0.0
    for m in marks {
      if m.start < at { continue }  // overlapping; the earlier mark stands
      if m.start > at { out.append(HighlightSegment(text: slice(source, at, m.start), kind: "plain")) }
      out.append(HighlightSegment(text: slice(source, m.start, m.end), kind: m.kind))
      at = m.end
    }
    if at < Double(source.jsLength) { out.append(HighlightSegment(text: slice(source, at, nil), kind: "plain")) }
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
