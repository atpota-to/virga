// Canonical DAG-CBOR encoding, as @atcute/cbor's encode.js writes it, which
// is what makes a record's CID come out as the PDS computes it:
//
// - integers in the shortest argument form; other finite numbers as
//   float64 (atproto records hold none, but the encoder writes them);
//   NaN, ±Infinity and anything past ±(2^53 - 1) refused;
// - map keys sorted by UTF-8 length, then bytewise;
// - a map whose one member is `$link` (a CID string) is a link, tag 42 over
//   0x00 and the CID's bytes; one whose one member is `$bytes` (base64) is
//   a byte string. Any other shape of either is refused, as the web does;
// - a map with its own `constructor` member isn't a plain object to the
//   web's encoder, which takes it only for a link or bytes and refuses it
//   otherwise ("unsupported type: [object Object]").

import Foundation
import VirgaCore

extension DagCbor {
  static let minSafeInteger: Double = -9_007_199_254_740_991

  /// `encode` for a value in the data model's JSON form.
  public static func encode(_ value: JSONValue) throws -> [UInt8] {
    var writer = Writer()
    try writer.write(value)
    return writer.out
  }

  /// `encode` for a decoded value: links and bytes as themselves, maps by the
  /// same rules as the JSON form.
  public static func encode(_ value: DagCborValue) throws -> [UInt8] {
    var writer = Writer()
    try writer.write(value)
    return writer.out
  }

  /// `encode` for what recordCid.js's `toJsonShape` built: each object read
  /// as the web's encoder reads it, through its prototype (see
  /// Support/JSObjects.swift). Without a "__proto__" member anywhere this
  /// writes what `encode(_ JSONValue)` writes.
  static func encode(_ value: JSShaped) throws -> [UInt8] {
    var writer = Writer()
    try writer.write(value)
    return writer.out
  }

  /// `fromBytes` for a `$bytes` string: padded base64 when it ends in '=',
  /// unpadded otherwise.
  public static func fromBytesString(_ text: String) throws -> [UInt8] {
    text.utf16.last == UInt16(UInt8(ascii: "=")) ? try Multibase.fromBase64Pad(text) : try Multibase.fromBase64(text)
  }

  /// Map keys in canonical order: shorter UTF-8 first, then bytewise.
  static func orderedKeys(_ keys: some Sequence<String>) -> [(key: String, utf8: [UInt8])] {
    keys.map { (key: $0, utf8: Array($0.utf8)) }.sorted { a, b in
      if a.utf8.count != b.utf8.count { return a.utf8.count < b.utf8.count }
      return a.utf8.lexicographicallyPrecedes(b.utf8)
    }
  }
}

private struct Writer {
  var out: [UInt8] = []

  init() {
    out.reserveCapacity(1024)
  }

  mutating func writeTypeAndArgument(_ type: UInt8, _ arg: UInt64) {
    let major = type << 5
    if arg < 24 {
      out.append(major | UInt8(arg))
    } else if arg < 0x100 {
      out.append(major | 24)
      out.append(UInt8(arg))
    } else if arg < 0x10000 {
      out.append(major | 25)
      out.append(UInt8(arg >> 8))
      out.append(UInt8(arg & 0xff))
    } else if arg < 0x1_0000_0000 {
      out.append(major | 26)
      for shift in stride(from: 24, through: 0, by: -8) { out.append(UInt8(truncatingIfNeeded: arg >> UInt64(shift))) }
    } else {
      out.append(major | 27)
      for shift in stride(from: 56, through: 0, by: -8) { out.append(UInt8(truncatingIfNeeded: arg >> UInt64(shift))) }
    }
  }

  mutating func writeNumber(_ value: Double) throws {
    guard value.isFinite else { throw RepoError.range("NaN and Infinity values not supported") }
    guard value <= DagCbor.maxSafeInteger, value >= DagCbor.minSafeInteger else {
      throw RepoError.range("can't encode numbers beyond safe integer range")
    }
    if value.rounded(.towardZero) == value {
      // -0 is an integer, and not below zero: it is written as 0.
      if value < 0 {
        writeTypeAndArgument(1, UInt64(-value - 1))
      } else {
        writeTypeAndArgument(0, UInt64(value))
      }
    } else {
      out.append(0xe0 | 27)
      let bits = value.bitPattern
      for shift in stride(from: 56, through: 0, by: -8) { out.append(UInt8(truncatingIfNeeded: bits >> UInt64(shift))) }
    }
  }

  mutating func writeString(_ value: String) {
    let utf8 = value.utf8
    writeTypeAndArgument(3, UInt64(utf8.count))
    out.append(contentsOf: utf8)
  }

  mutating func writeBytes(_ bytes: [UInt8]) {
    writeTypeAndArgument(2, UInt64(bytes.count))
    out.append(contentsOf: bytes)
  }

  mutating func writeCid(_ cidBytes: [UInt8]) {
    // CID bytes are prefixed with 0x00 for historical reasons.
    writeTypeAndArgument(6, 42)
    writeTypeAndArgument(2, UInt64(cidBytes.count + 1))
    out.append(0)
    out.append(contentsOf: cidBytes)
  }

  /// The single-member `$link` / `$bytes` forms, or false for a plain map.
  mutating func writeSpecialMember(key: String, value: JSONValue?) throws -> Bool {
    switch key {
    case "$link":
      guard case .string(let text) = value else { throw RepoError.type("unexpected cid-link value") }
      writeCid(try CID.fromString(text).bytes)
      return true
    case "$bytes":
      guard case .string(let text) = value else { throw RepoError.type("unexpected bytes value") }
      writeBytes(try DagCbor.fromBytesString(text))
      return true
    default:
      return false
    }
  }

