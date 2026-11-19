// VirgaRepo
//
// A repo as one download: CAR files, DAG-CBOR and CIDs. Ports src/lib/carRepo.js (and what @atcute/car, @atcute/cbor and @atcute/cid do for it).
//
// See ios/PORTING.md for the conventions every file here follows.

import Foundation

/// The module's namespace, for version and identity.
public enum VirgaRepoModule {
  public static let name = "VirgaRepo"
}
