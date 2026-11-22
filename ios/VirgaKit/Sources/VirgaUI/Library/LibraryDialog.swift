// Ports src/posting/library/LibraryDialog.jsx
// Ports src/posting/pages/LibraryPage.jsx
// Ports src/posting/library/library.css (.lib-dialog)
//
// The library two ways. The composer's dialog: pick something to quote,
// attach or start from, for the post being written; the plan (any
// template's questions answered, its attachment read again) goes back to
// the composer, which puts it in. And the page (/posting/library): every
// shelf, to browse on its own, where using something starts a new post
// with it in, and New template opens the template editor.
//
// Both run VirgaPosting's LibraryModel (useLibrary) over the app's library
// store, the session's transport, the account's archive and the composer's
// stand-in for linkCard.js.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaNetwork
import VirgaPosting
import VirgaSession

/// The library's environment in the app (LibraryEnvironment): the session's
/// transport, the account's archive, the link-card stand-in, the usage store.
@MainActor
enum LibraryWiring {
  static func environment(_ app: AppModel) -> LibraryEnvironment {
    let transport = app.archiveEnvironment.transport
    return LibraryEnvironment(
      transport: transport, openStore: LibraryEnvironment.archive(files: app.archiveEnvironment.files),
      fetchLinkCard: { url in await ComposerLinkCards.fetchLinkCard(url, transport: transport)?.json },
      usageStore: app.stores.keyValue)
  }

  static func handle(_ session: SessionModel, _ did: String?) -> String? {
    session.accounts.first { Optional($0.did).jsEquals(did) }?.handle
  }
}

/// What the composer asks the library for: the post, where its text goes,
/// the shelf or the template to open on.
struct LibraryRequest: Equatable {
  var postId: String
  var range: TextSelection?
  var templateRkey: String?
  var shelf: String?
}

/// The composer's library dialog (LibraryDialog).
struct LibraryDialog: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  let controller: ComposerController
  let request: LibraryRequest
  let onClose: () -> Void
  @State private var lib: LibraryModel?

  var body: some View {
    let state = controller.state
    let postIndex = max(0, controller.indexOfPost(request.postId))
    VStack(spacing: 0) {
      HStack {
        Text(Library.libraryName)
          .virgaText(.textLg, weight: VirgaWeight.semibold, tracking: Measure.Dialog.titleTracking)
          .foregroundStyle(theme.ink)
          .accessibilityAddTraits(.isHeader)
          .accessibilityIdentifier("dialog-title")
        Spacer(minLength: 0)
        Button(action: onClose) { Image(systemName: Glyph.close) }
          .buttonStyle(.virga(.ghost, size: .small, icon: true))
          .accessibilityLabel("Close")
          .accessibilityIdentifier("library-close")
      }
      .padding(theme.isPhone ? Measure.Dialog.phoneHead : Measure.Dialog.head)
      ScrollView {
        if let lib {
          LibraryPanel(
            lib: lib, mode: .dialog, state: state.json, postIndex: postIndex, insertion: request.range,
            initialShelf: LibraryUI.initialShelf(request.shelf, replying: lib.replying),
            focusTemplate: request.templateRkey, transport: controller.transport
          ) { item, answers in
            // Not counted here: the composer counts a template's use as it
            // applies the plan.
            let plan = try await lib.planFor(item, answers: answers)
            onClose()
            let request = self.request
            Task {
              await Task.yield()
              await controller.applyPlan(plan, request.postId, range: request.range)
            }
          }
          .padding(theme.isPhone ? Measure.Dialog.phoneBody : Measure.Dialog.body)
        }
      }
    }
    .background(theme.surface)
    .task {
      guard lib == nil else { return }
      let did = controller.asDid
      let made = LibraryModel(
        // Its own templates model: the library stops it on closing, and the
        // composer's slash list keeps following its own.
        session: app.session, templates: TemplatesModel(session: app.session, did: did), did: did, isOpen: true,
        reply: controller.state.reply?.json, selfHandle: LibraryWiring.handle(app.session, did),
        environment: LibraryWiring.environment(app))
      made.start()
      lib = made
    }
    .onDisappear {
      lib?.setOpen(false)
      lib?.stop()
    }
    .accessibilityIdentifier("library-dialog")
  }
}

/// The library as a page: every shelf, to browse on its own. Using
/// something starts a new post with it in.
struct LibraryScreen: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  @Environment(ComposerHost.self) private var composer: ComposerHost?
  let did: String?
  @State private var lib: LibraryModel?
  @State private var newTemplate = false

  var body: some View {
    VirgaPage(PostingHeader.model("library")) {
      if let lib {
        LibraryPanel(
          lib: lib, mode: .page, initialShelf: "templates", verb: "Use in a new post",
          transport: app.archiveEnvironment.transport, onNewTemplate: { newTemplate = true }
        ) { item, answers in
          // The composer counts a template's use as it applies the plan.
          let plan = try await lib.planFor(item, answers: answers)
          var intent: [String: JSONValue] = ["attach": plan.json]
          if let did { intent["asDid"] = .string(did) }
          composer?.open(.object(intent))
        }
      } else {
        LibrarySkeleton()
      }
    }
    .task {
      guard lib == nil else { return }
      let made = LibraryModel(
        session: app.session, templates: TemplatesModel(session: app.session, did: did), did: did, isOpen: true,
        selfHandle: LibraryWiring.handle(app.session, did), environment: LibraryWiring.environment(app))
      made.start()
      lib = made
    }
    .onDisappear { lib?.stop() }
    .templateEditor(isPresented: $newTemplate, did: did, template: nil)
  }
}
#endif
