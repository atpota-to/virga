// Content identifiers, as atproto uses them and @atcute/cid implements them:
// CIDv1, a SHA-256 multihash, and either the DAG-CBOR codec (records, tree
// nodes, commits) or raw (blobs). Always 36 bytes: version, codec, hash
// code, digest length, then the 32-byte digest; as text, 'b' and the bytes
// in lowercase base32 (59 characters, "bafyrei…" for DAG-CBOR, "bafkrei…"
// for raw).
//
// The web reads no other kind: not CIDv0 ("Qm…"), not other hashes. Neither
// does this port. Every function throws the web's message for what it
// refuses.

import Foundation
import VirgaCore

public struct CID: Hashable, Sendable, CustomStringConvertible {
  /// CID_VERSION: always 1.
  public static let version: UInt8 = 1
  /// HASH_SHA256: the multihash code for SHA-256.
  public static let hashSha256: UInt8 = 0x12
  /// CODEC_RAW: plain bytes (blobs).
  public static let codecRaw: UInt8 = 0x55
  /// CODEC_DCBOR: DAG-CBOR (records, MST nodes, commits).
  public static let codecDagCbor: UInt8 = 0x71

  /// The 36 bytes: version, codec, hash code, digest size, digest.
  public let bytes: [UInt8]

  /// Bytes already checked by one of the decoders.
  init(validated bytes: [UInt8]) {
    self.bytes = bytes
  }

  public var codec: UInt8 { bytes[1] }
  public var digestCodec: UInt8 { bytes[2] }
  /// The 32-byte SHA-256 digest.
  public var digest: ArraySlice<UInt8> { bytes[4..<36] }

  // MARK: Making one

  /// `fromDigest`: the CID for a precomputed SHA-256 digest.
  public static func fromDigest(codec: UInt8, digest: some Collection<UInt8>) throws -> CID {
    guard digest.count == 32 else { throw RepoError.range("invalid digest length") }
    return CID(validated: [version, codec, hashSha256, 32] + digest)
  }

  /// `create` / `createSync`: the CID of `data`, hashed with SHA-256.
  public static func create(codec: UInt8, data: [UInt8]) -> CID {
    CID(validated: [version, codec, hashSha256, 32] + SHA256.hash(data))
  }

  public static func create(codec: UInt8, data: ArraySlice<UInt8>) -> CID {
    CID(validated: [version, codec, hashSha256, 32] + SHA256.hash(data))
  }

  // MARK: Reading

  /// `decodeFirst`: a CID at the start of `bytes`, and the index just past it.
  public static func decodeFirst(_ bytes: ArraySlice<UInt8>) throws -> (cid: CID, next: Int) {
    guard bytes.count >= 36 else { throw RepoError.range("cid too short") }
    let start = bytes.startIndex
    let version = bytes[start]
    let codec = bytes[start + 1]
    let digestType = bytes[start + 2]
    let digestSize = bytes[start + 3]
    guard version == Self.version else { throw RepoError.range("incorrect cid version (got v\(version))") }
    guard codec == codecDagCbor || codec == codecRaw else {
      throw RepoError.range("incorrect cid codec (got 0x\(String(codec, radix: 16)))")
    }
    guard digestType == hashSha256 else {
      throw RepoError.range("incorrect cid digest codec (got 0x\(String(digestType, radix: 16)))")
    }
    guard digestSize == 32 else { throw RepoError.range("incorrect cid digest size (got \(digestSize))") }
    return (CID(validated: Array(bytes[start..<(start + 36)])), start + 36)
  }

  /// `decode`: exactly one CID's bytes.
  public static func decode(_ bytes: ArraySlice<UInt8>) throws -> CID {
    let (cid, next) = try decodeFirst(bytes)
    guard next == bytes.endIndex else { throw RepoError.range("cid bytes includes remainder") }
    return cid
  }

  public static func decode(_ bytes: [UInt8]) throws -> CID {
    try decode(bytes[...])
  }

  /// `fromString`: a CID from its text form ('b' + base32).
  public static func fromString(_ input: String) throws -> CID {
    guard input.utf16.count == 59, input.utf16.first == UInt16(UInt8(ascii: "b")) else {
      throw RepoError.syntax("not a valid cid string")
    }
    // One UTF-16 unit off the front, as `input.slice(1)` takes it.
    return try decode(Multibase.fromBase32(String(jsUnits: input.utf16.dropFirst())))
  }

  /// `fromBinary`: a CID as DAG-CBOR's tag 42 holds it, after a 0x00 byte.
  public static func fromBinary(_ input: ArraySlice<UInt8>) throws -> CID {
    guard input.count == 37, input.first == 0 else { throw RepoError.syntax("invalid binary cid") }
    return try decode(input.dropFirst())
  }

  public static func fromBinary(_ input: [UInt8]) throws -> CID {
    try fromBinary(input[...])
  }

  // MARK: Writing

  /// `toString`: 'b' and the bytes in base32.
  public var string: String { "b" + Multibase.toBase32(bytes) }

  public var description: String { string }

  /// `toBinary`: a 0x00 byte, then the CID's bytes.
  public var binary: [UInt8] { [0] + bytes }

  /// `toString(cid)`, by the web's name.
  public static func toString(_ cid: CID) -> String { cid.string }
}

// A CID as the data model's JSON form writes a link: `{ "$link": "bafy…" }`.
extension CID: Codable {
  private enum CodingKeys: String, CodingKey { case link = "$link" }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let text = try container.decode(String.self, forKey: .link)
    do {
      self = try CID.fromString(text)
    } catch {
      throw DecodingError.dataCorruptedError(
        forKey: .link, in: container, debugDescription: (error as? RepoError)?.message ?? "\(error)")
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(string, forKey: .link)
  }
}
