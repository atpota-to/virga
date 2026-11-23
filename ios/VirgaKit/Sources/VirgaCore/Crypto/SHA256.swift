// SHA-256 (FIPS 180-4), in plain Swift so it runs wherever the logic
// targets do: on Linux as well as on Apple platforms, without CryptoKit.
//
// The web app hashes with SHA-256 through @atcute/uint8array (Node's crypto,
// or WebCrypto in a browser): every CID is the SHA-256 of a block, so record
// CIDs (src/posting/lib/recordCid.js) and the CAR reader's block check
// (src/lib/carRepo.js, through @atcute/car) both rest on it, and so does a
// PKCE code challenge. ios/parity/cases/repo.sha256.js holds this to Node's
// crypto over many input lengths; the NIST vectors are in the tests.

import Foundation

/// A SHA-256 hasher. Feed it bytes with `update`, then take the digest with
/// `finalize()`; or hash a whole buffer at once with `SHA256.hash(_:)`.
public struct SHA256: Sendable {
  /// The length of a digest, in bytes.
  public static let digestLength = 32
  /// The length of a block, in bytes.
  public static let blockLength = 64

  private var state: (UInt32, UInt32, UInt32, UInt32, UInt32, UInt32, UInt32, UInt32) = (
    0x6a09_e667, 0xbb67_ae85, 0x3c6e_f372, 0xa54f_f53a,
    0x510e_527f, 0x9b05_688c, 0x1f83_d9ab, 0x5be0_cd19
  )
  /// Bytes waiting for a full block.
  private var buffer: [UInt8] = []
  /// Bytes hashed so far, in total.
  private var count: UInt64 = 0

  public init() {
    buffer.reserveCapacity(Self.blockLength)
  }

  // MARK: Feeding

  /// Adds bytes to the message.
  public mutating func update(_ bytes: UnsafeRawBufferPointer) {
    guard bytes.count > 0, let base = bytes.baseAddress else { return }
    count &+= UInt64(bytes.count)
    var offset = 0
    let total = bytes.count
    // Top up a partial block first.
    if !buffer.isEmpty {
      let take = Swift.min(Self.blockLength - buffer.count, total)
      buffer.append(contentsOf: UnsafeRawBufferPointer(start: base, count: take))
      offset = take
      if buffer.count == Self.blockLength {
        buffer.withUnsafeBytes { Self.compress(&state, $0.baseAddress!, blocks: 1) }
        buffer.removeAll(keepingCapacity: true)
      }
    }
    // Then whole blocks straight from the input.
    let whole = (total - offset) / Self.blockLength
    if whole > 0 {
      Self.compress(&state, base + offset, blocks: whole)
      offset += whole * Self.blockLength
    }
    if offset < total {
      buffer.append(contentsOf: UnsafeRawBufferPointer(start: base + offset, count: total - offset))
    }
  }

  public mutating func update(_ bytes: [UInt8]) {
    bytes.withUnsafeBytes { update($0) }
  }

  public mutating func update(_ bytes: ArraySlice<UInt8>) {
    bytes.withUnsafeBytes { update($0) }
  }

  public mutating func update(_ data: Data) {
    data.withUnsafeBytes { update($0) }
  }

  /// Adds a string's UTF-8 bytes.
  public mutating func update(_ string: String) {
    var string = string
    string.withUTF8 { update(UnsafeRawBufferPointer($0)) }
  }

  // MARK: Finishing

  /// The digest of everything fed so far. The hasher is spent afterwards:
  /// start a new one for another message.
  public mutating func finalize() -> [UInt8] {
    let bitLength = count &* 8
    var tail = buffer
    tail.append(0x80)
    while tail.count % Self.blockLength != 56 { tail.append(0) }
    for shift in stride(from: 56, through: 0, by: -8) {
      tail.append(UInt8(truncatingIfNeeded: bitLength >> UInt64(shift)))
    }
    tail.withUnsafeBytes { Self.compress(&state, $0.baseAddress!, blocks: tail.count / Self.blockLength) }
    buffer.removeAll()
    var out = [UInt8]()
    out.reserveCapacity(Self.digestLength)
    for word in [state.0, state.1, state.2, state.3, state.4, state.5, state.6, state.7] {
      out.append(UInt8(truncatingIfNeeded: word >> 24))
      out.append(UInt8(truncatingIfNeeded: word >> 16))
      out.append(UInt8(truncatingIfNeeded: word >> 8))
      out.append(UInt8(truncatingIfNeeded: word))
    }
    return out
  }

  // MARK: One shot

  public static func hash(_ bytes: UnsafeRawBufferPointer) -> [UInt8] {
    var hasher = SHA256()
    hasher.update(bytes)
    return hasher.finalize()
  }

  public static func hash(_ bytes: [UInt8]) -> [UInt8] {
    bytes.withUnsafeBytes { hash($0) }
  }

