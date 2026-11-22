// Ports harness/fakeXrpc.js (the browser's btoa and atob its service tokens use)
//
// `btoa` and `atob` as a browser and Node have them: a string whose code
// units are bytes (Latin-1), and the forgiving base64 of the WHATWG Infra
// standard (ASCII whitespace skipped, one or two trailing `=` taken off a
// length that is a multiple of four, anything else outside the alphabet
// refused). Both throw the DOMException named InvalidCharacterError, with
// Node's words, where the web's do.

import Foundation
import VirgaCore

enum JSBase64 {
  static let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".utf8)

  static func invalid() -> HarnessJSError {
    HarnessJSError(name: "InvalidCharacterError", message: "Invalid character")
  }

  /// What Node's `atob` throws for a text whose length can't be base64's.
  static func notEncoded() -> HarnessJSError {
    HarnessJSError(name: "InvalidCharacterError", message: "The string to be decoded is not correctly encoded.")
  }

  /// `btoa(text)`: refuses a code unit past U+00FF.
  static func btoa(_ text: String) throws -> String {
    var bytes: [UInt8] = []
    bytes.reserveCapacity(text.utf16.count)
    for unit in text.utf16 {
      guard unit <= 0xFF else { throw invalid() }
      bytes.append(UInt8(unit))
    }
    return encode(bytes)
  }

  static func encode(_ bytes: [UInt8]) -> String {
    var out: [UInt8] = []
    out.reserveCapacity((bytes.count + 2) / 3 * 4)
    var i = 0
    while i + 2 < bytes.count {
      let n = UInt32(bytes[i]) << 16 | UInt32(bytes[i + 1]) << 8 | UInt32(bytes[i + 2])
      out += [alphabet[Int(n >> 18 & 63)], alphabet[Int(n >> 12 & 63)], alphabet[Int(n >> 6 & 63)], alphabet[Int(n & 63)]]
      i += 3
    }
    let rest = bytes.count - i
    if rest == 1 {
      let n = UInt32(bytes[i]) << 16
      out += [alphabet[Int(n >> 18 & 63)], alphabet[Int(n >> 12 & 63)], 0x3D, 0x3D]
    } else if rest == 2 {
      let n = UInt32(bytes[i]) << 16 | UInt32(bytes[i + 1]) << 8
      out += [alphabet[Int(n >> 18 & 63)], alphabet[Int(n >> 12 & 63)], alphabet[Int(n >> 6 & 63)], 0x3D]
    }
    return String(decoding: out, as: UTF8.self)
  }

  static func value(_ unit: UInt16) -> UInt32? {
    switch unit {
    case 0x41...0x5A: return UInt32(unit - 0x41)
    case 0x61...0x7A: return UInt32(unit - 0x61 + 26)
    case 0x30...0x39: return UInt32(unit - 0x30 + 52)
    case 0x2B: return 62
    case 0x2F: return 63
    default: return nil
    }
  }

  /// `atob(text)`: the bytes, which the web holds as a string of Latin-1
  /// characters. Refuses as Node's does: a character outside the alphabet
  /// (or a misplaced `=`) first, then a length base64 can't have.
  static func atob(_ text: String) throws -> [UInt8] {
    let whitespace: [UInt16] = [0x09, 0x0A, 0x0C, 0x0D, 0x20]
    var counted = 0
    var equals = 0
    for unit in text.utf16 where !whitespace.contains(unit) {
      if unit == 0x3D {
        counted += 1
        equals += 1
        if equals > 2 { throw invalid() }
      } else if value(unit) != nil {
        counted += 1
        if equals > 0 { throw invalid() }
      } else {
        throw invalid()
      }
    }
    var remainder = counted % 4
    if remainder == 0 {
      remainder = (counted - equals) % 4
    } else if equals > 0 {
      throw invalid()
    }
    if remainder == 1 { throw notEncoded() }
    let units = text.utf16.filter { !whitespace.contains($0) && $0 != 0x3D }
    var out: [UInt8] = []
    var buffer: UInt32 = 0
    var bits = 0
    for unit in units {
      guard let v = value(unit) else { throw invalid() }
      buffer = buffer << 6 | v
      bits += 6
      if bits == 24 {
        out += [UInt8(buffer >> 16 & 0xFF), UInt8(buffer >> 8 & 0xFF), UInt8(buffer & 0xFF)]
        buffer = 0
        bits = 0
      }
    }
    if bits == 12 {
      out.append(UInt8(buffer >> 4 & 0xFF))
    } else if bits == 18 {
      out += [UInt8(buffer >> 10 & 0xFF), UInt8(buffer >> 2 & 0xFF)]
    }
    return out
  }

  /// Bytes as the string `atob` gives: one Latin-1 character each.
  static func latin1(_ bytes: [UInt8]) -> String {
    String(decoding: bytes.map { UInt16($0) }, as: UTF16.self)
  }
}
