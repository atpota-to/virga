// Parity for DAG-CBOR: canonical encoding of the JSON form, and decoding
// with every refusal the web's decoder makes (ios/parity/cases/repo.cbor.js).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaRepo

@Suite struct DagCborParity {
  @Test func encode() throws {
    for c in try Parity.cases("repo.cbor", fn: "encode") {
      let actual = outcome { .string(Hex.encode(try DagCbor.encode(c["value"]))) }
      #expect(exactDiff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func encodeDecodedValues() throws {
    // A decoded value re-encodes to the bytes it came from.
    for c in try Parity.cases("repo.cbor", fn: "encode") where c.expectedThrow == nil {
      let bytes = Hex.decode(c.output.stringValue ?? "")
      let value = try DagCbor.decode(bytes)
      #expect(try DagCbor.encode(value) == bytes, "\(c)")
    }
  }

  @Test func decode() throws {
    for c in try Parity.cases("repo.cbor", fn: "decode") {
      let actual = outcome { try DagCbor.decode(c.bytes("hex")).jsonValue }
      #expect(exactDiff(actual, c.output, strictNulls: true) == nil, "\(c)")
    }
  }
}

@Suite struct DagCborBehaviour {
  @Test func protoKeyIsAKeyLikeAnyOther() throws {
    // {"__proto__": {"x": 1}}: the fixtures' JSON can't carry this key.
    let bytes = Hex.decode("a1695f5f70726f746f5f5fa1617801")
    let value = try DagCbor.decode(bytes)
    #expect(value == .map(["__proto__": .map(["x": .number(1)])]))
    #expect(try DagCbor.encode(value) == bytes)
    #expect(try DagCbor.encode(value.jsonValue) == bytes)
  }

  @Test func nestingIsCappedWithoutExhaustingTheStack() throws {
    func nested(_ depth: Int) -> [UInt8] { [UInt8](repeating: 0x81, count: depth) + [0] }
    #expect(try DagCbor.decode(nested(DagCbor.maxDepth)) != .null)
    for depth in [DagCbor.maxDepth + 1, 10_000, 1_000_000] {
      #expect(throws: RepoError.self) { try DagCbor.decode(nested(depth)) }
    }
    do {
      _ = try DagCbor.decode(nested(DagCbor.maxDepth + 1))
    } catch let error as RepoError {
      #expect(error.message == "value nested too deeply (more than 128 levels)")
      #expect(error.kind == .rangeError)
    }
    // Maps count too.
    let maps = [UInt8](Array(repeating: [0xa1, 0x61, 0x61], count: 200).joined()) + [0xf6]
    #expect(throws: RepoError.self) { try DagCbor.decode(maps) }
  }

  @Test func largeContainersDecodeInLinearTime() throws {
    // Containers are filled in place: copying one per element made a
    // 40,000-element array take 16 seconds (a release build) where the web
    // takes milliseconds. Here 200,000 elements and 100,000 keys, which
    // took minutes that way, must take seconds even in a debug build.
    let array = try DagCbor.encode(JSONValue.array((0..<200_000).map { .number(Double($0 % 1000)) }))
    var members: [String: JSONValue] = [:]
    for i in 0..<100_000 { members["k\(i)"] = .number(Double(i)) }
    let map = try DagCbor.encode(JSONValue.object(members))
    let start = Date()
    let decodedArray = try DagCbor.decode(array)
    let decodedMap = try DagCbor.decode(map)
    let elapsed = Date().timeIntervalSince(start)
    #expect(decodedArray == DagCborValue(json: .array((0..<200_000).map { .number(Double($0 % 1000)) })))
    #expect(decodedMap["k99999"] == .number(99_999))
    #expect(elapsed < 20, "decoding took \(elapsed) s")
  }

  @Test func decodeFirstLeavesTheRest() throws {
    let (value, rest) = try DagCbor.decodeFirst([0x01, 0x02, 0x03][...])
    #expect(value == .number(1))
    #expect(Array(rest) == [0x02, 0x03])
  }

  @Test func linksAndBytesEncodeAsTheirJsonForms() throws {
    let cid = try CID.fromString("bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu")
    let value: DagCborValue = .map(["link": .link(cid), "sig": .bytes([1, 2, 3]), "n": .number(-3)])
    let viaJSON = try DagCbor.encode(value.jsonValue)
    #expect(try DagCbor.encode(value) == viaJSON)
    #expect(try DagCbor.decode(viaJSON) == value)
    // A map holding a link under `$link` is refused, as the web refuses it.
    #expect(throws: RepoError.self) { try DagCbor.encode(DagCborValue.map(["$link": .link(cid)])) }
    #expect(throws: RepoError.self) { try DagCbor.encode(DagCborValue.map(["$bytes": .bytes([1])])) }
  }

  @Test func longStringHeaders() throws {
    // A 65,536-byte string takes a four-byte length (the fixture stops at
    // two-byte lengths to stay small).
    let text = String(repeating: "x", count: 65_536)
    let bytes = try DagCbor.encode(JSONValue.string(text))
    #expect(Array(bytes.prefix(5)) == [0x7a, 0x00, 0x01, 0x00, 0x00])
    #expect(try DagCbor.decode(bytes) == .string(text))
  }

  @Test func jsonFormRoundTripsThroughCodable() throws {
    let cid = try CID.fromString("bafkreifvw4djmv7ney453nfyozyvoxvrwrlnpmbfhezarsn6plkrcvrw64")
    let value: DagCborValue = .array([.link(cid), .bytes([0xff]), .string("x"), .null, .bool(true)])
    let json = try JSONValue(encoding: value)
    #expect(json == value.jsonValue)
    #expect(try json.decode(DagCborValue.self) == value)
    // Shapes that don't parse stay maps.
    #expect(DagCborValue(json: ["$link": "nope"]) == .map(["$link": .string("nope")]))
    #expect(DagCborValue(json: ["$bytes": "AR"]) == .map(["$bytes": .string("AR")]))
  }
}
