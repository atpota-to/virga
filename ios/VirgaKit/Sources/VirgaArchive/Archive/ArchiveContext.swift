// Ports src/archive/ArchiveContext.jsx
//
// The web shares one archive per signed-in account with every page through
// React context (ArchiveProvider, useArchive), along with "now" (one per
// change of data) and the account's profile. Here the shared thing is the
// ArchiveModel itself, which VirgaUI hands down through the SwiftUI
// environment; the model's `nowMs` is the context's "now". What is left as
// logic is isBuilt.

import Foundation

public enum ArchiveContext {
  /// Whether the archive has anything to chart yet.
  public static func isBuilt(_ archive: ArchiveData) -> Bool {
    archive.loaded && archive.meta.posts != nil
  }
}
