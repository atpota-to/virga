// JavaScript's URI functions: `encodeURIComponent`, `encodeURI` and
// `decodeURIComponent`, as the spec defines them (Encode and Decode in
// ECMA-262 §19.2.6). Foundation's percent-encoding uses other character
// sets and other failure rules, so ports that build or read URLs the way the
// web does use these. ios/parity/cases/core.jsuri.js holds them to Node.

import Foundation

/// `URIError`, with the message V8 gives it.
public struct JSURIError: Error, Equatable, LocalizedError, CustomStringConvertible {
  public let message: String
  public init(_ message: String = "URI malformed") { self.message = message }
  public var errorDescription: String? { message }
  public var description: String { message }
}

public enum JSURI {
  /// What `encodeURIComponent` leaves alone: A–Z a–z 0–9 - _ . ! ~ * ' ( )
  static let unreservedMark = Set("-_.!~*'()".utf8)
  /// What `encodeURI` also leaves alone: ; / ? : @ & = + $ , #
  static let reserved = Set(";/?:@&=+$,#".utf8)

  static func isAlphaNumeric(_ byte: UInt8) -> Bool {
    (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A)
  }

  static let hexDigits = Array("0123456789ABCDEF".utf8)

  static func encode(_ string: String, keep: (UInt8) -> Bool) -> String {
    var out: [UInt8] = []
    out.reserveCapacity(string.utf8.count)
    for byte in string.utf8 {
      if byte < 0x80 && keep(byte) {
        out.append(byte)
      } else {
        out.append(0x25)
        out.append(hexDigits[Int(byte >> 4)])
        out.append(hexDigits[Int(byte & 0x0F)])
      }
    }
    return String(decoding: out, as: UTF8.self)
  }

  /// `encodeURIComponent(string)`. (A Swift string holds no lone surrogate,
  /// so the URIError JavaScript throws for one can't arise.)
  public static func encodeURIComponent(_ string: String) -> String {
    encode(string) { isAlphaNumeric($0) || unreservedMark.contains($0) }
  }

  /// `encodeURI(string)`.
  public static func encodeURI(_ string: String) -> String {
    encode(string) { isAlphaNumeric($0) || unreservedMark.contains($0) || reserved.contains($0) }
  }

  static func hexValue(_ unit: UInt16) -> UInt8? {
    switch unit {
    case 0x30...0x39: return UInt8(unit - 0x30)
    case 0x41...0x46: return UInt8(unit - 0x41 + 10)
    case 0x61...0x66: return UInt8(unit - 0x61 + 10)
    default: return nil
    }
  }

  /// `decodeURIComponent(string)`: every %XX sequence decoded as UTF-8.
  /// Throws `JSURIError` ("URI malformed") where JavaScript throws: a `%`
  /// without two hex digits after it, or bytes that aren't well-formed UTF-8
  /// (overlong forms and surrogates included).
  public static func decodeURIComponent(_ string: String) throws -> String {
    try decode(string, reservedSet: [])
  }

  /// `decodeURI(string)`: as decodeURIComponent, but an escape of a reserved
  /// character (; / ? : @ & = + $ , #) stays as it was written.
  public static func decodeURI(_ string: String) throws -> String {
    try decode(string, reservedSet: reserved)
  }

  static func decode(_ string: String, reservedSet: Set<UInt8>) throws -> String {
    let units = Array(string.utf16)
    guard units.contains(0x25) else { return string }
    var out: [UInt16] = []
    out.reserveCapacity(units.count)
    var k = 0
    func byte(at index: Int) throws -> UInt8 {
      guard index + 2 < units.count + 0, units[index] == 0x25,
        let high = hexValue(units[index + 1]), let low = hexValue(units[index + 2])
      else { throw JSURIError() }
      return high << 4 | low
    }
    while k < units.count {
      let unit = units[k]
      if unit != 0x25 {
        out.append(unit)
        k += 1
        continue
      }
      let start = k
      guard k + 2 < units.count else { throw JSURIError() }
      let b = try byte(at: k)
      k += 3
      if b < 0x80 {
        if reservedSet.contains(b) {
          out.append(contentsOf: units[start..<k])
        } else {
          out.append(UInt16(b))
        }
        continue
      }
      // The count of leading one bits says how long the sequence is.
      let n = b >= 0xF0 ? (b >= 0xF8 ? 0 : 4) : b >= 0xE0 ? 3 : b >= 0xC0 ? 2 : 1
      if n == 1 || n == 0 { throw JSURIError() }
      var octets = [b]
      for _ in 1..<n {
        guard k + 2 < units.count else { throw JSURIError() }
        let next = try byte(at: k)
        guard next & 0xC0 == 0x80 else { throw JSURIError() }
        octets.append(next)
        k += 3
      }
      guard let scalar = decodeUTF8(octets) else { throw JSURIError() }
      out.append(contentsOf: Character(scalar).utf16)
    }
    return String(decoding: out, as: UTF16.self)
  }

  /// One scalar from its UTF-8 bytes, rejecting overlong forms, surrogates
  /// and anything past U+10FFFF.
  static func decodeUTF8(_ octets: [UInt8]) -> Unicode.Scalar? {
    let value: UInt32
    switch octets.count {
    case 2:
      value = UInt32(octets[0] & 0x1F) << 6 | UInt32(octets[1] & 0x3F)
      guard value >= 0x80 else { return nil }
    case 3:
      value = UInt32(octets[0] & 0x0F) << 12 | UInt32(octets[1] & 0x3F) << 6 | UInt32(octets[2] & 0x3F)
      guard value >= 0x800, !(0xD800...0xDFFF).contains(value) else { return nil }
    case 4:
      value = UInt32(octets[0] & 0x07) << 18 | UInt32(octets[1] & 0x3F) << 12
        | UInt32(octets[2] & 0x3F) << 6 | UInt32(octets[3] & 0x3F)
      guard value >= 0x10000, value <= 0x10FFFF else { return nil }
    default:
      return nil
    }
    return Unicode.Scalar(value)
  }
}
