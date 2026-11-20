// CAR v1 files, read as @atcute/car's `fromUint8Array` reads them: a varint
// length and a DAG-CBOR header `{ version: 1, roots: [CID…] }`, then blocks,
// each a varint length, a 36-byte CID and the block's bytes.
//
// Every block is checked against its CID (SHA-256) as it is read, as the web
// reader does by default, so a CAR whose bytes were altered is refused with
// "car block does not match its cid; expected=…; actual=…".

import Foundation
import VirgaCore

/// One block of a CAR, with where its parts lie in the file.
public struct CarBlock: Hashable, Sendable {
  public var cid: CID
  /// The block's bytes, as indexes into the CAR's buffer.
  public var bytesRange: Range<Int>
  public var entryStart: Int
  public var entryEnd: Int
  public var cidStart: Int
  public var cidEnd: Int

  public var bytesStart: Int { bytesRange.lowerBound }
  public var bytesEnd: Int { bytesRange.upperBound }
}

/// The header of a CAR.
public struct CarHeader: Hashable, Sendable {
  /// The decoded header map.
  public var data: DagCborValue
  public var roots: [CID]
  public var headerStart: Int
  public var headerEnd: Int
  public var dataStart: Int
  public var dataEnd: Int
}

public struct CarReader: Sendable {
  public let buffer: [UInt8]
  public let header: CarHeader
  public let verifyBlocks: Bool

  /// The roots the header names.
  public var roots: [CID] { header.roots }

  /// `fromUint8Array`: reads the header (throwing if it is malformed); the
  /// blocks are read, and checked, as they are iterated.
  public static func fromUint8Array(_ buffer: [UInt8], verifyBlocks: Bool = true) throws -> CarReader {
    let (header, _) = try readHeader(buffer)
    return CarReader(buffer: buffer, header: header, verifyBlocks: verifyBlocks)
  }

  public static func fromUint8Array(_ data: Data, verifyBlocks: Bool = true) throws -> CarReader {
    try fromUint8Array([UInt8](data), verifyBlocks: verifyBlocks)
  }

  init(buffer: [UInt8], header: CarHeader, verifyBlocks: Bool) {
    self.buffer = buffer
    self.header = header
    self.verifyBlocks = verifyBlocks
  }

  /// The block's bytes.
  public func bytes(of block: CarBlock) -> ArraySlice<UInt8> {
    buffer[block.bytesRange]
  }

  /// Every block, in file order. Throws at the first malformed one.
  public func blocks() throws -> [CarBlock] {
    var iterator = makeIterator()
    var out: [CarBlock] = []
    while let block = try iterator.next() { out.append(block) }
    return out
  }

  public func makeIterator() -> Iterator {
    Iterator(reader: self, position: header.dataEnd)
  }

  /// Walks the blocks one at a time; `next()` throws for a malformed block.
  public struct Iterator: Sendable {
    let reader: CarReader
    var position: Int

    public mutating func next() throws -> CarBlock? {
      let buffer = reader.buffer
      guard position < buffer.count else { return nil }
      let entryStart = position
      let (entryLength, lengthOffset) = try Varint.decode(buffer, offset: position, length: 8)
      position = lengthOffset
      guard entryLength >= 36 else { throw RepoError.range("invalid car block; length=\(entryLength)") }
      let cidStart = position
      let cid = try CarReader.readCid(buffer, at: position)
      position = cidStart + 36
      let bytesStart = position
      let bytesSize = entryLength - 36
      guard bytesStart + bytesSize <= buffer.count else { throw RepoError.range("unexpected end of data") }
      let bytesEnd = bytesStart + bytesSize
      position = bytesEnd
      if reader.verifyBlocks {
        try CarReader.verifyBlock(cid, buffer[bytesStart..<bytesEnd])
      }
      return CarBlock(
        cid: cid, bytesRange: bytesStart..<bytesEnd, entryStart: entryStart, entryEnd: bytesEnd,
        cidStart: cidStart, cidEnd: bytesStart)
    }
  }

  // MARK: The parts

  static func readHeader(_ source: [UInt8]) throws -> (CarHeader, next: Int) {
    let (length, lengthOffset) = try Varint.decode(source, offset: 0, length: 8)
    guard length != 0 else { throw RepoError.range("invalid car header; length=0") }
    let dataStart = lengthOffset
    let dataEnd = dataStart + length
    guard dataEnd <= source.count else { throw RepoError.range("unexpected end of data") }
    let data = try DagCbor.decode(source[dataStart..<dataEnd])
    guard let roots = carV1Roots(data) else { throw RepoError.type("expected a car v1 archive") }
    let header = CarHeader(
      data: data, roots: roots, headerStart: 0, headerEnd: dataEnd, dataStart: dataStart, dataEnd: dataEnd)
    return (header, dataEnd)
  }

  /// `isCarV1Header`: `version` is 1 and `roots` an array of CID links (not
  /// maps that merely look like them).
  static func carV1Roots(_ value: DagCborValue) -> [CID]? {
    guard case .map(let members) = value, members["version"] == .number(1),
      case .array(let roots)? = members["roots"]
    else { return nil }
    var out: [CID] = []
    for root in roots {
      guard case .link(let cid) = root else { return nil }
      out.append(cid)
    }
    return out
  }

  static func readCid(_ source: [UInt8], at offset: Int) throws -> CID {
    let cidEnd = offset + 36
    guard cidEnd <= source.count else { throw RepoError.range("unexpected end of data") }
    let version = source[offset]
    let codec = source[offset + 1]
    let digestType = source[offset + 2]
    let digestSize = source[offset + 3]
    guard version == CID.version else { throw RepoError.range("incorrect cid version (got v\(version))") }
    guard codec == CID.codecDagCbor || codec == CID.codecRaw else {
      throw RepoError.range("incorrect cid codec (got 0x\(String(codec, radix: 16)))")
    }
    guard digestType == CID.hashSha256 else {
      throw RepoError.range("incorrect cid digest type (got 0x\(String(digestType, radix: 16)))")
    }
    guard digestSize == 32 else { throw RepoError.range("incorrect cid digest size (got \(digestSize))") }
    return CID(validated: Array(source[offset..<cidEnd]))
  }

  /// `verifyBlock`: the block's bytes must hash to its CID's digest.
  public static func verifyBlock(_ cid: CID, _ bytes: ArraySlice<UInt8>) throws {
    let actual = SHA256.hash(bytes)
    guard actual.elementsEqual(cid.digest) else {
      let computed = try CID.fromDigest(codec: cid.codec, digest: actual)
      throw RepoError.plain("car block does not match its cid; expected=\(cid.string); actual=\(computed.string)")
    }
  }
}
