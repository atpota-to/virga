// Ports src/posting/lib/inlineLinks.js
//
// Inline links: `[label](url)` in the composer becomes `label` in the post,
// with a link facet over it pointing at `url`. A link facet's text and its
// `uri` are independent in the record, so this is ordinary rich text to every
// reader; the markdown exists only in the composer.
//
// The editor keeps the markdown while you write. It collapses when the post
// is written (`detectComposerFacets`), and a stored post reopened for editing
// gets its markdown back (`composerTextFromRecord`).
//
// Two rules hold everywhere:
// - Any word in a label that reads as a web address must name the site the
//   link goes to. `[bsky.app](https://elsewhere.example)` is refused: it stays
//   as typed, so it posts literally and the real address shows.
// - An inline link never becomes a link card or a quote embed.

import Foundation
import VirgaCore

/// An inline link in the composer's text. Character offsets are UTF-16
/// indexes into that text.
public struct InlineLink: Codable, Hashable, Sendable {
  public var start: Int
  public var end: Int
  public var labelStart: Int
  public var labelEnd: Int
  public var label: String
  public var uri: String
  public var misleading: Bool

  public var span: InlineLinkSpan {
    InlineLinkSpan(start: start, end: end, labelStart: labelStart, labelEnd: labelEnd, uri: uri)
  }
}

/// What applyInlineLinks needs of a link: the range to clear and the label
/// to link.
public struct InlineLinkSpan: Codable, Hashable, Sendable {
  public var start: Int
  public var end: Int
  public var labelStart: Int
  public var labelEnd: Int
  public var uri: String
  public init(start: Int, end: Int, labelStart: Int, labelEnd: Int, uri: String) {
    self.start = start
    self.end = end
    self.labelStart = labelStart
    self.labelEnd = labelEnd
    self.uri = uri
  }
}

/// A link's label in the collapsed text.
public struct CollapsedLink: Codable, Hashable, Sendable {
  public var charStart: Int
  public var charEnd: Int
  public var label: String
  public var uri: String
}

/// The composer's text with each inline link replaced by its label.
public struct CollapsedText: Codable, Hashable, Sendable {
  public var text: String
  public var links: [CollapsedLink]
}

/// Facets, embeds and cards after inline links are folded in.
public struct InlineLinkFacets: Codable, Hashable, Sendable {
  public var facets: [Facet]
  public var postEmbeds: [PostEmbedCandidate]
  public var externalLinks: [ExternalLinkCandidate]
}

/// detectComposerFacets' result: `text` is what the record carries before
/// link shortening; `facets` index into it.
public struct ComposerFacetDetection: Codable, Hashable, Sendable {
  public var text: String
  public var facets: [Facet]
  public var postEmbeds: [PostEmbedCandidate]
  public var externalLinks: [ExternalLinkCandidate]
  public var displayText: String?
  public var markdownLinks: [JSONValue]
}

public enum InlineLinks {
  static let linkType = "app.bsky.richtext.facet#link"

