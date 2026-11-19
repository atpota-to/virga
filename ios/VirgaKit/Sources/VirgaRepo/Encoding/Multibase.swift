// The text encodings of bytes the repo code uses, as @atcute/multibase
// implements them: base32 (RFC 4648, lowercase, unpadded), the body of
// every CID string after its 'b' prefix; and base64 (standard alphabet),
// unpadded for the `$bytes` of the data model's JSON form, padded where a
// value ends in '='.
//
// Decoding is strict as the web's is: a string is accepted only if it is
// exactly what encoding its bytes gives back, so stray characters, wrong
// padding and non-zero trailing bits are all refused.

import Foundation

public enum Multibase {
  // MARK: base32

  static let base32Alphabet = Array("abcdefghijklmnopqrstuvwxyz234567".utf8)

  static let base32Lookup: [UInt8] = {
    var table = [UInt8](repeating: 0xff, count: 128)
    for (index, char) in base32Alphabet.enumerated() { table[Int(char)] = UInt8(index) }
    return table
  }()

  /// Unpadded lowercase RFC 4648 base32.
  public static func toBase32(_ bytes: some Collection<UInt8>) -> String {
    var out: [UInt8] = []
    out.reserveCapacity((bytes.count * 8 + 4) / 5)
    var buffer: UInt32 = 0
    var bits = 0
    for byte in bytes {
      buffer = (buffer << 8) | UInt32(byte)
      bits += 8
      while bits >= 5 {
        bits -= 5
        out.append(base32Alphabet[Int((buffer >> UInt32(bits)) & 0x1f)])
      }
      buffer &= (1 << UInt32(bits)) - 1
    }
    if bits > 0 {
      out.append(base32Alphabet[Int((buffer << UInt32(5 - bits)) & 0x1f)])
    }
    return String(decoding: out, as: UTF8.self)
  }

  /// The bytes of an unpadded lowercase base32 string. Throws "invalid base
  /// string" for a character outside the alphabet and "unexpected end of
  /// data" for a length or trailing bits no encoding produces.
  public static func fromBase32(_ string: String) throws -> [UInt8] {
    let units = Array(string.utf16)
    let end = units.count
    var bytes: [UInt8] = []
    bytes.reserveCapacity(end * 5 / 8)
    let fullGroups = end - end % 8
    var i = 0
    // Whole groups of eight characters: a non-ASCII or unknown character
    // anywhere in the group fails the group.
    while i < fullGroups {
      var values = [UInt8](repeating: 0, count: 8)
      for j in 0..<8 {
        let code = units[i + j]
        guard code < 0x80 else { throw RepoError.syntax("invalid base string") }
        values[j] = base32Lookup[Int(code)]
      }
      guard values.allSatisfy({ $0 & 0xe0 == 0 }) else { throw RepoError.syntax("invalid base string") }
      let c = values.map(UInt32.init)
      bytes.append(UInt8(truncatingIfNeeded: (c[0] << 3) | (c[1] >> 2)))
      bytes.append(UInt8(truncatingIfNeeded: (c[1] << 6) | (c[2] << 1) | (c[3] >> 4)))
      bytes.append(UInt8(truncatingIfNeeded: (c[3] << 4) | (c[4] >> 1)))
      bytes.append(UInt8(truncatingIfNeeded: (c[4] << 7) | (c[5] << 2) | (c[6] >> 3)))
      bytes.append(UInt8(truncatingIfNeeded: (c[6] << 5) | c[7]))
      i += 8
    }
    if i < end {
      var bits = 0
      var buffer: UInt32 = 0
      while i < end {
        let code = units[i]
        let value = code < 0x80 ? base32Lookup[Int(code)] : 0xff
        guard value & 0xe0 == 0 else { throw RepoError.syntax("invalid base string") }
        buffer = (buffer &<< 5) | UInt32(value)
        bits += 5
        if bits >= 8 {
          bits -= 8
          bytes.append(UInt8(truncatingIfNeeded: buffer >> UInt32(bits)))
        }
        i += 1
      }
      if bits >= 5 || UInt8(truncatingIfNeeded: buffer &<< UInt32(8 - bits)) != 0 {
        throw RepoError.syntax("unexpected end of data")
      }
    }
    return bytes
  }

