// Parity for the encodings under CIDs and CARs: varints, base32, base64 and
// CIDs (ios/parity/cases/repo.encoding.js).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaRepo

private func cidJSON(_ cid: CID) -> JSONValue {
  [
    "string": .string(cid.string),
    "codec": .number(Double(cid.codec)),
    "version": 1,
    "digest": .string(Hex.encode(cid.digest)),
    "bytes": .string(Hex.encode(cid.bytes)),
  ]
}

@Suite struct VarintParity {
  @Test func encode() throws {
    for c in try Parity.cases("repo.encoding", fn: "varint.encode") {
      let num = c["num"].doubleValue ?? 0
      let actual = outcome {
        // The web takes any number; a fraction is refused like a negative.
        guard num.rounded() == num, abs(num) < 9.3e18 else { throw RepoError(.rangeError, "could not encode varint") }
        let n = Int(num)
        return ["hex": .string(Hex.encode(try Varint.encode(n))), "length": .number(Double(Varint.encodingLength(n)))]
      }
      #expect(Parity.diff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func decode() throws {
    for c in try Parity.cases("repo.encoding", fn: "varint.decode") {
      let actual = outcome {
        let (value, next) = try Varint.decode(c.bytes("hex"), offset: c["offset"].intValue ?? 0, length: c["length"].intValue)
        return ["value": .number(Double(value)), "nextOffset": .number(Double(next))]
      }
      #expect(Parity.diff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func roundTrips() throws {
    for n in [0, 1, 127, 128, 16384, 1 << 35, Varint.maxSafeInteger] {
      let bytes = try Varint.encode(n)
      #expect(bytes.count == Varint.encodingLength(n))
      #expect(try Varint.decode(bytes).value == n)
    }
  }
}

@Suite struct MultibaseParity {
  @Test func toBase32() throws {
    for c in try Parity.cases("repo.encoding", fn: "toBase32") {
      #expect(Parity.diff(.string(Multibase.toBase32(c.bytes("hex"))), c.output) == nil, "\(c)")
    }
  }

  @Test func fromBase32() throws {
    for c in try Parity.cases("repo.encoding", fn: "fromBase32") {
      let actual = outcome { .string(Hex.encode(try Multibase.fromBase32(c["text"].stringValue ?? ""))) }
      #expect(Parity.diff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func toBase64() throws {
    for c in try Parity.cases("repo.encoding", fn: "toBase64") {
      let bytes = c.bytes("hex")
      let actual: JSONValue = [
        "unpadded": .string(Multibase.toBase64(bytes)), "padded": .string(Multibase.toBase64Pad(bytes)),
      ]
      #expect(Parity.diff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func fromBase64() throws {
    for c in try Parity.cases("repo.encoding", fn: "fromBase64") {
      let actual = outcome { .string(Hex.encode(try Multibase.fromBase64(c["text"].stringValue ?? ""))) }
      #expect(Parity.diff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func fromBase64Pad() throws {
    for c in try Parity.cases("repo.encoding", fn: "fromBase64Pad") {
      let actual = outcome { .string(Hex.encode(try Multibase.fromBase64Pad(c["text"].stringValue ?? ""))) }
      #expect(Parity.diff(actual, c.output) == nil, "\(c)")
    }
  }
}

@Suite struct CIDParity {
  @Test func fromString() throws {
    for c in try Parity.cases("repo.encoding", fn: "CID.fromString") {
      let actual = outcome { cidJSON(try CID.fromString(c["text"].stringValue ?? "")) }
      #expect(Parity.diff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func decode() throws {
    for c in try Parity.cases("repo.encoding", fn: "CID.decode") {
      let actual = outcome { cidJSON(try CID.decode(c.bytes("hex"))) }
      #expect(Parity.diff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func fromBinary() throws {
    for c in try Parity.cases("repo.encoding", fn: "CID.fromBinary") {
      let actual = outcome { cidJSON(try CID.fromBinary(c.bytes("hex"))) }
      #expect(Parity.diff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func create() throws {
    for c in try Parity.cases("repo.encoding", fn: "CID.create") {
      let cid = CID.create(codec: UInt8(c["codec"].intValue ?? 0), data: c.bytes("hex"))
      #expect(Parity.diff(cidJSON(cid), c.output) == nil, "\(c)")
    }
  }

  @Test func fromDigest() throws {
    for c in try Parity.cases("repo.encoding", fn: "CID.fromDigest") {
      let actual = outcome { cidJSON(try CID.fromDigest(codec: UInt8(c["codec"].intValue ?? 0), digest: c.bytes("hex"))) }
      #expect(Parity.diff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func toBinary() throws {
    for c in try Parity.cases("repo.encoding", fn: "CID.toBinary") {
      let cid = try CID.fromString(c["string"].stringValue ?? "")
      #expect(Parity.diff(.string(Hex.encode(cid.binary)), c.output) == nil, "\(c)")
    }
  }

  @Test func codableAsLink() throws {
    let cid = try CID.fromString("bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu")
    let encoded = try JSONValue(encoding: cid)
    #expect(encoded == ["$link": "bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu"])
    #expect(try encoded.decode(CID.self) == cid)
    let bad: JSONValue = ["$link": "nope"]
    #expect(throws: DecodingError.self) { try bad.decode(CID.self) }
  }
}