  static let otherScheme = JSRegex(#"^[a-zA-Z][a-zA-Z0-9+.\-]*:"#)
  static let hostAndPort = JSRegex(#"^[^:]+:[0-9]"#)

  /// The address an inline link's `(…)` part points at, with `https://`
  /// added to a bare domain, or nil when it isn't an http(s) address on a
  /// real domain (so `[a](b)` in ordinary prose stays prose).
  public static func linkDestination(_ destination: String?) -> String? {
    guard let destination, !destination.isEmpty, !PostingJS.hasPrefix(destination, "/") else { return nil }
    let uri: String
    if LinkShortening.hasHTTPScheme(caseInsensitive: destination) {
      uri = destination
    } else if otherScheme.test(destination), !hostAndPort.test(destination) {
      return nil  // another scheme (mailto:, at:, javascript:); a port after a bare host is fine
    } else {
      uri = "https://\(destination)"
    }
    guard let url = try? WHATWGURL(uri) else { return nil }
    guard url.protocolString == "http:" || url.protocolString == "https:" else { return nil }
    guard UrlMatching.isValidDomain(url.hostname) else { return nil }
    return uri
  }

  static func bareHost(_ host: String) -> String {
    let lower = host.jsLowercased()
    return PostingJS.hasPrefix(lower, "www.") ? String(jsUnits: lower.utf16.dropFirst(4)) : lower
  }

  // The domain a word starts with, past an opening bracket or quote, a scheme
  // or an @. The web's `/iu` matches by simple case folding, written out
  // here: `s` also matches the long s (ſ), and `[\p{L}\p{N}]` also matches
  // U+0345 COMBINING GREEK YPOGEGRAMMENI, a mark that folds to the letter ι
  // (the only code point outside the two classes that folds into them).
  static let namedDomain = JSRegex(
    #"^[(\["'“‘]*(?:[hH][tT][tT][pP][sSſ]?://)?@?((?:[\p{L}\p{N}ͅ](?:[\p{L}\p{N}ͅ\-]*[\p{L}\p{N}ͅ])?\.)+[\p{L}\p{N}ͅ\-]{2,})"#
  )

  /// The hosts a label names: every word that reads as a web address or a
  /// handle. Empty for a label that is just words.
  static func namedHosts(_ label: String?) -> [String] {
    var hosts: [String] = []
    for word in PostingJS.splitOnWhitespace(label ?? "") {
      guard let match = namedDomain.firstMatch(in: word),
        let domain = match.group(1, in: Array(word.utf16)),
        UrlMatching.isValidDomain(domain)
      else { continue }
      if let url = try? WHATWGURL("https://\(domain)") {
        hosts.append(url.hostname)
      } else {
        // Can't be normalized, so it can't be shown to match: compared as written.
        hosts.append(domain)
      }
    }
    return hosts
  }

  /// Whether text is a single web address (or handle), the selection a
  /// pasted address should replace rather than link.
  public static func isSingleAddress(_ text: String?) -> Bool {
    let words = PostingJS.splitOnWhitespace((text ?? "").jsTrimmed())
    return words.count == 1 && namedHosts(words[0]).count == 1
  }

  /// Whether a label names a different site than the link goes to. Hosts are
  /// compared exactly apart from a leading `www.`; a subdomain is a different
  /// host.
  public static func labelMisleads(_ label: String?, _ uri: String) -> Bool {
    let named = namedHosts(label)
    if named.isEmpty { return false }
    guard let url = try? WHATWGURL(uri) else { return true }
    let host = bareHost(url.hostname)
    return named.contains { !bareHost($0).utf16.elementsEqual(host.utf16) }
  }

  /// The inline link whose `[` is at `open`, or nil.
  static func parseAt(_ units: [UInt16], _ open: Int) -> InlineLink? {
    var close = -1
    var k = open + 1
    while k < units.count {
      let ch = units[k]
      if ch == 0x5D {
        close = k
        break
      }
      if ch == 0x5B || ch == 0x0A { return nil }
      k += 1
    }
    guard close != -1, close + 1 < units.count, units[close + 1] == 0x28 else { return nil }
    let label = String(jsUnits: units[(open + 1)..<close])
    if label.jsTrimmed().isEmpty { return nil }

    // Balanced parentheses, so `en.wikipedia.org/wiki/Bee_(disambiguation)` works.
    var depth = 1
    var end = -1
    k = close + 2
    while k < units.count {
      let ch = units[k]
      if PostingJS.isSpace(ch) { return nil }
      if ch == 0x28 {
        depth += 1
      } else if ch == 0x29 {
        depth -= 1
        if depth == 0 {
          end = k + 1
          break
        }
      }
      k += 1
    }
    if end == -1 { return nil }

    guard let uri = linkDestination(String(jsUnits: units[(close + 2)..<(end - 1)])) else { return nil }
    return InlineLink(
      start: open, end: end, labelStart: open + 1, labelEnd: close, label: label, uri: uri,
      misleading: labelMisleads(label, uri))
  }

  /// Every `[label](url)` in `text`, in order and never overlapping.
  /// Misleading ones are included with `misleading: true` so the composer can
  /// say why they won't become links.
  public static func findInlineLinks(_ text: String?) -> [InlineLink] {
    guard let text, !text.isEmpty, text.jsIndexOf("](") >= 0 else { return [] }
    let units = Array(text.utf16)
    var links: [InlineLink] = []
    var i = 0
    while i < units.count {
      guard let open = units[i...].firstIndex(of: 0x5B) else { break }
      if let link = parseAt(units, open) {
        links.append(link)
        i = link.end
      } else {
        i = open + 1
      }
    }
    return links
  }

  /// `text` with each inline link replaced by its label. `links` gives each
  /// label's range in the returned text. Misleading links stay as typed.
  public static func collapseInlineLinks(_ text: String?) -> CollapsedText {
    let found = findInlineLinks(text).filter { !$0.misleading }
    guard let text, !found.isEmpty else { return CollapsedText(text: text ?? "", links: []) }
    let units = Array(text.utf16)
    var out: [UInt16] = []
    var cursor = 0
    var links: [CollapsedLink] = []
    for link in found {
      out.append(contentsOf: units[cursor..<link.start])
      let charStart = out.count
      out.append(contentsOf: link.label.utf16)
      links.append(CollapsedLink(charStart: charStart, charEnd: out.count, label: link.label, uri: link.uri))
      cursor = link.end
    }
    out.append(contentsOf: units[cursor...])
    return CollapsedText(text: String(jsUnits: out), links: links)
  }

  static func overlaps(_ aStart: Int, _ aEnd: Int, _ bStart: Int, _ bEnd: Int) -> Bool {
    aStart < bEnd && bStart < aEnd
  }

  /// Folds inline links into a facet-detection result for the same `text`.
  /// Anything detected inside a link's range is dropped, and each link gets
  /// a facet over its label. A range that isn't in `text` is passed over
  /// (the web would write a facet without offsets).
  public static func applyInlineLinks(
    _ text: String,
    _ ranges: [InlineLinkSpan],
    facets: [Facet],
    postEmbeds: [PostEmbedCandidate],
    externalLinks: [ExternalLinkCandidate]
  ) -> InlineLinkFacets {
    let byteMap = RichText.createByteMap(text)
    let ranges = ranges.filter { range in
      [range.start, range.end, range.labelStart, range.labelEnd].allSatisfy(byteMap.indices.contains)
    }
    if ranges.isEmpty { return InlineLinkFacets(facets: facets, postEmbeds: postEmbeds, externalLinks: externalLinks) }
    let byteRanges = ranges.map { (start: byteMap[$0.start], end: byteMap[$0.end]) }
    func clearOf(_ start: Int, _ end: Int) -> Bool {
      !byteRanges.contains { overlaps(start, end, $0.start, $0.end) }
    }
    func charClearOf(_ start: Int, _ end: Int) -> Bool {
      !ranges.contains { overlaps(start, end, $0.start, $0.end) }
    }
    let kept = facets.filter { clearOf($0.index.byteStart, $0.index.byteEnd) }
    let added = ranges.map {
      Facet(byteStart: byteMap[$0.labelStart], byteEnd: byteMap[$0.labelEnd], feature: .link(uri: $0.uri))
    }
    return InlineLinkFacets(
      facets: PostingJS.stableSorted(kept + added) { Double($0.index.byteStart) },
      postEmbeds: postEmbeds.filter { charClearOf($0.charStart, $0.charEnd) },
      externalLinks: externalLinks.filter { charClearOf($0.charStart, $0.charEnd) })
  }

  /// `applyInlineLinks(text, ranges, result)` over a detection result.
  public static func applyInlineLinks(_ text: String, _ ranges: [InlineLinkSpan], _ result: FacetDetection?)
    -> InlineLinkFacets
  {
    applyInlineLinks(
      text, ranges, facets: result?.facets ?? [], postEmbeds: result?.postEmbeds ?? [],
      externalLinks: result?.externalLinks ?? [])
  }

  /// Facet detection for the composer's text, inline links included: the
  /// text is collapsed first and everything is detected on what will be
  /// written.
  public static func detectComposerFacets(_ text: String?, _ options: DetectFacetsOptions = DetectFacetsOptions())
    async -> ComposerFacetDetection
  {
    let collapsed = collapseInlineLinks(text)
    let result = await Facets.detectFacets(collapsed.text, options)
    let ranges = collapsed.links.map {
      InlineLinkSpan(start: $0.charStart, end: $0.charEnd, labelStart: $0.charStart, labelEnd: $0.charEnd, uri: $0.uri)
    }
    let applied = applyInlineLinks(collapsed.text, ranges, result)
    return ComposerFacetDetection(
      text: collapsed.text, facets: applied.facets, postEmbeds: applied.postEmbeds,
      externalLinks: applied.externalLinks, displayText: result.displayText, markdownLinks: result.markdownLinks)
  }

  /// The text the 300-grapheme cap will measure: inline links collapsed to
  /// their labels, then shortened exactly as `shortenLinkFacets` will write
  /// it. A label that is itself an address shortens like any link.
  public static func composerCountText(_ text: String?) -> String {
    let collapsed = collapseInlineLinks(text)
    var spans: [(charStart: Int, charEnd: Int, replacement: String)] = []
    for s in LinkShortening.findShortenableLinks(collapsed.text)
    where !collapsed.links.contains(where: { overlaps(s.charStart, s.charEnd, $0.charStart, $0.charEnd) }) {
      spans.append((s.charStart, s.charEnd, LinkShortening.toShortUrl(s.matchText)))
    }
    for l in collapsed.links {
      spans.append((l.charStart, l.charEnd, LinkShortening.toShortUrl(l.label)))
    }
    spans = PostingJS.stableSorted(spans) { Double($0.charStart) }
    let units = Array(collapsed.text.utf16)
    var out: [UInt16] = []
    var cursor = 0
    for span in spans {
      out.append(contentsOf: units[min(cursor, span.charStart)..<span.charStart])
      out.append(contentsOf: span.replacement.utf16)
      cursor = span.charEnd
    }
    out.append(contentsOf: units[min(cursor, units.count)...])
    return String(jsUnits: out)
  }

  /// The composer's length against the 300-grapheme cap, inline links included.
  public static func countComposerGraphemes(_ text: String?) -> Int {
    Graphemes.countGraphemes(composerCountText(text ?? ""))
  }

  /// A destination written so the parser reads it back whole.
  static func markdownDestination(_ uri: String) -> String {
    var depth = 0
    for scalar in uri.unicodeScalars {
      if scalar == "(" {
        depth += 1
      } else if scalar == ")" {
        depth -= 1
        if depth < 0 { break }
      }
    }
    if depth == 0 { return uri }
    var out = String.UnicodeScalarView()
    for scalar in uri.unicodeScalars {
      switch scalar {
      case "(": out.append(contentsOf: "%28".unicodeScalars)
      case ")": out.append(contentsOf: "%29".unicodeScalars)
      default: out.append(scalar)
      }
    }
    return String(out)
  }

  static let bracketOrNewline = JSRegex(#"[\[\]\n]"#)

  /// A stored post's text as the composer should hold it: shortened links
  /// expanded, and every link whose text isn't its own address turned back
  /// into `[label](uri)`. A link that couldn't be read back is left as text.
  public static func composerTextFromRecord(_ text: String?, _ facets: [JSONValue]?) -> String {
    let expanded = LinkShortening.expandLinkFacets(text ?? "", facets)
    return LinkShortening.respliceFacets(expanded.text, expanded.facets) { covered, facet in
      let link = facet["features"]?.arrayValue?.first { $0["$type"]?.stringValue == linkType }
      guard let uriValue = link?["uri"], uriValue.isTruthy, let uri = uriValue.stringValue else { return nil }
      // How facet detection writes a link it found in the text.
      if uri.utf16.elementsEqual(covered.utf16) || uri.utf16.elementsEqual("https://\(covered)".utf16) { return nil }
      if covered.jsTrimmed().isEmpty || bracketOrNewline.test(covered) { return nil }
      let markdown = "[\(covered)](\(markdownDestination(uri)))"
      guard let reread = findInlineLinks(markdown).first, reread.start == 0, reread.end == markdown.jsLength else {
        return nil
      }
      return markdown
    }.text
  }

  /// `composerTextFromRecord` over typed facets.
  public static func composerTextFromRecord(_ text: String?, _ facets: [Facet]?) -> String {
    composerTextFromRecord(text, facets.map(LinkShortening.json))
  }
}
