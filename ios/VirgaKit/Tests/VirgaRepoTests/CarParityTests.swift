// Parity for CAR files: reading (header, blocks, the SHA-256 check, every
// refusal) and writing (ios/parity/cases/repo.car.js).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaRepo

@Suite struct CarParity {
  @Test func fromUint8Array() throws {
    for c in try Parity.cases("repo.car", fn: "fromUint8Array") {
      let actual = outcome {
        let reader = try CarReader.fromUint8Array(c.base64("car"))
        let blocks = try reader.blocks().map { block -> JSONValue in
          [
            "cid": .string(block.cid.string),
            "bytesStart": .number(Double(block.bytesStart)),
            "bytesEnd": .number(Double(block.bytesEnd)),
            "entryStart": .number(Double(block.entryStart)),
            "entryEnd": .number(Double(block.entryEnd)),
            "cidStart": .number(Double(block.cidStart)),
            "cidEnd": .number(Double(block.cidEnd)),
          ]
        }
        return ["roots": .array(reader.roots.map { .string($0.string) }), "blocks": .array(blocks)]
      }
      #expect(exactDiff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func writeCarStream() throws {
    for c in try Parity.cases("repo.car", fn: "writeCarStream") {
      let roots = try (c["roots"].arrayValue ?? []).map { try CID.fromString($0.stringValue ?? "") }
      let blocks = try (c["blocks"].arrayValue ?? []).map { block in
        (
          cid: try CID.fromString(block["cid"]?.stringValue ?? ""),
          data: [UInt8](Data(base64Encoded: block["data"]?.stringValue ?? "") ?? Data())
        )
      }
      let car = CarWriter.writeCar(roots: roots, blocks: blocks)
      #expect(exactDiff(.string(Data(car).base64EncodedString()), c.output) == nil, "\(c)")
    }
  }
}

@Suite struct CarBehaviour {
  @Test func writtenCarsReadBack() throws {
    let a = try DagCbor.encode(["text": "a"] as JSONValue)
    let b = try DagCbor.encode(["text": "b", "n": 1] as JSONValue)
    let cidA = CID.create(codec: CID.codecDagCbor, data: a)
    let cidB = CID.create(codec: CID.codecDagCbor, data: b)
    let car = CarWriter.writeCar(roots: [cidA], blocks: [(cidA, a), (cidB, b)])
    let reader = try CarReader.fromUint8Array(car)
    #expect(reader.roots == [cidA])
    let blocks = try reader.blocks()
    #expect(blocks.map(\.cid) == [cidA, cidB])
    #expect(Array(reader.bytes(of: blocks[1])) == b)
    #expect(try DagCbor.decode(reader.bytes(of: blocks[0])) == .map(["text": .string("a")]))
  }

  @Test func verificationCanBeTurnedOff() throws {
    let data = try DagCbor.encode(["x": 1] as JSONValue)
    let cid = CID.create(codec: CID.codecDagCbor, data: data)
    var tampered = data
    tampered[tampered.count - 1] = 2
    let car = CarWriter.writeCar(roots: [cid], blocks: [(cid, tampered)])
    #expect(throws: RepoError.self) { try CarReader.fromUint8Array(car).blocks() }
    #expect(try CarReader.fromUint8Array(car, verifyBlocks: false).blocks().count == 1)
  }

  @Test func iteratorStopsAtTheFirstBadBlock() throws {
    let data = try DagCbor.encode(["x": 1] as JSONValue)
    let cid = CID.create(codec: CID.codecDagCbor, data: data)
    let car = CarWriter.writeCar(roots: [cid], blocks: [(cid, data)]) + [5]
    var iterator = try CarReader.fromUint8Array(car).makeIterator()
    #expect(try iterator.next()?.cid == cid)
    #expect(throws: RepoError.self) { try iterator.next() }
  }
}
