// VirgaArchive
//
// The archive: its store, the first build and later syncs, the analytics worked out from it, and exports. Ports src/lib/analytics*.js, src/lib/followerLog.js, src/lib/syncProgress.js, src/archive/.
//
// See ios/PORTING.md for the conventions every file here follows.

import Foundation

/// The module's namespace, for version and identity.
public enum VirgaArchiveModule {
  public static let name = "VirgaArchive"
}
