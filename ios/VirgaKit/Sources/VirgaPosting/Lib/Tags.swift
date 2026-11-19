// Ports src/posting/lib/tags.js
//
// The post record's `tags` field: tags that travel with the post without
// appearing in its text. The lexicon allows 8, each at most 64 graphemes and
// 640 bytes; a record over either is refused by the PDS.

import Foundation
import VirgaCore

public enum Tags {
  public static let maxTags = 8
  public static let maxTagGraphemes = 64
  public static let maxTagBytes = 640

  static func clampTag(_ tag: String) -> String {
    var out = Graphemes.truncateGraphemes(tag, maxTagGraphemes)
    // Graphemes made of many code points (ZWJ sequences) can still run past
    // the byte cap; give up whole graphemes until it fits.
    while !out.isEmpty, out.utf8.count > maxTagBytes {
      out = String(out.dropLast())
    }
    return out
  }

  static let leadingHashes = JSRegex("^[#\u{FF03}]+")

  /// Tags as the record should carry them, from a comma-separated string or
  /// an array (the web takes either, or anything it can make a string of):
  /// each with hidden characters and leading `#`s removed and trimmed, empty
  /// ones dropped, deduplicated without regard to case (the first spelling
  /// wins), clamped to 64 graphemes, and at most 8.
  public static func normalizeTags(_ input: JSONValue?) -> [String] {
    guard let input, input.isTruthy else { return [] }
    let pieces: [JSONValue]
    if case .array(let values) = input {
      pieces = values
    } else {
      pieces = Array(input.jsString.utf16).split(separator: 0x2C, omittingEmptySubsequences: false)
        .map { .string(String(jsUnits: $0)) }
    }
    var seen = Set<[UInt16]>()
    var tags: [String] = []
    for piece in pieces {
      guard case .string(let text) = piece else { continue }
      var cleaned = RichText.sanitizeText(text).jsTrimmed()
      if let hashes = leadingHashes.firstMatch(in: cleaned) {
        cleaned = cleaned.jsSlice(hashes.range.upperBound)
      }
      let tag = clampTag(cleaned.jsTrimmed())
      if tag.isEmpty { continue }
      let key = Array(PostingJS.toLowerCase(tag).utf16)
      if seen.contains(key) { continue }
      seen.insert(key)
      tags.append(tag)
      if tags.count >= maxTags { break }
    }
    return tags
  }

  /// `normalizeTags` of comma-separated text.
  public static func normalizeTags(_ text: String?) -> [String] {
    normalizeTags(text.map(JSONValue.string))
  }

  /// `normalizeTags` of a list.
  public static func normalizeTags(_ list: [String]) -> [String] {
    normalizeTags(.array(list.map(JSONValue.string)))
  }

  /// Tags as the comma-separated text a field shows.
  public static func formatTags(_ tags: [String]?) -> String {
    (tags ?? []).joined(separator: ", ")
  }

  /// `formatTags` of any value: a non-array is no tags, and elements join as
  /// JavaScript's `join` writes them (null as nothing).
  public static func formatTags(_ tags: JSONValue?) -> String {
    guard case .array(let values)? = tags else { return "" }
    return values.map { $0.isNull ? "" : $0.jsString }.joined(separator: ", ")
  }
}