  /// An object with its own `constructor` member, which the web's encoder
  /// doesn't take for a plain object: it is written only as a link (when it
  /// has a string `$link`) or bytes (a string `$bytes`), and refused
  /// otherwise.
  mutating func writeNonPlainObject(_ members: [String: JSONValue]) throws {
    if let link = members["$link"] {
      guard case .string(let text) = link else { throw RepoError.type("unexpected cid-link value") }
      writeCid(try CID.fromString(text).bytes)
      return
    }
    if let bytes = members["$bytes"] {
      guard case .string(let text) = bytes else { throw RepoError.type("unexpected bytes value") }
      writeBytes(try DagCbor.fromBytesString(text))
      return
    }
    throw RepoError.type("unsupported type: \(try JS.toString(.object(members)))")
  }

  mutating func write(_ value: JSONValue) throws {
    switch value {
    case .bool(let flag):
      out.append(flag ? 0xf5 : 0xf4)
    case .number(let number):
      try writeNumber(number)
    case .string(let text):
      writeString(text)
    case .null:
      out.append(0xf6)
    case .array(let values):
      writeTypeAndArgument(4, UInt64(values.count))
      for element in values { try write(element) }
    case .object(let members):
      if members["constructor"] != nil {
        try writeNonPlainObject(members)
        return
      }
      if members.count == 1, let (key, member) = members.first,
        try writeSpecialMember(key: key, value: member)
      {
        return
      }
      let keys = DagCbor.orderedKeys(members.keys)
      writeTypeAndArgument(5, UInt64(keys.count))
      for entry in keys {
        writeTypeAndArgument(3, UInt64(entry.utf8.count))
        out.append(contentsOf: entry.utf8)
        try write(members[entry.key]!)
      }
    }
  }

  /// writeValue for a shaped value. A plain object (`val.constructor ===
  /// Object`, read through the prototype) is written from its own members;
  /// any other object only as a link or bytes (`'$link' in val`,
  /// `'$bytes' in val`, also through the prototype), or refused with
  /// `unsupported type: ${val}`.
  mutating func write(_ value: JSShaped) throws {
    switch value {
    case .primitive(let primitive):
      try write(primitive)
    case .array(let values):
      writeTypeAndArgument(4, UInt64(values.count))
      for element in values { try write(element) }
    case .object(let object):
      if case .objectConstructor = JSObjects.get(object, "constructor") {
        if object.members.count == 1, let (key, member) = object.members.first, key == "$link" || key == "$bytes" {
          guard case .primitive(.string(let text)) = member else {
            throw RepoError.type(key == "$link" ? "unexpected cid-link value" : "unexpected bytes value")
          }
          if key == "$link" {
            writeCid(try CID.fromString(text).bytes)
          } else {
            writeBytes(try DagCbor.fromBytesString(text))
          }
          return
        }
        let keys = DagCbor.orderedKeys(object.members.keys)
        writeTypeAndArgument(5, UInt64(keys.count))
        for entry in keys {
          writeTypeAndArgument(3, UInt64(entry.utf8.count))
          out.append(contentsOf: entry.utf8)
          try write(object.members[entry.key]!)
        }
        return
      }
      let link = JSObjects.get(object, "$link")
      if link != .undefined {
        guard case .data(.primitive(.string(let text))) = link else { throw RepoError.type("unexpected cid-link value") }
        writeCid(try CID.fromString(text).bytes)
        return
      }
      let bytes = JSObjects.get(object, "$bytes")
      if bytes != .undefined {
        guard case .data(.primitive(.string(let text))) = bytes else { throw RepoError.type("unexpected bytes value") }
        writeBytes(try DagCbor.fromBytesString(text))
        return
      }
      throw RepoError.type(try JSObjects.concat("unsupported type: ", JSObjects.toString(value)))
    }
  }

  mutating func write(_ value: DagCborValue) throws {
    switch value {
    case .bool(let flag):
      out.append(flag ? 0xf5 : 0xf4)
    case .number(let number):
      try writeNumber(number)
    case .string(let text):
      writeString(text)
    case .null:
      out.append(0xf6)
    case .bytes(let bytes):
      writeBytes(bytes)
    case .link(let cid):
      writeCid(cid.bytes)
    case .array(let values):
      writeTypeAndArgument(4, UInt64(values.count))
      for element in values { try write(element) }
    case .map(let members):
      if members["constructor"] != nil {
        try write(DagCborValue.map(members).jsonValue)
        return
      }
      if members.count == 1, let (key, member) = members.first {
        // A decoded map shaped like a link or bytes is written as one, as
        // the web writes any plain object of that shape.
        switch member {
        case .string, .number, .bool, .null, .array, .map:
          if try writeSpecialMember(key: key, value: member.jsonValue) { return }
        case .bytes, .link:
          if key == "$link" { throw RepoError.type("unexpected cid-link value") }
          if key == "$bytes" { throw RepoError.type("unexpected bytes value") }
        }
      }
      let keys = DagCbor.orderedKeys(members.keys)
      writeTypeAndArgument(5, UInt64(keys.count))
      for entry in keys {
        writeTypeAndArgument(3, UInt64(entry.utf8.count))
        out.append(contentsOf: entry.utf8)
        try write(members[entry.key]!)
      }
    }
  }
}
