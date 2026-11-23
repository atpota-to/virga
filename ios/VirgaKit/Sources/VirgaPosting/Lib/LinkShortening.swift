// Ports src/posting/lib/linkShortening.js
//
// Link shortening, as Bluesky does it. Before writing a post, Bluesky replaces
// each link facet's covered *text* with a short form (scheme dropped, path
// clipped) and leaves the facet's `uri` pointing at the full address, so a URL
// costs far less than its length against the 300-grapheme cap. Counting and
// writing must use the same rule: count what you'll write, write what you
// counted.
//
// Ported from bluesky-social/social-app (`toShortUrl`, `shortenLinks`) by way
// of the web app. Only explicit-protocol URLs shorten: `new URL()` throws on a
// bare domain, so Bluesky leaves it full length.

import Foundation
import VirgaCore

/// A link span the live count will shorten.
public struct ShortenableLink: Codable, Hashable, Sendable {
  public var charStart: Int
  public var charEnd: Int
  public var matchText: String
}

/// Text and the facets indexing it.
public struct FacetedText: Codable, Hashable, Sendable {
  public var text: String
  public var facets: [Facet]
  public init(text: String, facets: [Facet]) {
    self.text = text
    self.facets = facets
  }
}

/// Text and facets as a record carries them, in any shape.
public struct FacetedJSON: Codable, Hashable, Sendable {
  public var text: String
  public var facets: [JSONValue]
  public init(text: String, facets: [JSONValue]) {
    self.text = text
    self.facets = facets
  }
}

public enum LinkShortening {
  static let linkType = "app.bsky.richtext.facet#link"

  /// A URL as it should read in post text: no scheme, and a path clipped to
  /// 13 characters plus an ellipsis once it runs past 15. Anything that isn't
  /// an http(s) URL comes back untouched.
  public static func toShortUrl(_ url: String) -> String {
    guard let urlp = try? WHATWGURL(url) else { return url }
    guard urlp.protocolString == "http:" || urlp.protocolString == "https:" else { return url }
    let path = (urlp.pathname == "/" ? "" : urlp.pathname) + urlp.search + urlp.hash
    if path.jsLength > 15 {
      return urlp.host + path.jsSlice(0, 13) + "..."
    }
    return urlp.host + path
  }

  static func hasHTTPScheme(caseInsensitive text: String) -> Bool {
    let lower = String(jsUnits: text.utf16.prefix(8).map { (0x41...0x5A).contains($0) ? $0 + 0x20 : $0 })
    return PostingJS.hasPrefix(lower, "http://") || PostingJS.hasPrefix(lower, "https://")
  }

  /// Spans of `text` that will become link facets and get shorter, for the
  /// live character count. Conservative on purpose: every span must be one
  /// the detector would also facet.
  public static func findShortenableLinks(_ text: String?) -> [ShortenableLink] {
    guard let text, !text.isEmpty, text.jsIndexOf("://") >= 0 else { return [] }
    let found = UrlMatching.findUrlsAndMentions(text)
    var spans: [ShortenableLink] = []
    for url in found.urls {
      // Bare domains keep their full text.
      if !hasHTTPScheme(caseInsensitive: url.matchText) { continue }
      if found.mentions.contains(where: { $0.start < url.charEnd && url.charStart < $0.end }) { continue }
      if UrlMatching.isPrecededByQuote(text, url.charStart) { continue }
      if !UrlMatching.isValidDomain(url.matchText) { continue }
      if toShortUrl(url.matchText).utf16.elementsEqual(url.matchText.utf16) { continue }
      spans.append(ShortenableLink(charStart: url.charStart, charEnd: url.charEnd, matchText: url.matchText))
    }
    return spans
  }

  /// `text` with its links shortened: what the character count measures.
  public static func shortenPostText(_ text: String?) -> String {
    let links = findShortenableLinks(text)
    guard let text, !links.isEmpty else { return text ?? "" }
    let units = Array(text.utf16)
    var out: [UInt16] = []
    var cursor = 0
    for link in links {
      out.append(contentsOf: units[cursor..<link.charStart])
      out.append(contentsOf: toShortUrl(link.matchText).utf16)
      cursor = link.charEnd
    }
    out.append(contentsOf: units[cursor...])
    return String(jsUnits: out)
  }

  /// Length of a post as the 300-grapheme cap will see it: links shortened,
  /// then counted in grapheme clusters.
  public static func countPostGraphemes(_ text: String?) -> Int {
    Graphemes.countGraphemes(shortenPostText(text))
  }

  /// The `uri` a link facet points at (any truthy value, as the web reads
  /// it), or nil if it isn't a link facet.
  static func linkUri(_ facet: JSONValue) -> JSONValue? {
    guard let features = facet["features"]?.arrayValue else { return nil }
    let link = features.first { $0["$type"]?.stringValue == linkType }
    guard let uri = link?["uri"], uri.isTruthy else { return nil }
    return uri
  }

