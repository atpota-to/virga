// SHA-256 (VirgaCore/Crypto/SHA256.swift): the NIST vectors, then parity
// with Node's crypto and @atcute's own hasher over every length up to 300
// bytes and the block boundaries past it (ios/parity/cases/repo.sha256.js).

import Foundation
import Testing
import VirgaTestSupport
@testable import VirgaCore

private func bytes(hex: String) -> [UInt8] {
  var out: [UInt8] = []
  var index = hex.startIndex
  while index < hex.endIndex {
    let next = hex.index(index, offsetBy: 2)
    out.append(UInt8(hex[index..<next], radix: 16)!)
    index = next
  }
  return out
}

/// The generator's linear congruential bytes (repo.sha256.js `lcgBytes`).
private func lcgBytes(_ length: Int, seed: Int) -> [UInt8] {
  var out = [UInt8](repeating: 0, count: length)
  var x = UInt32(truncatingIfNeeded: seed)
  for i in 0..<length {
    x = (x &* 1_103_515_245 &+ 12345) & 0x7fff_ffff
    out[i] = UInt8(truncatingIfNeeded: x >> 16)
  }
  return out
}

@Suite struct SHA256Vectors {
  // FIPS 180-4 examples (NIST CSRC).
  @Test func nistShortMessages() {
    #expect(SHA256.hex(SHA256.hash("abc")) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    #expect(SHA256.hex(SHA256.hash("")) == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    #expect(
      SHA256.hex(SHA256.hash("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))
        == "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")
    #expect(
      SHA256.hex(
        SHA256.hash(
          "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"
        )) == "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1")
  }

  @Test func nistMillionA() {
    let message = [UInt8](repeating: UInt8(ascii: "a"), count: 1_000_000)
    #expect(SHA256.hex(SHA256.hash(message)) == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0")
  }

  @Test func incrementalFeedingMatchesOneShot() {
    let message = lcgBytes(10_000, seed: 99)
    let whole = SHA256.hash(message)
    for chunk in [1, 3, 55, 56, 63, 64, 65, 127, 1000] {
      var hasher = SHA256()
      var start = 0
      while start < message.count {
        let end = min(start + chunk, message.count)
        hasher.update(message[start..<end])
        start = end
      }
      #expect(hasher.finalize() == whole, "chunks of \(chunk)")
    }
  }

  @Test func dataStringAndArrayAgree() {
    let text = "héllo 👍🏽"
    let utf8 = Array(text.utf8)
    #expect(SHA256.hash(text) == SHA256.hash(utf8))
    #expect(SHA256.hash(Data(utf8)) == SHA256.hash(utf8))
    #expect(SHA256.hash(utf8[...]) == SHA256.hash(utf8))
    #expect(SHA256.hash(utf8).count == SHA256.digestLength)
  }
}

@Suite struct SHA256Parity {
  @Test func hash() throws {
    for c in try Parity.cases("repo.sha256", fn: "hash") {
      let digest = SHA256.hex(SHA256.hash(bytes(hex: c["hex"].stringValue ?? "")))
      #expect(Parity.diff(.string(digest), c.output) == nil, "\(c)")
    }
  }

  @Test func hashGenerated() throws {
    for c in try Parity.cases("repo.sha256", fn: "hashGenerated") {
      let message = lcgBytes(c["length"].intValue ?? 0, seed: c["seed"].intValue ?? 0)
      #expect(Parity.diff(.string(SHA256.hex(SHA256.hash(message))), c.output) == nil, "\(c)")
    }
  }

  @Test func hashText() throws {
    for c in try Parity.cases("repo.sha256", fn: "hashText") {
      let digest = SHA256.hex(SHA256.hash(c["text"].stringValue ?? ""))
      #expect(Parity.diff(.string(digest), c.output) == nil, "\(c)")
    }
  }

  @Test func hashRepeated() throws {
    for c in try Parity.cases("repo.sha256", fn: "hashRepeated") {
      let text = String(repeating: c["char"].stringValue ?? "", count: c["count"].intValue ?? 0)
      #expect(Parity.diff(.string(SHA256.hex(SHA256.hash(text))), c.output) == nil, "\(c)")
    }
  }
}
