// CAR v1 files, written as @atcute/car's `writeCarStream` writes them: the
// header `{ version: 1, roots }` behind its varint length, then each block
// as a varint length, the CID's bytes and the block's bytes. The web uses it
// in its tests and the harness's fake PDS (harness/buildCar.js); here it is
// for the demo world and the tests.

import Foundation

public enum CarWriter {
  /// `serializeCarHeader`.
  public static func serializeCarHeader(roots: [CID]) -> [UInt8] {
    // A map of a number and links always encodes.
    let data = (try? DagCbor.encode(DagCborValue.map(["version": .number(1), "roots": .array(roots.map { .link($0) })]))) ?? []
    var out: [UInt8] = []
    try? Varint.encode(data.count, into: &out)
    out.append(contentsOf: data)
    return out
  }

  /// `serializeCarEntry`.
  public static func serializeCarEntry(cid: [UInt8], data: some Collection<UInt8>) -> [UInt8] {
    var out: [UInt8] = []
    try? Varint.encode(cid.count + data.count, into: &out)
    out.append(contentsOf: cid)
    out.append(contentsOf: data)
    return out
  }

  /// `writeCarStream`, collected: the whole file.
  public static func writeCar(roots: [CID], blocks: [(cid: CID, data: [UInt8])]) -> [UInt8] {
    var out = serializeCarHeader(roots: roots)
    for block in blocks {
      out.append(contentsOf: serializeCarEntry(cid: block.cid.bytes, data: block.data))
    }
    return out
  }
}
