// Bytes to text, the two ways the web's repo code does it:
//
// - CBOR text strings (@atcute/cbor): strictly. Bytes that aren't
//   well-formed UTF-8 are an error ("input is not valid utf-8"), and a
//   leading byte-order mark is kept as the character it is.
// - MST keys (carRepo.js's `new TextDecoder()`): leniently, by the WHATWG
//   Encoding Standard. Each ill-formed sequence becomes U+FFFD, and a
//   leading byte-order mark is dropped.

import Foundation

enum UTF8Text {
  /// Whether `bytes` is well-formed UTF-8: no overlong forms, no surrogates,
  /// nothing past U+10FFFF, nothing cut short.
  static func isWellFormed(_ bytes: ArraySlice<UInt8>) -> Bool {
    var i = bytes.startIndex
    let end = bytes.endIndex
    while i < end {
      let b0 = bytes[i]
      if b0 < 0x80 {
        i += 1
        continue
      }
      var needed = 0
      var lower: UInt8 = 0x80
      var upper: UInt8 = 0xbf
      switch b0 {
      case 0xc2...0xdf: needed = 1
      case 0xe0: needed = 2; lower = 0xa0
      case 0xe1...0xec, 0xee...0xef: needed = 2
      case 0xed: needed = 2; upper = 0x9f
      case 0xf0: needed = 3; lower = 0x90
      case 0xf1...0xf3: needed = 3
      case 0xf4: needed = 3; upper = 0x8f
      default: return false
      }
      guard end - i > needed else { return false }
      let b1 = bytes[i + 1]
      guard b1 >= lower, b1 <= upper else { return false }
      for k in 2..<(needed + 1) where !(0x80...0xbf).contains(bytes[i + k]) {
        return false
      }
      i += needed + 1
    }
    return true
  }

  /// A CBOR text string's bytes as a String, or nil when they aren't
  /// well-formed UTF-8.
  static func strict(_ bytes: ArraySlice<UInt8>) -> String? {
    guard isWellFormed(bytes) else { return nil }
    return String(decoding: bytes, as: UTF8.self)
  }

  /// `new TextDecoder().decode(bytes)`, as UTF-16 code units: WHATWG UTF-8
  /// decoding with replacement, and a leading U+FEFF dropped.
  static func whatwgDecode(_ bytes: some Collection<UInt8>) -> [UInt16] {
    var out: [UInt16] = []
    out.reserveCapacity(bytes.count)
    var needed = 0
    var seen = 0
    var codePoint: UInt32 = 0
    var lower: UInt8 = 0x80
    var upper: UInt8 = 0xbf
    var first = true

    func emit(_ scalar: UInt32) {
      defer { first = false }
      if first && scalar == 0xfeff { return }
      if scalar < 0x10000 {
        out.append(UInt16(scalar))
      } else {
        let v = scalar - 0x10000
        out.append(UInt16(0xd800 + (v >> 10)))
        out.append(UInt16(0xdc00 + (v & 0x3ff)))
      }
    }

    var iterator = bytes.makeIterator()
    var pending: UInt8? = nil
    while true {
      let next: UInt8
      if let byte = pending {
        next = byte
        pending = nil
      } else if let byte = iterator.next() {
        next = byte
      } else {
        break
      }
      if needed == 0 {
        switch next {
        case 0x00...0x7f:
          emit(UInt32(next))
        case 0xc2...0xdf:
          needed = 1
          codePoint = UInt32(next & 0x1f)
        case 0xe0...0xef:
          if next == 0xe0 { lower = 0xa0 }
          if next == 0xed { upper = 0x9f }
          needed = 2
          codePoint = UInt32(next & 0x0f)
        case 0xf0...0xf4:
          if next == 0xf0 { lower = 0x90 }
          if next == 0xf4 { upper = 0x8f }
          needed = 3
          codePoint = UInt32(next & 0x07)
        default:
          emit(0xfffd)
        }
        continue
      }
      guard next >= lower, next <= upper else {
        // The sequence so far is one error; the byte starts afresh.
        needed = 0
        seen = 0
        codePoint = 0
        lower = 0x80
        upper = 0xbf
        pending = next
        emit(0xfffd)
        continue
      }
      lower = 0x80
      upper = 0xbf
      codePoint = (codePoint << 6) | UInt32(next & 0x3f)
      seen += 1
      if seen == needed {
        emit(codePoint)
        needed = 0
        seen = 0
        codePoint = 0
      }
    }
    if needed != 0 { emit(0xfffd) }
    return out
  }
}
