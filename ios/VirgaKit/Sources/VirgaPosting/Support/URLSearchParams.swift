// URLSearchParams (the WHATWG URL Standard's application/x-www-form-urlencoded
// parser and serializer, over an ordered list of pairs), as the compose-intent
// port reads and builds its links with it. Names compare by UTF-16 code unit,
// as JavaScript's do. JavaScript's encodeURIComponent and decodeURIComponent
// are VirgaCore's (JSURI), and so is the form serializer.

import Foundation
import VirgaCore

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
    // By code unit: Swift's hasPrefix would read "?" and a combining mark
    // after it as one character, and keep the "?".
    var bytes = Array(query.utf8)[...]
    if bytes.first == 0x3F { bytes = bytes.dropFirst() }
    pairs = Self.parse(Array(bytes))
  }

  /// `new URLSearchParams([[name, value], …])`.
  public init(pairs: [(String, String)]) {
    self.pairs = pairs.map { Pair($0.0, $0.1) }
  }

  /// `params.get(name)`: the first value, or nil.
  public func get(_ name: String) -> String? {
    pairs.first { $0.name.jsEquals(name) }?.value
  }

  /// `params.getAll(name)`.
  public func getAll(_ name: String) -> [String] {
    pairs.filter { $0.name.jsEquals(name) }.map(\.value)
  }

  /// `params.has(name)`.
  public func has(_ name: String) -> Bool {
    pairs.contains { $0.name.jsEquals(name) }
  }

  /// `params.append(name, value)`.
  public mutating func append(_ name: String, _ value: String) {
    pairs.append(Pair(name, value))
  }

  /// `params.set(name, value)`: the first pair with the name takes the
  /// value and the rest are removed; or it is appended.
  public mutating func set(_ name: String, _ value: String) {
    if let first = pairs.firstIndex(where: { $0.name.jsEquals(name) }) {
      pairs[first].value = value
      var index = pairs.count - 1
      while index > first {
        if pairs[index].name.jsEquals(name) { pairs.remove(at: index) }
        index -= 1
      }
    } else {
      append(name, value)
    }
  }

  /// `params.delete(name)`.
  public mutating func delete(_ name: String) {
    pairs.removeAll { $0.name.jsEquals(name) }
  }

  /// `params.toString()`.
  public var description: String {
    JSURI.searchParams(pairs.map { ($0.name, $0.value) })
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
