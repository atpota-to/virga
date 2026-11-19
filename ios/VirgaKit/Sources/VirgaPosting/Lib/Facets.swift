// Ports src/posting/lib/facets.js
//
// Facet detection for post text: mentions, links and hashtags, as the byte
// ranges a record carries. Live (while typing) it skips the network and marks
// mentions with stand-in DIDs for highlighting; on submit every mention is
// resolved and an unresolvable one gets no facet.
//
// Inline links (`[label](url)`) are collapsed before this runs
// (InlineLinks.swift), so this detector never sees the markdown.
//
// The web keeps what the last submit learned about each handle in a module
// Map read with Date.now(); here that is `MentionValidationCache` (a shared
// one by default) and the clock is `options.now`, so tests can hold both.

import Foundation
import VirgaCore

/// A record link found in the text, which the composer embeds.
public struct PostEmbedCandidate: Codable, Hashable, Sendable {
  public var type: String
  public var linkType: String
  public var handle: String
  public var postId: String?
  public var feedId: String?
  public var listId: String?
  public var packId: String?
  public var url: String
  public var charStart: Int
  public var charEnd: Int
  public var byteStart: Int
  public var byteEnd: Int

  init(_ link: DetectedPostLink, charStart: Int, charEnd: Int, byteStart: Int, byteEnd: Int) {
    type = link.type
    linkType = link.linkType
    handle = link.handle
    postId = link.postId
    feedId = link.feedId
    listId = link.listId
    packId = link.packId
    url = link.url
    self.charStart = charStart
    self.charEnd = charEnd
    self.byteStart = byteStart
    self.byteEnd = byteEnd
  }
}

/// A finished external link, a link-card candidate.
public struct ExternalLinkCandidate: Codable, Hashable, Sendable {
  public var url: String
  public var charStart: Int
  public var charEnd: Int
  public var byteStart: Int
  public var byteEnd: Int
}

/// What detectFacets finds. `markdownLinks` is always empty (inline links are
/// collapsed before detection); it is kept for the shape the composer reads.
public struct FacetDetection: Codable, Hashable, Sendable {
  public var facets: [Facet]
  public var postEmbeds: [PostEmbedCandidate]
  public var externalLinks: [ExternalLinkCandidate]
  public var displayText: String?
  public var markdownLinks: [JSONValue]
}

/// What the last submit learned about each handle (the web's module-level
/// `validatedMentions`), so the live preview can highlight a handle it
/// already knows resolves (or knows doesn't).
public final class MentionValidationCache: Sendable {
  public static let shared = MentionValidationCache()
  public static let ttlMs: Double = 5 * 60 * 1000

  public struct Entry: Hashable, Sendable {
    public var did: String?
    public var timestamp: Double
  }

  private let entries = Locked<[String: Entry]>([:])

  public init() {}

  public func get(_ handle: String) -> Entry? {
    entries.withLock { $0[handle] }
  }

  public func set(_ handle: String, _ entry: Entry) {
    entries.withLock { $0[handle] = entry }
  }

  public func removeAll() {
    entries.withLock { $0.removeAll() }
  }
}

/// detectFacets' options.
public struct DetectFacetsOptions: Sendable {
  /// handle → DID, used on submit; defaults to the public AppView.
  public var resolveMention: ResolveMention
  /// True while typing: mentions get cached, `validated:` or `placeholder:`
  /// DIDs instead of a lookup.
  public var skipMentionResolution: Bool
  /// Handles known to resolve.
  public var validatedHandles: Set<String>
  /// Handles known not to (no facet).
  public var invalidatedHandles: Set<String>
  /// Where submits record what they learned (the web's module Map).
  public var validationCache: MentionValidationCache
  /// The clock, in epoch milliseconds (the web's Date.now()).
  public var now: @Sendable () -> Double

  public init(
    resolveMention: ResolveMention? = nil,
    skipMentionResolution: Bool = false,
    validatedHandles: Set<String> = [],
    invalidatedHandles: Set<String> = [],
    validationCache: MentionValidationCache = .shared,
    now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }
  ) {
    self.resolveMention = resolveMention ?? Mentions.resolveMention
    self.skipMentionResolution = skipMentionResolution
    self.validatedHandles = validatedHandles
    self.invalidatedHandles = invalidatedHandles
    self.validationCache = validationCache
    self.now = now
  }
}