  /// Rewrites the text each facet covers and moves every facet's byte range
  /// to match. `replacementFor(coveredText, facet)` returns new text, or nil
  /// to leave it. Missing, out-of-order or overlapping facets return the
  /// input untouched: a wrong splice corrupts the post.
  public static func respliceFacets(
    _ text: String?,
    _ facets: [JSONValue]?,
    _ replacementFor: (String, JSONValue) -> String?
  ) -> FacetedJSON {
    let safeFacets = facets ?? []
    guard let text, !text.isEmpty, !safeFacets.isEmpty else {
      return FacetedJSON(text: text ?? "", facets: safeFacets)
    }
    let bytes = Array(text.utf8)
    let ordered = PostingJS.stableSorted(safeFacets) { facet in
      let start = facet["index"]?["byteStart"]
      return start == nil || start == .null ? 0 : start.jsNumber
    }

    struct Replacement {
      var byteStart: Int
      var byteEnd: Int
      var bytes: [UInt8]
    }
    var replacements: [Replacement] = []
    var previousEnd = 0
    for facet in ordered {
      let startValue = facet["index"]?["byteStart"]
      let endValue = facet["index"]?["byteEnd"]
      guard PostingJS.isInteger(startValue), PostingJS.isInteger(endValue),
        let start = startValue?.doubleValue, let end = endValue?.doubleValue
      else { return FacetedJSON(text: text, facets: safeFacets) }
      if start < Double(previousEnd) || end < start || end > Double(bytes.count) {
        return FacetedJSON(text: text, facets: safeFacets)
      }
      let byteStart = Int(start)
      let byteEnd = Int(end)
      previousEnd = byteEnd

      let covered = PostingJS.decodeUTF8(bytes[byteStart..<byteEnd])
      guard let replacement = replacementFor(covered, facet),
        !replacement.utf16.elementsEqual(covered.utf16)
      else { continue }
      replacements.append(Replacement(byteStart: byteStart, byteEnd: byteEnd, bytes: Array(replacement.utf8)))
    }
    if replacements.isEmpty { return FacetedJSON(text: text, facets: safeFacets) }

    var spliced: [UInt8] = []
    var cursor = 0
    for replacement in replacements {
      spliced.append(contentsOf: bytes[cursor..<replacement.byteStart])
      spliced.append(contentsOf: replacement.bytes)
      cursor = replacement.byteEnd
    }
    spliced.append(contentsOf: bytes[cursor...])

    // Shift every facet by the replacements that finished before it.
    func shiftAt(_ byteOffset: Int) -> Int {
      var delta = 0
      for replacement in replacements {
        if byteOffset < replacement.byteEnd { break }
        delta += replacement.bytes.count - (replacement.byteEnd - replacement.byteStart)
      }
      return delta
    }

    let shifted: [JSONValue] = ordered.map { facet in
      let byteStart = facet["index"]!["byteStart"]!.intValue!
      let byteEnd = facet["index"]!["byteEnd"]!.intValue!
      let replacement = replacements.first { $0.byteStart == byteStart && $0.byteEnd == byteEnd }
      let newStart = byteStart + shiftAt(byteStart)
      let newEnd = replacement.map { newStart + $0.bytes.count } ?? (byteEnd + shiftAt(byteEnd))
      var out = facet
      out["index"] = ["byteStart": .number(Double(newStart)), "byteEnd": .number(Double(newEnd))]
      return out
    }
    return FacetedJSON(text: PostingJS.decodeUTF8(spliced), facets: shifted)
  }

  /// `respliceFacets` over typed facets.
  public static func respliceFacets(
    _ text: String?,
    _ facets: [Facet]?,
    _ replacementFor: (String, Facet) -> String?
  ) -> FacetedText {
    let json = (facets ?? []).map { (try? JSONValue(encoding: $0)) ?? .null }
    let result = respliceFacets(text, json) { covered, facet in
      guard let typed = try? facet.decode(Facet.self) else { return nil }
      return replacementFor(covered, typed)
    }
    return FacetedText(text: result.text, facets: result.facets.compactMap { try? $0.decode(Facet.self) })
  }

  /// Record side: each link facet's text becomes its short form; facet
  /// `uri`s keep the full address.
  public static func shortenLinkFacets(_ text: String?, _ facets: [JSONValue]?) -> FacetedJSON {
    respliceFacets(text, facets) { covered, facet in
      linkUri(facet) == nil ? nil : toShortUrl(covered)
    }
  }

  public static func shortenLinkFacets(_ text: String?, _ facets: [Facet]?) -> FacetedText {
    typed(shortenLinkFacets(text, facets.map(json)))
  }

  /// The inverse, for reopening a stored record in the composer: restores
  /// each link's full address. Only expands a facet whose text is exactly
  /// toShortUrl(uri), so hand-written link text is left alone.
  public static func expandLinkFacets(_ text: String?, _ facets: [JSONValue]?) -> FacetedJSON {
    respliceFacets(text, facets) { covered, facet in
      guard let uri = linkUri(facet)?.stringValue, !uri.utf16.elementsEqual(covered.utf16) else { return nil }
      return toShortUrl(uri).utf16.elementsEqual(covered.utf16) ? uri : nil
    }
  }

  public static func expandLinkFacets(_ text: String?, _ facets: [Facet]?) -> FacetedText {
    typed(expandLinkFacets(text, facets.map(json)))
  }

  static func json(_ facets: [Facet]) -> [JSONValue] {
    facets.map { (try? JSONValue(encoding: $0)) ?? .null }
  }

  static func typed(_ result: FacetedJSON) -> FacetedText {
    FacetedText(text: result.text, facets: result.facets.compactMap { try? $0.decode(Facet.self) })
  }
}
