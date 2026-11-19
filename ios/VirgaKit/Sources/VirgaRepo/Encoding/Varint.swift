// Unsigned varints (LEB128), as @atcute/varint reads and writes them: the
// length prefix of a CAR's header and of every block in it.

import Foundation

public enum Varint {
  /// 2^53 - 1: the web's numbers are doubles, so nothing above this exists.
  public static let maxSafeInteger = 9_007_199_254_740_991

  /// The bytes of `num`. Throws for a negative number or one past 2^53 - 1,
  /// as the web's `encode` does.
  public static func encode(_ num: Int) throws -> [UInt8] {
    var out: [UInt8] = []
    try encode(num, into: &out)
    return out
  }

  /// Appends the bytes of `num` to `out`.
  public static func encode(_ num: Int, into out: inout [UInt8]) throws {
    guard num >= 0, num <= maxSafeInteger else { throw RepoError.range("could not encode varint") }
    var n = UInt64(num)
    while n >= 0x80 {
      out.append(UInt8(truncatingIfNeeded: n) | 0x80)
      n >>= 7
    }
    out.append(UInt8(n))
  }

  /// A varint at `offset`, reading at most `length` bytes (all that remain
  /// when nil): its value and the offset just past it. Throws "could not
  /// decode varint" when the bytes run out first or the value passes
  /// 2^53 - 1. Like the web, a non-minimal encoding (0x80 0x00) is accepted.
  public static func decode(
    _ buf: [UInt8], offset: Int = 0, length: Int? = nil
  ) throws -> (value: Int, nextOffset: Int) {
    try decode(buf[...], offset: offset, length: length)
  }

  /// `decode` over a slice; `offset` is an index of the slice's base array.
  public static func decode(
    _ buf: ArraySlice<UInt8>, offset: Int, length: Int? = nil
  ) throws -> (value: Int, nextOffset: Int) {
    let limit = length.map { offset + $0 } ?? buf.endIndex
    let end = Swift.min(limit, buf.endIndex)
    var counter = offset
    var result: Double = 0
    var shift: Double = 0
    while true {
      guard counter < end, counter >= buf.startIndex else { throw RepoError.range("could not decode varint") }
      let byte = buf[counter]
      counter += 1
      result += Double(byte & 0x7f) * pow(2, shift)
      if shift >= 35, result > Double(maxSafeInteger) { throw RepoError.range("could not decode varint") }
      if byte < 0x80 { break }
      shift += 7
    }
    guard result.isFinite else { throw RepoError.range("could not decode varint") }
    return (Int(result), counter)
  }

  /// How many bytes `num` takes.
  public static func encodingLength(_ num: Int) -> Int {
    var n = UInt64(Swift.max(0, num))
    var length = 1
    while n >= 0x80 {
      n >>= 7
      length += 1
    }
    return length
  }
}