  // MARK: base64

  static let base64Alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".utf8)

  static let base64Lookup: [UInt8] = {
    var table = [UInt8](repeating: 0xff, count: 128)
    for (index, char) in base64Alphabet.enumerated() { table[Int(char)] = UInt8(index) }
    return table
  }()

  /// Standard base64 without padding: how the data model writes `$bytes`.
  public static func toBase64(_ bytes: some Collection<UInt8>) -> String {
    encodeBase64(bytes, pad: false)
  }

  /// Standard base64 with '=' padding.
  public static func toBase64Pad(_ bytes: some Collection<UInt8>) -> String {
    encodeBase64(bytes, pad: true)
  }

  /// The bytes of unpadded standard base64. Throws "invalid base64 string"
  /// for anything `toBase64` would not have written.
  public static func fromBase64(_ string: String) throws -> [UInt8] {
    try decodeBase64(string, padded: false)
  }

  /// The bytes of padded standard base64. Throws "invalid base64 string"
  /// for anything `toBase64Pad` would not have written.
  public static func fromBase64Pad(_ string: String) throws -> [UInt8] {
    try decodeBase64(string, padded: true)
  }

  private static func encodeBase64(_ bytes: some Collection<UInt8>, pad: Bool) -> String {
    var out: [UInt8] = []
    out.reserveCapacity((bytes.count + 2) / 3 * 4)
    var iterator = bytes.makeIterator()
    while let b0 = iterator.next() {
      let b1 = iterator.next()
      let b2 = iterator.next()
      let n = UInt32(b0) << 16 | UInt32(b1 ?? 0) << 8 | UInt32(b2 ?? 0)
      out.append(base64Alphabet[Int((n >> 18) & 0x3f)])
      out.append(base64Alphabet[Int((n >> 12) & 0x3f)])
      if b1 != nil {
        out.append(base64Alphabet[Int((n >> 6) & 0x3f)])
      } else if pad {
        out.append(UInt8(ascii: "="))
      }
      if b2 != nil {
        out.append(base64Alphabet[Int(n & 0x3f)])
      } else if pad {
        out.append(UInt8(ascii: "="))
      }
      if b1 == nil || b2 == nil { break }
    }
    return String(decoding: out, as: UTF8.self)
  }

  private static func decodeBase64(_ string: String, padded: Bool) throws -> [UInt8] {
    let invalid = RepoError.syntax("invalid base64 string")
    var units = Array(string.utf16)
    if padded {
      // Canonical padding: a multiple of four, with exactly the '='s the
      // last group needs.
      guard units.count % 4 == 0 else { throw invalid }
      var padding = 0
      while padding < 2, let last = units.last, last == UInt16(UInt8(ascii: "=")) {
        units.removeLast()
        padding += 1
      }
      let expected = units.count % 4 == 0 ? 0 : 4 - units.count % 4
      guard padding == expected else { throw invalid }
    }
    guard units.count % 4 != 1 else { throw invalid }
    var out: [UInt8] = []
    out.reserveCapacity(units.count * 3 / 4)
    var buffer: UInt32 = 0
    var bits = 0
    for unit in units {
      guard unit < 0x80 else { throw invalid }
      let value = base64Lookup[Int(unit)]
      guard value != 0xff else { throw invalid }
      buffer = (buffer << 6) | UInt32(value)
      bits += 6
      if bits >= 8 {
        bits -= 8
        out.append(UInt8(truncatingIfNeeded: buffer >> UInt32(bits)))
      }
      buffer &= (1 << UInt32(bits)) - 1
    }
    // The bits left over must be zero, or encoding the bytes again would
    // not give back this string.
    guard buffer == 0 else { throw invalid }
    return out
  }
}
