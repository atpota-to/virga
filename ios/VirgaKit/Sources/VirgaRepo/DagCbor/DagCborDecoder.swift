// DAG-CBOR decoding, check for check as @atcute/cbor's decode.js does it, so
// a block the web refuses is refused here with the same message:
//
// - integers within ±(2^53 - 1), arguments in their shortest form;
// - floats only as float64, and never NaN or ±Infinity;
// - map keys only text strings, in canonical order (shorter first, then
//   bytewise), no duplicates;
// - tag 42 (a CID link) and no other tag; no indefinite lengths, no
//   undefined, no simple values but false, true and null;
// - text strictly UTF-8.
//
// The decoder is iterative, as the web's is, so deeply nested input can't
// exhaust the stack while decoding. One deliberate difference: the web
// takes any depth, but a Swift value nested thousands deep would exhaust a
// thread's stack later (released, compared or encoded, all recursively; a
// concurrency thread on iOS has 512 KB), so a value nested more than
// `maxDepth` containers deep is refused. No atproto record comes near it (a
// post with a quoted post and images is about eight deep); a record built
// to crash the app would otherwise do so on every sync.

import Foundation

public enum DagCbor {
  static let maxSafeInteger: Double = 9_007_199_254_740_991

  /// How many arrays and maps deep a decoded value may be.
  public static let maxDepth = 128

  /// `decode`: exactly one value. Throws "decoded value contains remainder"
  /// when bytes follow it.
  public static func decode(_ bytes: ArraySlice<UInt8>) throws -> DagCborValue {
    let (value, remainder) = try decodeFirst(bytes)
    guard remainder.isEmpty else { throw RepoError.plain("decoded value contains remainder") }
    return value
  }

  public static func decode(_ bytes: [UInt8]) throws -> DagCborValue {
    try decode(bytes[...])
  }

  public static func decode(_ data: Data) throws -> DagCborValue {
    try decode([UInt8](data))
  }

  /// `decodeFirst`: the value at the start of `bytes` and what follows it.
  public static func decodeFirst(
    _ bytes: ArraySlice<UInt8>
  ) throws -> (value: DagCborValue, remainder: ArraySlice<UInt8>) {
    var reader = Reader(buffer: bytes)
    let value = try reader.decodeFirst()
    return (value, bytes[reader.p...])
  }
}

// MARK: - The reader

private struct Reader {
  let b: ArraySlice<UInt8>
  var p: Int
  let end: Int
  /// Where the last map key read started, and its length in bytes.
  var keyStart = 0
  var keyLength = 0

  init(buffer: ArraySlice<UInt8>) {
    b = buffer
    p = buffer.startIndex
    end = buffer.endIndex
  }

  /// A container being filled, in place on the stack (an enum's payload
  /// can't be appended to without copying it, which made a large array or
  /// map take time quadratic in its length).
  struct Frame {
    var isMap: Bool
    var values: [DagCborValue] = []
    var members: [String: DagCborValue] = [:]
    /// The key whose value comes next, and where it lies in the input.
    var key = ""
    var keyStart = 0
    var keyLength = 0
    var remaining: Int
  }

  /// Refuses a container that would open past `DagCbor.maxDepth`.
  func checkDepth(_ open: Int) throws {
    if open >= DagCbor.maxDepth {
      throw RepoError.range("value nested too deeply (more than \(DagCbor.maxDepth) levels)")
    }
  }

  mutating func requireBytes(_ needed: Int) throws {
    if needed > end - p { throw RepoError.range("unexpected end of input") }
  }

  mutating func readUint8() -> Int {
    defer { p += 1 }
    return Int(b[p])
  }

  mutating func readUint16() -> Int {
    defer { p += 2 }
    return Int(b[p]) << 8 | Int(b[p + 1])
  }

  mutating func readUint32() -> Int {
    defer { p += 4 }
    return Int(b[p]) << 24 | Int(b[p + 1]) << 16 | Int(b[p + 2]) << 8 | Int(b[p + 3])
  }

  mutating func readArgument(_ info: Int) throws -> Int {
    if info < 24 { return info }
    switch info {
    case 24:
      try requireBytes(1)
      let arg = readUint8()
      if arg < 24 { throw RepoError.type("non-canonical argument encoding") }
      return arg
    case 25:
      try requireBytes(2)
      let arg = readUint16()
      if arg < 0x100 { throw RepoError.type("non-canonical argument encoding") }
      return arg
    case 26:
      try requireBytes(4)
      let arg = readUint32()
      if arg < 0x10000 { throw RepoError.type("non-canonical argument encoding") }
      return arg
    case 27:
      try requireBytes(8)
      let hi = readUint32()
      let lo = readUint32()
      if hi > 0x1f_ffff { throw RepoError.range("can't decode integers beyond safe integer range") }
      let arg = hi << 32 | lo
      if arg < 0x1_0000_0000 { throw RepoError.type("non-canonical argument encoding") }
      return arg
    default:
      throw RepoError.plain("invalid argument encoding; got \(info)")
    }
  }

