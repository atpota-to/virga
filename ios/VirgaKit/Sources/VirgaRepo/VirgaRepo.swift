// VirgaRepo
//
// A repo as one download: CAR files, DAG-CBOR and CIDs, and the CID of a
// record. Ports src/lib/carRepo.js (CarRepo.swift) and
// src/posting/lib/recordCid.js (RecordCid.swift), with what @atcute/car,
// @atcute/cbor, @atcute/cid, @atcute/varint and @atcute/multibase do for
// them: Car/, DagCbor/, CID.swift, Encoding/. SHA-256 is VirgaCore's
// (VirgaCore/Crypto/SHA256.swift).
//
// Support/ holds the JavaScript semantics the ports lean on: V8's
// Date.parse (JSDate), the property reads and conversions carRepo.js makes
// on decoded blocks (JSSemantics), and the two ways it turns bytes into
// text (UTF8Text).
//
// See ios/PORTING.md for the conventions every file here follows.

import Foundation

/// The module's namespace, for version and identity.
public enum VirgaRepoModule {
  public static let name = "VirgaRepo"
}
