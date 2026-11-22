// Ports src/archive/ArchiveContext.jsx (ArchiveProvider)
// Ports src/App.jsx (the ArchiveProvider around the shell, keyed by account)
//
// The open account's archive, shared with every page under the shell: made
// once per signed-in account (AppModel.archive(for:)), started when the
// shell appears (the hook's mount: the store is opened and read, and an
// unfinished build is picked up or a stale archive topped up), and stopped
// when it goes: signed out, or another account opened, which makes the
// shell again. Leaving calls a sync under way off, as the task's
// cancellation. Pages read it as `@Environment(ArchiveModel.self)`; its
// `nowMs` is the context's "now", and the profile is AppModel's.
//
// The model keeps the agent it was made with, where the web reads the
// latest one; Virga's server hands an account one agent for its session.
// Its handle follows the profile (AppModel.archiveHandle(for:)), as the
// hook's argument does.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore

struct ArchiveHost<Content: View>: View {
  @Environment(AppModel.self) private var app
  @State private var archive: ArchiveModel
  private let content: Content

  init(archive: ArchiveModel, @ViewBuilder content: () -> Content) {
    _archive = State(initialValue: archive)
    self.content = content()
  }

  var body: some View {
    content
      .environment(archive)
      .task { await archive.start() }
      // The web hands the hook the profile's handle on every render, so the
      // fresh read corrects the stand-in: the archive follows it here.
      .onChange(of: app.archiveHandle(for: archive.did), initial: true) { _, handle in
        if !archive.handle.jsEquals(handle) { archive.handle = handle }
      }
      .onDisappear { app.closeArchive(archive) }
  }
}
#endif
