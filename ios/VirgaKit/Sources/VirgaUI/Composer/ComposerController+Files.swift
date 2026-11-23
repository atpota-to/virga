// Ports src/posting/composer/Composer.jsx (revokeLater, and the loops that let go of what an old state showed)
//
// Where the web revokes a preview's object URL, the composer deletes the
// temporary file behind it (TemporaryComposerFiles), on the same test
// (Autosave.fileRefIsHeld, previewUrlIsHeld for files): only once neither
// the state on screen nor any account's kept or set-aside post holds it.
// That is after an image or the video is removed, after a send, on Start
// over and when an account goes; and an original picked, pasted, dropped
// or handed over is let go of as soon as it has been prepared, since only
// its prepared copy is attached.

#if canImport(UIKit)
import Foundation
import VirgaCore
import VirgaPosting

extension ComposerController {
  /// Deletes each of `refs` that nothing holds now.
  func letGo(_ refs: [String]) {
    guard !refs.isEmpty else { return }
    let now = state.json
    TemporaryComposerFiles.remove(refs.filter { !Autosave.fileRefIsHeld($0, now) })
  }

  /// letGo for every file `old` held.
  func letGo(of old: ComposerState) {
    letGo(Autosave.collectFileRefs(old.json))
  }

  /// letGo for incoming files (addFiles' and addDescribedImages'), once
  /// they have been taken or turned away.
  func letGo(files: [ComposerFile]) {
    letGo(files.compactMap(\.ref))
  }
}
#endif