  public static func hash(_ bytes: ArraySlice<UInt8>) -> [UInt8] {
    bytes.withUnsafeBytes { hash($0) }
  }

  public static func hash(_ data: Data) -> [UInt8] {
    data.withUnsafeBytes { hash($0) }
  }

  /// The digest of a string's UTF-8 bytes.
  public static func hash(_ string: String) -> [UInt8] {
    var hasher = SHA256()
    hasher.update(string)
    return hasher.finalize()
  }

  /// A digest as lowercase hex, as Node's `digest('hex')` writes it.
  public static func hex(_ digest: some Sequence<UInt8>) -> String {
    let digits = Array("0123456789abcdef".utf8)
    var out = [UInt8]()
    for byte in digest {
      out.append(digits[Int(byte >> 4)])
      out.append(digits[Int(byte & 0x0f)])
    }
    return String(decoding: out, as: UTF8.self)
  }

  // MARK: The compression function

  private static let k: [UInt32] = [
    0x428a_2f98, 0x7137_4491, 0xb5c0_fbcf, 0xe9b5_dba5, 0x3956_c25b, 0x59f1_11f1, 0x923f_82a4, 0xab1c_5ed5,
    0xd807_aa98, 0x1283_5b01, 0x2431_85be, 0x550c_7dc3, 0x72be_5d74, 0x80de_b1fe, 0x9bdc_06a7, 0xc19b_f174,
    0xe49b_69c1, 0xefbe_4786, 0x0fc1_9dc6, 0x240c_a1cc, 0x2de9_2c6f, 0x4a74_84aa, 0x5cb0_a9dc, 0x76f9_88da,
    0x983e_5152, 0xa831_c66d, 0xb003_27c8, 0xbf59_7fc7, 0xc6e0_0bf3, 0xd5a7_9147, 0x06ca_6351, 0x1429_2967,
    0x27b7_0a85, 0x2e1b_2138, 0x4d2c_6dfc, 0x5338_0d13, 0x650a_7354, 0x766a_0abb, 0x81c2_c92e, 0x9272_2c85,
    0xa2bf_e8a1, 0xa81a_664b, 0xc24b_8b70, 0xc76c_51a3, 0xd192_e819, 0xd699_0624, 0xf40e_3585, 0x106a_a070,
    0x19a4_c116, 0x1e37_6c08, 0x2748_774c, 0x34b0_bcb5, 0x391c_0cb3, 0x4ed8_aa4a, 0x5b9c_ca4f, 0x682e_6ff3,
    0x748f_82ee, 0x78a5_636f, 0x84c8_7814, 0x8cc7_0208, 0x90be_fffa, 0xa450_6ceb, 0xbef9_a3f7, 0xc671_78f2,
  ]

  @inline(__always)
  private static func rotr(_ x: UInt32, _ n: UInt32) -> UInt32 {
    (x >> n) | (x << (32 &- n))
  }

  /// Runs the compression function over `blocks` 64-byte blocks at `data`.
  private static func compress(
    _ state: inout (UInt32, UInt32, UInt32, UInt32, UInt32, UInt32, UInt32, UInt32),
    _ data: UnsafeRawPointer,
    blocks: Int
  ) {
    var w = [UInt32](repeating: 0, count: 64)
    k.withUnsafeBufferPointer { k in
      w.withUnsafeMutableBufferPointer { w in
        var (h0, h1, h2, h3, h4, h5, h6, h7) = state
        for block in 0..<blocks {
          let base = data + block * 64
          for i in 0..<16 {
            let p = base + i * 4
            w[i] =
              UInt32(p.load(as: UInt8.self)) << 24
              | UInt32(p.load(fromByteOffset: 1, as: UInt8.self)) << 16
              | UInt32(p.load(fromByteOffset: 2, as: UInt8.self)) << 8
              | UInt32(p.load(fromByteOffset: 3, as: UInt8.self))
          }
          for i in 16..<64 {
            let x = w[i - 15]
            let y = w[i - 2]
            let s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >> 3)
            let s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >> 10)
            w[i] = w[i - 16] &+ s0 &+ w[i - 7] &+ s1
          }
          var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
          for i in 0..<64 {
            let s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
            let ch = (e & f) ^ (~e & g)
            let t1 = h &+ s1 &+ ch &+ k[i] &+ w[i]
            let s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
            let maj = (a & b) ^ (a & c) ^ (b & c)
            let t2 = s0 &+ maj
            h = g
            g = f
            f = e
            e = d &+ t1
            d = c
            c = b
            b = a
            a = t1 &+ t2
          }
          h0 &+= a; h1 &+= b; h2 &+= c; h3 &+= d
          h4 &+= e; h5 &+= f; h6 &+= g; h7 &+= h
        }
        state = (h0, h1, h2, h3, h4, h5, h6, h7)
      }
    }
  }
}
