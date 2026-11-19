// URLSearchParams (the WHATWG URL Standard's application/x-www-form-urlencoded
// parser and serializer, over an ordered list of pairs) and JavaScript's
// encodeURIComponent / decodeURIComponent (ECMA-262's Encode and Decode).
// The compose-intent and post-link ports build and read URLs with them.

import Foundation

public struct URLSearchParams: Hashable, Sendable, CustomStringConvertible {
  public struct Pair: Hashable, Sendable {
    public var name: String
    public var value: String
    public init(_ name: String, _ value: String) {
      self.name = name
      self.value = value
    }
  }

  public private(set) var pairs: [Pair] = []

  public init() {}

  /// `new URLSearchParams(query)`: one leading `?` is dropped.
  public init(_ query: String) {
    var text = Substring(query)
    if text.hasPrefix("?") { text = text.dropFirst() }
    pairs = Self.parse(Array(text.utf8))
  }

  /// `new URLSearchParams([[name, value], …])`.
  public init(pairs: [(String, String)]) {
    self.pairs = pairs.map { Pair($0.0, $0.1) }
  }

  /// `params.get(name)`: the first value, or nil.
  public func get(_ name: String) -> String? {
    pairs.first { $0.name == name }?.value
  }

  /// `params.getAll(name)`.
  public func getAll(_ name: String) -> [String] {
    pairs.filter { $0.name == name }.map(\.value)
  }

  /// `params.has(name)`.
  public func has(_ name: String) -> Bool {
    pairs.contains { $0.name == name }
  }

  /// `params.append(name, value)`.
  public mutating func append(_ name: String, _ value: String) {
    pairs.append(Pair(name, value))
  }

  /// `params.set(name, value)`: the first pair with the name takes the
  /// value and the rest are removed; or it is appended.
  public mutating func set(_ name: String, _ value: String) {
    if let first = pairs.firstIndex(where: { $0.name == name }) {
      pairs[first].value = value
      var index = pairs.count - 1
      while index > first {
        if pairs[index].name == name { pairs.remove(at: index) }
        index -= 1
      }
    } else {
      append(name, value)
    }
  }

  /// `params.delete(name)`.
  public mutating func delete(_ name: String) {
    pairs.removeAll { $0.name == name }
  }

  /// `params.toString()`.
  public var description: String {
    pairs.map { Self.serialize($0.name) + "=" + Self.serialize($0.value) }.joined(separator: "&")
  }

  /// The application/x-www-form-urlencoded byte serializer.
  static func serialize(_ text: String) -> String {
    var out = ""
    for byte in text.utf8 {
      switch byte {
      case 0x20:
        out.append("+")
      case 0x2A, 0x2D, 0x2E, 0x5F, 0x30...0x39, 0x41...0x5A, 0x61...0x7A:
        out.append(Character(Unicode.Scalar(byte)))
      default:
        out.append("%")
        out.append(Character(Unicode.Scalar(WHATWGURL.hexUpper[Int(byte >> 4)])))
        out.append(Character(Unicode.Scalar(WHATWGURL.hexUpper[Int(byte & 0x0F)])))
      }
    }
    return out
  }

  /// The application/x-www-form-urlencoded parser.
  static func parse(_ bytes: [UInt8]) -> [Pair] {
    var out: [Pair] = []
    for sequence in bytes.split(separator: 0x26, omittingEmptySubsequences: true) {
      let name: ArraySlice<UInt8>
      let value: ArraySlice<UInt8>
      if let eq = sequence.firstIndex(of: 0x3D) {
        name = sequence[..<eq]
        value = sequence[(eq + 1)...]
      } else {
        name = sequence
        value = []
      }
      func decode(_ part: ArraySlice<UInt8>) -> String {
        let plusless = part.map { $0 == 0x2B ? 0x20 : $0 }
        return String(decoding: WHATWGURL.percentDecode(plusless), as: UTF8.self)
      }
      out.append(Pair(decode(name), decode(value)))
    }
    return out
  }
}

/// JavaScript's URI encoding functions.
public enum URIComponent {
  /// `URIError` with V8's message.
  public struct MalformedError: Error, LocalizedError, Hashable, Sendable {
    public let message = "URI malformed"
    public var errorDescription: String? { message }
  }

  /// `encodeURIComponent(text)`: everything but letters, digits and
  /// `-_.!~*'()` as %XX of its UTF-8.
  public static func encodeURIComponent(_ text: String) -> String {
    var out = ""
    for byte in text.utf8 {
      switch byte {
      case 0x30...0x39, 0x41...0x5A, 0x61...0x7A, 0x2D, 0x5F, 0x2E, 0x21, 0x7E, 0x2A, 0x27, 0x28, 0x29:
        out.append(Character(Unicode.Scalar(byte)))
      default:
        out.append("%")
        out.append(Character(Unicode.Scalar(WHATWGURL.hexUpper[Int(byte >> 4)])))
        out.append(Character(Unicode.Scalar(WHATWGURL.hexUpper[Int(byte & 0x0F)])))
      }
    }
    return out
  }

  /// `decodeURIComponent(text)`: every %XX sequence decoded as UTF-8; throws
  /// URIError on a `%` without two hex digits or bytes that aren't UTF-8.
  public static func decodeURIComponent(_ text: String) throws -> String {
    let units = Array(text.utf16)
    var out: [UInt16] = []
    out.reserveCapacity(units.count)
    var k = 0
    func hexByte(at index: Int) throws -> UInt8 {
      guard index + 2 < units.count, units[index] == 0x25,
        let high = unitHex(units[index + 1]), let low = unitHex(units[index + 2])
      else { throw MalformedError() }
      return high << 4 | low
    }
    while k < units.count {
      let unit = units[k]
      guard unit == 0x25 else {
        out.append(unit)
        k += 1
        continue
      }
      let byte = try hexByte(at: k)
      k += 3
      if byte & 0x80 == 0 {
        out.append(UInt16(byte))
        continue
      }
      var n = 0
      while n < 8, byte & (0x80 >> UInt8(n)) != 0 { n += 1 }
      guard n >= 2, n <= 4 else { throw MalformedError() }
      var octets = [byte]
      for _ in 1..<n {
        let next = try hexByte(at: k)
        guard next & 0xC0 == 0x80 else { throw MalformedError() }
        octets.append(next)
        k += 3
      }
      guard let scalar = decodeUTF8Sequence(octets) else { throw MalformedError() }
      out.append(contentsOf: String(scalar).utf16)
    }
    return String(decoding: out, as: UTF16.self)
  }

  static func unitHex(_ unit: UInt16) -> UInt8? {
    unit < 0x80 ? WHATWGURL.hexValue(UInt8(unit)) : nil
  }

  /// One well-formed UTF-8 sequence (no overlong forms, surrogates or values
  /// past U+10FFFF), or nil.
  static func decodeUTF8Sequence(_ octets: [UInt8]) -> Unicode.Scalar? {
    var value: UInt32
    let minimum: UInt32
    switch octets.count {
    case 2: value = UInt32(octets[0] & 0x1F); minimum = 0x80
    case 3: value = UInt32(octets[0] & 0x0F); minimum = 0x800
    case 4: value = UInt32(octets[0] & 0x07); minimum = 0x10000
    default: return nil
    }
    for octet in octets.dropFirst() { value = value << 6 | UInt32(octet & 0x3F) }
    guard value >= minimum, value <= 0x10FFFF, !(0xD800...0xDFFF).contains(value) else { return nil }
    return Unicode.Scalar(value)
  }
}
