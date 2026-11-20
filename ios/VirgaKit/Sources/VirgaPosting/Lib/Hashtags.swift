// Ports src/posting/lib/hashtags.js
//
// Hashtags in post text, by Bluesky's rule (the `TAG_REGEX` in @atproto/api's
// rich-text detection): a # or ＃ at the start or after whitespace, then any
// run of letters, marks, symbols and digits that isn't all digits, with
// trailing punctuation dropped, at most 64 graphemes. So `#café` and `#日本`
// are tags, `#123` and `#` are not.

import Foundation
import VirgaCore

/// A hashtag found in text: `start` is the `#`, `end` is just past the tag
/// (UTF-16 indexes), `tag` is without the `#`.
public struct HashtagMatch: Codable, Hashable, Sendable {
  public var start: Int
  public var end: Int
  public var tag: String
}

public enum Hashtags {
  public static let maxHashtagGraphemes = 64

  // U+FE0F is the emoji presentation selector, so a keycap emoji (# U+FE0F
  // U+20E3) isn't a tag; the rest are zero-width characters that end a tag.
  static let tagRegex: JSRegex = {
    let s = JSRegex.space
    let ends = #"\u00AD\u2060\u200A\u200B\u200C\u200D\u20E2"#
    return JSRegex(
      "(^|[\(s)])[#\u{FF03}]((?!\\uFE0F)[^\(s)\(ends)]*[^0-9\(s)\\p{P}\(ends)]+[^\(s)\(ends)]*)?")
  }()

  static let trailingPunctuation = JSRegex(#"\p{P}+\z"#)

  /// Every hashtag in `text`.
  public static func findHashtags(_ text: String?) -> [HashtagMatch] {
    guard let text, !text.isEmpty else { return [] }
    let units = Array(text.utf16)
    var found: [HashtagMatch] = []
    for match in tagRegex.matches(in: text) {
      guard let raw = match.group(2, in: units), !raw.isEmpty else { continue }
      let leading = match.group(1, in: units) ?? ""
      var tag = raw.jsTrimmed()
      if let trailing = trailingPunctuation.firstMatch(in: tag) {
        tag = tag.jsSlice(0, trailing.range.lowerBound)
      }
      if !isValidHashtag(tag) { continue }
      let start = match.range.lowerBound + leading.jsLength
      found.append(HashtagMatch(start: start, end: start + 1 + tag.jsLength, tag: tag))
    }
    return found
  }

  /// Whether `tag` (without its `#`) is one Bluesky would facet: non-empty,
  /// not all digits, no whitespace, at most 64 graphemes.
  public static func isValidHashtag(_ tag: String?) -> Bool {
    guard let tag, !tag.isEmpty, !PostingJS.hasSpace(tag) else { return false }
    if tag.utf16.allSatisfy({ (0x30...0x39).contains($0) }) { return false }
    return Graphemes.countGraphemes(tag) <= maxHashtagGraphemes
  }
}
