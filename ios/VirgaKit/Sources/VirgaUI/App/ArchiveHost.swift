// Ports src/archive/ArchiveContext.jsx (ArchiveProvider)
// Ports src/App.jsx (the ArchiveProvider around the shell, keyed by account)
//
// The open account's archive, shared with every page under the shell: made
// once for each shell (AppModel.makeArchive, the first time the host is
// drawn), started when the shell appears (the hook's mount: the store is
// opened and read, and an unfinished build is picked up or a stale archive
// topped up), and stopped when it goes: signed out, another account opened
// (which makes the shell again), a legal page, or its window closed. Leaving
// calls a sync under way off, as the task's cancellation. Each window's
// shell has an archive of its own, as each web tab has its own provider, so
// one window leaving never stops another's; they share the account's store.
// Pages read it as `@Environment(ArchiveModel.self)`; its `nowMs` is the
// context's "now", and the profile is AppModel's.
//
// The model keeps the agent it was made with, where the web reads the
// latest one; Virga's server hands an account one agent for its session.
// Its handle follows the profile (AppModel.archiveHandle(for:)), as the
// hook's argument does.
//
// The account's chart notes are read again when its shell opens, as
// useAnnotations reads them on mount: notes deleted with the account's
// data (Remove from this device) don't come back from the notes model kept
// since an earlier sign-in (ChartNotesModels).

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore

/// The host's archive, made the first time the host is drawn and kept for
/// as long as the host is (the host's @State keeps the first one made).
private final class HostedArchive {
  var model: ArchiveModel?
}

struct ArchiveHost<Content: View>: View {
  @Environment(AppModel.self) private var app
  @State private var hosted = HostedArchive()
  private let did: String
  private let content: Content

  init(did: String, @ViewBuilder content: () -> Content) {
    self.did = did
    self.content = content()
  }

  private var archive: ArchiveModel {
    if let made = hosted.model { return made }
    let made = app.makeArchive(did: did)
    hosted.model = made
    return made
  }

  var body: some View {
    let archive = self.archive
    content
      .environment(archive)
      .task { await archive.start() }
      // The web hands the hook the profile's handle on every render, so the
      // fresh read corrects the stand-in: the archive follows it here.
      .onChange(of: app.archiveHandle(for: archive.did), initial: true) { _, handle in
        if !archive.handle.jsEquals(handle) { archive.handle = handle }
      }
      .onAppear { ChartNotesModels.reload(archive.did) }
      .onDisappear { archive.stop() }
  }
}
#endif
