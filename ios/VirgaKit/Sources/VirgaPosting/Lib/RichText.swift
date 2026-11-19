// Ports src/posting/lib/richText.js
//
// Text helpers for rich text: the UTF-16 → UTF-8 offset map facets are
// indexed with, the sanitizer that strips characters which break link
// detection, and the guard for URLs taken from record data.

import Foundation
import VirgaCore

public enum RichText {
  /// Cumulative UTF-8 byte offsets per UTF-16 index (`byteMap[i]` is the
  /// byte offset of code unit `i`; `byteMap[text.jsLength]` is the total).
  /// Both halves of a surrogate pair get the pair's end offset.
  public static func createByteMap(_ str: String) -> [Int] {
    createByteMap(units: Array(str.utf16))
  }

  /// `createByteMap` over raw UTF-16 code units, where a lone surrogate (3
  /// bytes, as U+FFFD) can occur.
  public static func createByteMap(units: [UInt16]) -> [Int] {
    var byteMap = [0]
    byteMap.reserveCapacity(units.count + 1)
    var i = 0
    while i < units.count {
      let code = units[i]
      let last = byteMap[byteMap.count - 1]
      if code >= 0xD800, code <= 0xDBFF, i + 1 < units.count {
        let next = units[i + 1]
        if next >= 0xDC00, next <= 0xDFFF {
          // Both code units get the pair's end offset; the low surrogate is
          // zero-width.
          byteMap.append(last + 4)
          byteMap.append(last + 4)
          i += 2
        } else {
          // A lone high surrogate encodes as U+FFFD (3 bytes).
          byteMap.append(last + 3)
          i += 1
        }
      } else {
        byteMap.append(last + utf8Width(code))
        i += 1
      }
    }
    return byteMap
  }

  /// UTF-8 bytes of one UTF-16 code unit that isn't half of a pair.
  static func utf8Width(_ code: UInt16) -> Int {
    if code < 0x80 { return 1 }
    if code < 0x800 { return 2 }
    return 3  // the rest of the BMP, and a lone surrogate as U+FFFD
  }

  /// The UTF-16 index a byte offset falls in.
  public static func byteToCharIndex(_ byteMap: [Int], _ byteIndex: Int) -> Int {
    guard !byteMap.isEmpty else { return 0 }
    for i in 0..<(byteMap.count - 1) where byteMap[i] <= byteIndex && byteIndex < byteMap[i + 1] {
      return i
    }
    // Exactly at the end: the text length.
    if byteIndex == byteMap[byteMap.count - 1] { return byteMap.count - 1 }
    if byteIndex < 0 { return 0 }
    if byteIndex > byteMap[byteMap.count - 1] { return byteMap.count - 1 }
    return 0
  }

  /// Bytes of `text` in UTF-8: what the lexicon's `maxLength` counts.
  public static func utf8Length(_ text: String?) -> Int {
    (text ?? "").utf8.count
  }

  /// True for the control characters sanitizeText strips: C0 (U+0000-U+001F)
  /// and DEL (U+007F), minus tab, LF and CR. C1 is not included.
  static func isStrippedControlCharacter(_ codePoint: UInt32) -> Bool {
    if codePoint == 0x09 || codePoint == 0x0A || codePoint == 0x0D { return false }
    return codePoint <= 0x1F || codePoint == 0x7F
  }

  /// True when text holds a control character sanitizeText would strip.
  public static func hasStrippedControlCharacter(_ text: String) -> Bool {
    text.unicodeScalars.contains { isStrippedControlCharacter($0.value) }
  }

  /// Remove hidden characters that interfere with URL detection: the
  /// zero-width space, the LRM and RLM marks, the BOM and stray control
  /// characters; a non-breaking space becomes a plain one. The joiners (ZWNJ,
  /// ZWJ) stay: they hold emoji sequences and Persian and Indic words together.
  public static func sanitizeText(_ text: String?) -> String {
    var out = String.UnicodeScalarView()
    for scalar in (text ?? "").unicodeScalars {
      switch scalar.value {
      case 0x200B, 0x200E, 0x200F, 0xFEFF:
        continue
      case 0x00A0:
        out.append(" ")
      default:
        if !isStrippedControlCharacter(scalar.value) { out.append(scalar) }
      }
    }
    return String(out)
  }

  /// A URL taken from record data that may be opened or linked to: absolute
  /// http(s), normalized, so what was checked is what opens; otherwise nil.
  /// (The web takes any value and refuses non-strings; pass nil for those.)
  public static func safeExternalUrl(_ url: String?) -> String? {
    guard let url else { return nil }
    let trimmed = url.jsTrimmed()
    guard !trimmed.isEmpty, let parsed = try? WHATWGURL(trimmed) else { return nil }
    guard parsed.protocolString == "https:" || parsed.protocolString == "http:" else { return nil }
    return parsed.href
  }

  /// `safeExternalUrl` for a value of any JSON type.
  public static func safeExternalUrl(_ url: JSONValue?) -> String? {
    safeExternalUrl(url?.stringValue)
  }
}
