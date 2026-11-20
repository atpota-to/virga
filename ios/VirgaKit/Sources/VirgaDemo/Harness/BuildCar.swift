// Ports harness/buildCar.js
//
// A real repo CAR from a list of records: VirgaRepo's DAG-CBOR encoder and
// CAR writer (byte for byte @atcute's, which the web uses), with real
// content-addressed CIDs, so the app's reader (VirgaRepo's CarRepo) is given
// the actual wire format and not a stand-in for it. One tree node holds
// every key, which a real repo would spread over many; the reader walks
// either.

import Foundation
import VirgaCore
import VirgaRepo

public enum BuildCar {
  static func block(_ value: DagCborValue) throws -> (cid: CID, bytes: [UInt8]) {
    let bytes = try DagCbor.encode(value)
    return (CID.create(codec: CID.codecDagCbor, data: bytes), bytes)
  }

  /// The repo's CAR: a signed-looking commit (an all-zero signature), one
  /// MST node with every key, then each record.
  ///
  /// - Parameter records: `(key, record)` pairs, key-sorted (World.repoRecords
  ///   gives them so); records in the data model's JSON form.
  /// - Throws: what DAG-CBOR encoding refuses (a malformed `$link`, a
  ///   number it can't hold), with @atcute's message.
  public static func buildRepoCar(
    _ did: String, _ records: [(key: String, value: JSONValue)], rev: String = "3mharnessrev22"
  ) throws -> [UInt8] {
    var recordBlocks: [(cid: CID, bytes: [UInt8])] = []
    recordBlocks.reserveCapacity(records.count)
    for (_, value) in records {
      let bytes = try DagCbor.encode(value)
      recordBlocks.append((CID.create(codec: CID.codecDagCbor, data: bytes), bytes))
    }

    // Keys are prefix-compressed: each entry stores how much it shares with
    // the key before it (counted in UTF-16 code units, as the web counts),
    // then the rest as UTF-8.
    var previous: [UInt16] = []
    var entries: [DagCborValue] = []
    entries.reserveCapacity(records.count)
    for (i, record) in records.enumerated() {
      let key = Array(record.key.utf16)
      var p = 0
      while p < key.count && p < previous.count && key[p] == previous[p] { p += 1 }
      previous = key
      entries.append(
        .map([
          "p": .number(Double(p)),
          "k": .bytes(Array(String(jsUnits: key[p...]).utf8)),
          "v": .link(recordBlocks[i].cid),
          "t": .null,
        ]))
    }
    let mst = try block(.map(["l": .null, "e": .array(entries)]))
    let commit = try block(
      .map([
        "did": .string(did),
        "version": .number(3),
        "data": .link(mst.cid),
        "rev": .string(rev),
        "prev": .null,
        "sig": .bytes([UInt8](repeating: 0, count: 64)),
      ]))

    var blocks: [(cid: CID, data: [UInt8])] = [(commit.cid, commit.bytes), (mst.cid, mst.bytes)]
    blocks.reserveCapacity(records.count + 2)
    for b in recordBlocks { blocks.append((b.cid, b.bytes)) }
    return CarWriter.writeCar(roots: [commit.cid], blocks: blocks)
  }
}