  mutating func readFloat64() throws -> Double {
    try requireBytes(8)
    var bits: UInt64 = 0
    for i in 0..<8 { bits = bits << 8 | UInt64(b[p + i]) }
    let value = Double(bitPattern: bits)
    // DRISL forbids NaN and infinities; -0 and subnormals are allowed.
    if !value.isFinite { throw RepoError.range("NaN and Infinity values not supported") }
    p += 8
    return value
  }

  mutating func readString(_ length: Int) throws -> String {
    try requireBytes(length)
    guard let text = UTF8Text.strict(b[p..<(p + length)]) else {
      throw RepoError.type("input is not valid utf-8")
    }
    p += length
    return text
  }

  mutating func readBytes(_ length: Int) throws -> [UInt8] {
    try requireBytes(length)
    defer { p += length }
    return Array(b[p..<(p + length)])
  }

  mutating func readCid(_ length: Int) throws -> CID {
    try requireBytes(length)
    let pos = p
    // The common case: a 0x00 prefix and a 36-byte SHA-256 CIDv1.
    if length == 37, b[pos] == 0, b[pos + 1] == CID.version,
      b[pos + 2] == CID.codecDagCbor || b[pos + 2] == CID.codecRaw,
      b[pos + 3] == CID.hashSha256, b[pos + 4] == 32
    {
      p = pos + length
      return CID(validated: Array(b[(pos + 1)..<(pos + 37)]))
    }
    // Anything else goes through the CID decoder for its errors.
    p = pos + length
    return try CID.fromBinary(b[pos..<(pos + length)])
  }

  mutating func decodeStringKey() throws -> String {
    try requireBytes(1)
    let prelude = readUint8()
    let type = prelude >> 5
    guard type == 3 else { throw RepoError.type("expected map to only have string keys; got type \(type)") }
    let info = prelude & 0x1f
    let length = info < 24 ? info : try readArgument(info)
    keyStart = p
    keyLength = length
    return try readString(length)
  }

  /// Whether the key just read sorts after the one before it.
  func keyFollows(previousStart: Int, previousLength: Int) -> Bool {
    if keyLength != previousLength { return keyLength > previousLength }
    for i in 0..<keyLength {
      let current = b[keyStart + i]
      let previous = b[previousStart + i]
      if current != previous { return current > previous }
    }
    return false
  }

  mutating func decodeFirst() throws -> DagCborValue {
    var stack: [Frame] = []
    outer: while p < end {
      let prelude = readUint8()
      let type = prelude >> 5
      let info = prelude & 0x1f
      let arg = type == 7 ? 0 : (info < 24 ? info : try readArgument(info))
      var value: DagCborValue
      switch type {
      case 0:
        value = .number(Double(arg))
      case 1:
        let negative = -1 - Double(arg)
        // The safe-integer cap on the argument still lets -(2^53) through.
        if negative < -DagCbor.maxSafeInteger {
          throw RepoError.range("can't decode integers beyond safe integer range")
        }
        value = .number(negative)
      case 2:
        value = .bytes(try readBytes(arg))
      case 3:
        value = .string(try readString(arg))
      case 4:
        if arg > 0 {
          // Each element takes at least a byte: refuse a length the input
          // can't hold before making room for it.
          try requireBytes(arg)
          try checkDepth(stack.count)
          var frame = Frame(isMap: false, remaining: arg)
          frame.values.reserveCapacity(arg)
          stack.append(frame)
          continue outer
        }
        value = .array([])
      case 5:
        if arg > 0 {
          try checkDepth(stack.count)
          let first = try decodeStringKey()
          stack.append(Frame(isMap: true, key: first, keyStart: keyStart, keyLength: keyLength, remaining: arg))
          continue outer
        }
        value = .map([:])
      case 6:
        guard arg == 42 else { throw RepoError.type("unsupported tag; got \(arg)") }
        try requireBytes(1)
        let inner = readUint8()
        let innerType = inner >> 5
        guard innerType == 2 else {
          throw RepoError.type("expected cid-link to be type 2 (bytes); got type \(innerType)")
        }
        let length = try readArgument(inner & 0x1f)
        value = .link(try readCid(length))
      default:  // 7
        switch info {
        case 20, 21: value = .bool(info == 21)
        case 22: value = .null
        case 27: value = .number(try readFloat64())
        default: throw RepoError.plain("invalid simple value; got \(info)")
        }
      }

      // Put the value in its container, and close every container it fills.
      while !stack.isEmpty {
        let top = stack.count - 1
        if stack[top].isMap {
          let key = stack[top].key
          stack[top].members[key] = value
        } else {
          stack[top].values.append(value)
        }
        stack[top].remaining -= 1
        if stack[top].remaining > 0 {
          if stack[top].isMap {
            // The next key, which must sort after this one.
            let previousStart = stack[top].keyStart
            let previousLength = stack[top].keyLength
            let next = try decodeStringKey()
            guard keyFollows(previousStart: previousStart, previousLength: previousLength) else {
              throw RepoError.type("map keys are not in canonical order or contain duplicates")
            }
            stack[top].key = next
            stack[top].keyStart = keyStart
            stack[top].keyLength = keyLength
          }
          continue outer
        }
        let frame = stack.removeLast()
        value = frame.isMap ? .map(frame.members) : .array(frame.values)
      }
      return value
    }
    throw RepoError.range("unexpected end of input")
  }
}