public enum Facets {
  static let wordDotWord = JSRegex(#"(?<![A-Za-z0-9_])[A-Za-z0-9_]+\.[A-Za-z0-9_]{2,}(?![A-Za-z0-9_])"#)

  /// The early exit: a mention needs '@', a hashtag '#' or '＃', and a link a
  /// protocol or a word.word domain ('[' is for inline links).
  static func mayHoldFacets(_ text: String) -> Bool {
    let units = Array(text.utf16)
    if units.contains(where: { $0 == 0x40 || $0 == 0x23 || $0 == 0xFF03 || $0 == 0x5B }) { return true }
    let lower = String(jsUnits: units.map { (0x41...0x5A).contains($0) ? $0 + 0x20 : $0 })
    if lower.jsIndexOf("http://") >= 0 || lower.jsIndexOf("https://") >= 0 { return true }
    return wordDotWord.test(text)
  }

  /// Whether a match is the whole content of a quoted string (allowing a
  /// domain/NSID-like continuation), in which case it gets no facet.
  static func isExactlyQuoted(
    _ units: [UInt16], _ matchStart: Int, _ matchEnd: Int, _ matchText: String, _ allowPrefix: Bool
  ) -> Bool {
    let charBefore = matchStart > 0 ? units[matchStart - 1] : nil
    guard charBefore == 0x22 || charBefore == 0x201C else { return false }
    let openQuotePos = matchStart - 1
    let closeQuoteChar: UInt16 = units[openQuotePos] == 0x201C ? 0x201D : 0x22
    var closeQuotePos = -1
    var i = openQuotePos + 1
    while i < units.count {
      if units[i] == closeQuoteChar || units[i] == 0x22 {
        closeQuotePos = i
        break
      }
      i += 1
    }
    if closeQuotePos == -1 { return false }

    let quotedContent = String(jsUnits: units[(openQuotePos + 1)..<closeQuotePos])
    let trimmedQuoted = quotedContent.jsTrimmed()
    let trimmedMatch = matchText.jsTrimmed()
    if !allowPrefix { return trimmedQuoted.utf16.elementsEqual(trimmedMatch.utf16) }

    let matchStartInQuote = quotedContent.jsIndexOf(trimmedMatch)
    let isAtStart =
      matchStartInQuote == 0
      || (matchStartInQuote > 0 && quotedContent.jsSubstring(0, matchStartInQuote).jsTrimmed().isEmpty)
    let isExactMatch = trimmedQuoted.utf16.elementsEqual(trimmedMatch.utf16)
    let rest = trimmedQuoted.jsSubstring(trimmedMatch.jsLength)
    let isValidPrefix =
      isAtStart && PostingJS.hasPrefix(trimmedQuoted, trimmedMatch)
      && rest.utf16.allSatisfy { unit in
        (0x30...0x39).contains(unit) || (0x41...0x5A).contains(unit) || (0x61...0x7A).contains(unit)
          || unit == 0x2E || unit == 0x2F || unit == 0x2D
      }
    let matchEndsAtQuote =
      matchEnd >= closeQuotePos
      || String(jsUnits: units[min(matchEnd, closeQuotePos)..<closeQuotePos]).jsTrimmed().isEmpty
    return (isExactMatch || isValidPrefix) && matchEndsAtQuote
  }

  static func overlaps(_ aStart: Int, _ aEnd: Int, _ bStart: Int, _ bEnd: Int) -> Bool {
    aStart < bEnd && bStart < aEnd
  }

  /// Detect mentions, links and hashtags in `text`. `postEmbeds` are record
  /// links (post, feed, list, starter pack); `externalLinks` are link-card
  /// candidates, offered only once the URL is complete (followed by
  /// whitespace or the end of the text).
  public static func detectFacets(_ text: String?, _ options: DetectFacetsOptions = DetectFacetsOptions()) async
    -> FacetDetection
  {
    var facets: [Facet] = []
    var postEmbeds: [PostEmbedCandidate] = []
    var externalLinks: [ExternalLinkCandidate] = []
    guard let text, mayHoldFacets(text) else {
      return FacetDetection(facets: [], postEmbeds: [], externalLinks: [], displayText: text, markdownLinks: [])
    }

    let units = Array(text.utf16)
    let byteMap = RichText.createByteMap(units: units)
    let cache = options.validationCache
    let now = options.now
    func cachedDid(_ handle: String) -> MentionValidationCache.Entry? {
      guard let cached = cache.get(handle), now() - cached.timestamp < MentionValidationCache.ttlMs else { return nil }
      return cached
    }

    // URLs first: an '@' inside one is part of the address.
    let found = UrlMatching.findUrlsAndMentions(text)

    // Ranges claimed by mentions (and email addresses), so URL detection
    // doesn't link a handle's or an address's domain half.
    var coveredRanges: [(start: Int, end: Int)] = []
    var pendingMentions: [(handle: String, byteStart: Int, byteEnd: Int)] = []

    for mention in found.mentions {
      coveredRanges.append((mention.start, mention.end))
      if mention.email { continue }
      let matchText = String(jsUnits: units[mention.start..<mention.end])
      if isExactlyQuoted(units, mention.start, mention.end, matchText, true) { continue }
      let byteStart = byteMap[mention.start]
      let byteEnd = byteMap[mention.end]
      let handle = mention.handle

      if options.skipMentionResolution {
        let cached = cachedDid(handle)
        let known =
          cached.map { $0.did != nil }
          ?? (options.validatedHandles.contains(handle) && !options.invalidatedHandles.contains(handle))
        if known {
          let did = cached.map { $0.did! } ?? "validated:\(handle)"
          facets.append(Facet(byteStart: byteStart, byteEnd: byteEnd, feature: .mention(did: did)))
        } else if cached == nil, !options.invalidatedHandles.contains(handle) {
          // A stand-in for the preview. A known-bad handle gets none.
          facets.append(Facet(byteStart: byteStart, byteEnd: byteEnd, feature: .mention(did: "placeholder:\(handle)")))
        }
      } else {
        pendingMentions.append((handle, byteStart, byteEnd))
      }
    }

    if !pendingMentions.isEmpty {
      // In parallel, one request per distinct handle; a failure drops that
      // mention's facet, never the post.
      var handles: [String] = []
      for mention in pendingMentions where !handles.contains(mention.handle) { handles.append(mention.handle) }
      let resolve = options.resolveMention
      let dids = await withTaskGroup(of: (String, String?).self) { group in
        for handle in handles {
          group.addTask {
            var did: String?
            do {
              did = try await resolve(handle)
              if did?.isEmpty == true { did = nil }
            } catch {
              did = nil
            }
            cache.set(handle, .init(did: did, timestamp: now()))
            return (handle, did)
          }
        }
        var out: [String: String?] = [:]
        for await (handle, did) in group { out[handle] = did }
        return out
      }
      for mention in pendingMentions {
        if let did = dids[mention.handle] ?? nil {
          facets.append(Facet(byteStart: mention.byteStart, byteEnd: mention.byteEnd, feature: .mention(did: did)))
        }
      }
    }

    func isRangeCovered(_ start: Int, _ end: Int) -> Bool {
      coveredRanges.contains { overlaps(start, end, $0.start, $0.end) }
    }

    for url in found.urls {
      if isRangeCovered(url.charStart, url.charEnd) { continue }
      if UrlMatching.isPrecededByQuote(text, url.charStart) { continue }
      if isExactlyQuoted(units, url.charStart, url.charEnd, url.matchText, false) { continue }

      let matchText = url.matchText
      let fullUrl =
        PostingJS.hasPrefix(matchText, "https://") || PostingJS.hasPrefix(matchText, "http://")
        ? matchText : "https://\(matchText)"

      // "Complete" = followed by whitespace or the end of the text, measured
      // past any trimmed punctuation.
      let isUrlComplete = url.rawEnd >= units.count || PostingJS.isSpace(units[url.rawEnd])
      let byteStart = byteMap[url.charStart]
      let byteEnd = byteMap[url.charEnd]

      if let recordLink = PostLink.detectPostLink(fullUrl) {
        // A record link embeds at once, before a trailing space.
        postEmbeds.append(
          PostEmbedCandidate(
            recordLink, charStart: url.charStart, charEnd: url.charEnd, byteStart: byteStart, byteEnd: byteEnd))
        facets.append(Facet(byteStart: byteStart, byteEnd: byteEnd, feature: .link(uri: fullUrl)))
        continue
      }

      if !UrlMatching.isValidDomain(matchText) { continue }

      facets.append(Facet(byteStart: byteStart, byteEnd: byteEnd, feature: .link(uri: fullUrl)))
      if isUrlComplete {
        externalLinks.append(
          ExternalLinkCandidate(
            url: fullUrl, charStart: url.charStart, charEnd: url.charEnd, byteStart: byteStart, byteEnd: byteEnd))
      }
    }

    // Facets may not overlap, so a tag that runs into a link or a mention is
    // left to that facet.
    for tag in Hashtags.findHashtags(text) {
      let byteStart = byteMap[tag.start]
      let byteEnd = byteMap[tag.end]
      let clash = facets.contains { overlaps(byteStart, byteEnd, $0.index.byteStart, $0.index.byteEnd) }
      if clash { continue }
      facets.append(Facet(byteStart: byteStart, byteEnd: byteEnd, feature: .tag(tag: tag.tag)))
    }

    facets = PostingJS.stableSorted(facets) { Double($0.index.byteStart) }
    return FacetDetection(
      facets: facets, postEmbeds: postEmbeds, externalLinks: externalLinks, displayText: text, markdownLinks: [])
  }

  /// `detectFacets` with positional arguments, the shape the composer's live
  /// preview has always called.
  public static func detectAndCreateFacetsOptimized(
    _ text: String?,
    _ skipMentionResolution: Bool = false,
    _ validatedHandles: Set<String> = [],
    _ invalidatedHandles: Set<String> = [],
    resolveMention: ResolveMention? = nil,
    validationCache: MentionValidationCache = .shared,
    now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }
  ) async -> FacetDetection {
    await detectFacets(
      text,
      DetectFacetsOptions(
        resolveMention: resolveMention, skipMentionResolution: skipMentionResolution,
        validatedHandles: validatedHandles, invalidatedHandles: invalidatedHandles,
        validationCache: validationCache, now: now))
  }
}
