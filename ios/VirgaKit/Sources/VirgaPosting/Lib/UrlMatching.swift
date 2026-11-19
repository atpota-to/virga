// Ports src/posting/lib/urlMatching.js
//
// What counts as a URL in post text. Shared by facet detection (Facets.swift)
// and length counting (LinkShortening.swift), which must agree or the
// composer's character count stops matching the written post. Both read URLs
// through findUrlsAndMentions, never the raw regex.

import Foundation
import VirgaCore

/// A URL hit in text: the trimmed range and where the untrimmed hit ended.
public struct UrlMatch: Codable, Hashable, Sendable {
  public var charStart: Int
  public var charEnd: Int
  public var matchText: String
  public var rawEnd: Int
}

/// The URLs in a text, and the mentions and email addresses apart from them.
public struct UrlsAndMentions: Codable, Hashable, Sendable {
  public var urls: [UrlMatch]
  public var mentions: [MentionMatch]
}

public enum UrlMatching {
  /// The URL matcher: protocol URLs and bare domains, stopping at whitespace,
  /// quotes and `,;!…`. A hit can still end in sentence punctuation;
  /// trimUrlMatch takes that off. The web's `/gi` regex, with its `i` written
  /// out as explicit classes (see JSRegex.swift).
  public static let urlPattern: String = {
    let s = JSRegex.space
    let stop = ",;!…\"\u{201C}\u{201D}"
    return "[hH][tT][tT][pP][sS]?://[^\(s)\(stop)]+?(?=[\(stop)\(s)]|\\z)"
      + "|(?:[wW][wW][wW]\\.)?[a-zA-Z0-9]+(?:[.\\-]+[a-zA-Z0-9]+)*\\.(?:[a-zA-Z]{2,}|[xX][nN]--[a-zA-Z0-9]+)"
      + "(?:/[^\(s)\(stop)]*)?(?:\\?[^\(s)\(stop)]*)?(?:#[^\(s)\(stop)]*)?(?=[.\(stop)\(s)]|\\z)"
  }()

  static let urlRegex = JSRegex(urlPattern)

  /// `createUrlRegex()`: the matcher (immutable here, so one is shared).
  static func createUrlRegex() -> JSRegex { urlRegex }

  /// Every raw hit of the URL matcher, as `text.matchAll(createUrlRegex())`.
  public static func urlRegexMatches(_ text: String) -> [String] {
    let units = Array(text.utf16)
    return urlRegex.matches(in: text).map { String(jsUnits: units[$0.range]) }
  }

  static func count(_ units: [UInt16], _ unit: UInt16) -> Int {
    units.reduce(0) { $0 + ($1 == unit ? 1 : 0) }
  }

  /// A regex hit without the punctuation that ends the sentence around it,
  /// as Bluesky's detector trims it: a run of `.,;:!?`, a `)` or `]` with no
  /// partner inside the URL, and a closing `>` or markdown `*`.
  public static func trimUrlMatch(_ matchText: String) -> String {
    var out = Array(matchText.utf16)
    while let last = out.last {
      switch last {
      case 0x2E, 0x2C, 0x3B, 0x3A, 0x21, 0x3F, 0x3E, 0x2A:
        out.removeLast()
      case 0x29 where count(out, 0x29) > count(out, 0x28):
        out.removeLast()
      case 0x5D where count(out, 0x5D) > count(out, 0x5B):
        out.removeLast()
      default:
        return String(jsUnits: out)
      }
    }
    return ""
  }

  /// The URLs in `text`, trimmed, and the mentions and email addresses that
  /// stand apart from them. An `@` inside a URL that started before it
  /// belongs to the URL, as on Bluesky.
  public static func findUrlsAndMentions(_ text: String) -> UrlsAndMentions {
    let units = Array(text.utf16)
    var urls: [UrlMatch] = []
    for match in urlRegex.matches(in: text) {
      let raw = String(jsUnits: units[match.range])
      let matchText = trimUrlMatch(raw)
      if matchText.isEmpty { continue }
      let charStart = match.range.lowerBound
      urls.append(
        UrlMatch(
          charStart: charStart, charEnd: charStart + matchText.jsLength, matchText: matchText,
          rawEnd: charStart + match.range.count))
    }
    let mentions = Mentions.findMentions(units: units).filter { mention in
      !urls.contains { $0.charStart < mention.start && mention.start < $0.charEnd }
    }
    return UrlsAndMentions(urls: urls, mentions: mentions)
  }

  static let versionPattern = JSRegex(#"^v?[0-9]+\.[0-9]+"#)
  static let ipPattern = JSRegex(#"^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\z"#)
  static let filePattern = JSRegex(
    #"^[a-zA-Z0-9]+\.(txt|jpg|jpeg|png|gif|pdf|doc|docx|zip|rar|tar|gz|mp3|mp4|avi|mov|css|js|json|xml|html|htm)\z"#)

  /// Whether a (deliberately loose) regex hit is a real domain, not a version
  /// number, IP or filename like `v1.2.3` or `notes.txt`.
  public static func isValidDomain(_ domain: String) -> Bool {
    var clean = Array(domain.utf16)[...]
    if PostingJS.hasPrefix(clean, "https://") {
      clean = clean.dropFirst(8)
    } else if PostingJS.hasPrefix(clean, "http://") {
      clean = clean.dropFirst(7)
    }
    if PostingJS.hasPrefix(clean, "www.") { clean = clean.dropFirst(4) }
    let domainOnly = String(jsUnits: clean.split(separator: 0x2F, omittingEmptySubsequences: false).first ?? [])
    let parts = Array(domainOnly.utf16).split(separator: 0x2E, omittingEmptySubsequences: false)
    if parts.count < 2 { return false }
    for pattern in [versionPattern, ipPattern, filePattern] where pattern.test(domainOnly) { return false }
    let tld = parts[parts.count - 1]
    if tld.count < 2 || tld.allSatisfy({ (0x30...0x39).contains($0) }) { return false }
    let domainName = parts[parts.count - 2]
    if domainName.count < 1 || domainName.count > 63 { return false }
    return true
  }

  /// Whether a match directly follows an opening double quote, straight or
  /// curly. A quoted URL gets no facet, so it isn't shortened either.
  public static func isPrecededByQuote(_ text: String, _ charStart: Int) -> Bool {
    guard charStart > 0, let before = text.jsCharCodeAt(charStart - 1) else { return false }
    return before == 0x22 || before == 0x201C
  }
}
