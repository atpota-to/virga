// Ports src/posting/composer/ComposerContext.jsx
// Ports src/shell/Shell.jsx (OpenComposer: /posting/compose and /intent/compose)
// Ports src/App.jsx (the ComposerProvider above the per-account key)
//
// The composer's host, held above the per-account identity (AppRoot), so
// an open composer, and what's written in it, survives switching accounts.
// Anything that wants to start a post calls `host.open(intent)` (the
// intent's shape is the web's DESIGN.md §6.3: text, texts, reply, quote,
// tags, langs, asDid, fromLink, url, …); New post, /posting/compose and
// /intent/compose come through OpenComposerPage, and
// virga://compose?text=…&url=…&tags=… and the universal link
// https://<virga>/intent/compose?… through the app's onOpenURL and
// onContinueUserActivity.
//
// Once opened, the composer's state stays (the controller is the host's),
// closed, so what was being written is still there the next time. It is a
// sheet: on a phone the whole height, with the send button in a bar at
// the top; on a wider window the composer's 640-point dialog, as tall as
// what's in it. The scene going to the background flushes the autosave.
//
// Its ToastCenter is the app's one (App.jsx's ToastProvider, above the
// account): the host puts it in the environment of everything under it and
// draws it, so every page's toasts and the composer's share one column, at
// most three, and outlive a switch of account.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting
import VirgaSession

@MainActor
@Observable
public final class ComposerHost {
  /// The intent the composer last opened with; a fresh one per open, so the
  /// same words twice still count as a new open.
  public private(set) var intent: JSONValue?
  public private(set) var opens = 0
  public var isOpen = false
  /// What the composer holds while it's closed.
  public internal(set) var controller: ComposerController?
  /// The publisher the composer sends through (publish.js's seam); nil is
  /// the app's own, PostingPublisher over the session's transport.
  @ObservationIgnored public var publisher: (any ComposerPublisher)?
  /// The composer's toasts (Posted, and what went wrong), over the page
  /// once it closes.
  public let toasts = ToastCenter()

  public init(publisher: (any ComposerPublisher)? = nil) {
    self.publisher = publisher
  }

  /// `open(intent)`: anything but an object opens with nothing.
  public func open(_ next: JSONValue = .object([:])) {
    if case .object = next { intent = next } else { intent = .object([:]) }
    opens += 1
    isOpen = true
  }

  public func close() {
    isOpen = false
  }

  /// virga://compose?text=…&url=…&tags=…, or the universal link
  /// https://<virga>/intent/compose?…: the composer, filled in, as an
  /// /intent/compose link opens it. False for any other address.
  @discardableResult
  public func openLink(_ url: URL) -> Bool {
    guard let search = ComposeIntent.composeLinkSearch(url) else { return false }
    open(Self.intent(search: search, fromLink: true))
    return true
  }

  /// OpenComposer's intent from an address's query.
  static func intent(search: String, fromLink: Bool) -> JSONValue {
    let parsed = ComposeIntent.parseComposeIntent(search)
    guard parsed.hasIntent else { return .object([:]) }
    var out: [String: JSONValue] = ["text": .string(parsed.text)]
    if !parsed.tags.isEmpty { out["tags"] = .array(parsed.tags.map(JSONValue.string)) }
    if fromLink {
      out["fromLink"] = true
      if !parsed.url.isEmpty { out["url"] = .string(parsed.url) }
    }
    return .object(out)
  }
}

/// The host's sheet, its toasts and its autosave flush, over `content`.
struct ComposerHostModifier: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.horizontalSizeClass) private var sizeClass
  @Environment(\.scenePhase) private var scenePhase
  @Environment(AppModel.self) private var app
  @Environment(SessionModel.self) private var session
  @Bindable var host: ComposerHost

  func body(content: Content) -> some View {
    content
      .environment(host)
      // Post this chart's Write a post with it: the picture as a file and
      // its description as its alt, as the web's composer.open({ images }).
      .environment(\.shareComposer, ShareComposer { draft in
        guard let file = TemporaryComposerFiles.write(draft.png, mime: "image/png", name: draft.filename) else { return }
        host.open(
          .object([
            "asDid": .string(draft.asDid), "text": .string(draft.text),
            "images": .array([.object(["file": file.json, "alt": .string(draft.alt)])]),
          ]))
      })
      .environment(host.toasts)
      .overlay {
        // Over a phone's tab bar; the shell's sidebar needs a regular width
        // as well, as ShellView's does.
        ToastStack(center: host.toasts).padding(.bottom, theme.hasSidebar && sizeClass != .compact ? 0 : theme.tabbarH)
      }
      .sheet(isPresented: sheetBinding) {
        if let controller = host.controller {
          ComposerSheet(controller: controller)
            .environment(host.toasts)
            .modifier(ComposerSheetSizing(phone: theme.composerNarrow))
        }
      }
      .onChange(of: host.opens) { _, _ in start() }
      // An account removed takes its unsent post with it, while the sheet is down too.
      .onChange(of: session.accounts.map(\.did)) { _, _ in host.controller?.forgetGoneAccounts() }
      .onChange(of: session.did) { _, _ in host.controller?.forgetGoneAccounts() }
      .onChange(of: scenePhase) { _, phase in
        if phase == .background { host.controller?.flush() }
      }
  }

  private var sheetBinding: Binding<Bool> {
    Binding(
      get: { host.isOpen && host.controller != nil },
      set: { shown in
        if !shown {
          host.controller?.flush()
          host.close()
        }
      })
  }

  private func start() {
    if host.controller == nil {
      let transport = app.archiveEnvironment.transport
      // Mentions are resolved as a post goes out, through the session's network.
      Mentions.useNetwork(transport: transport)
      host.controller = ComposerController(
        session: session, store: app.stores.keyValue, transport: transport,
        publisher: host.publisher ?? PostingPublisher(transport: transport, clock: app.archiveEnvironment.clock),
        files: app.stores.files, toasts: host.toasts,
        openArchive: LibraryEnvironment.archive(files: app.archiveEnvironment.files),
        close: { [weak host] in host?.close() })
    }
    host.controller?.startFromIntent(host.intent ?? .object([:]))
  }
}

/// A phone's sheet is the whole height; a wider window's is the composer's
/// own dialog, 640 wide (posting.css's `.composer-dialog`) and as tall as
/// what's in it, its foot straight under the post's settings (composer.css:
/// a flex column up to `max-height: calc(100svh - 48px)`, which the system
/// keeps it inside), where the system lets a sheet be sized.
struct ComposerSheetSizing: ViewModifier {
  let phone: Bool

  func body(content: Content) -> some View {
    if phone {
      content
        .presentationDetents([.large])
        .presentationDragIndicator(.hidden)
        .interactiveDismissDisabled(false)
    } else if #available(iOS 18.0, *) {
      content
        .frame(idealWidth: ComposerMeasure.dialogWidth)
        .presentationSizing(.form.fitted(horizontal: true, vertical: true))
    } else {
      content
    }
  }
}

/// How each of the composer's dialogs is sized over it, as the web sizes
/// each (DialogSheetSizing).
extension ComposerDialog {
  /// Up to this window width it is a phone's sheet, held at its detents:
  /// the library and the template editor fill the screen from 760 down
  /// (library.css), the alt text from 640 down (adviser.css), and the rest
  /// with the composer they open over (composer.css, 640).
  var phoneWidth: CGFloat {
    switch self {
    case .library, .saveTemplate: return Breakpoint.tablet
    default: return Breakpoint.composer
    }
  }

  /// Its width on a wider window: the library's `.lib-dialog` 980, the
  /// template editor's `.tpl-dialog` and the alt text's `.alt-dialog` 640,
  /// the rest the kit's `.dialog` 520.
  var sheetWidth: CGFloat {
    switch self {
    case .library: return Measure.Dialog.libraryWidth
    case .saveTemplate, .alt: return Measure.Dialog.wideWidth
    default: return Measure.Dialog.width
    }
  }

  /// `.lib-dialog { height: min(720px, 100svh - 48px) }`; the rest are as
  /// tall as what's in them.
  var sheetHeight: CGFloat? {
    if case .library = self { return Measure.Dialog.libraryHeight }
    return nil
  }

  /// A phone's sheet: the library, the template editor and the timer the
  /// whole height (`isTall`), the rest half the screen to start with.
  var detents: Set<PresentationDetent> {
    isTall ? [.large] : [.medium, .large]
  }
}

extension View {
  /// The composer's host over this view (AppRoot's signed-in content).
  public func composerHost(_ host: ComposerHost) -> some View {
    modifier(ComposerHostModifier(host: host))
  }
}

/// /posting/compose and /intent/compose: open the composer with what the
/// address carries (text, a link, tags), then move to the posting overview
/// and drop the query, so the words don't follow the reader around.
struct OpenComposerPage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ComposerHost.self) private var host: ComposerHost?
  @Environment(ShellNavigator.self) private var navigator
  @Environment(AppModel.self) private var app
  let fromLink: Bool

  var body: some View {
    VirgaPage(header: nil, contentTop: theme.space7) {
      Text("Opening the composer…")
        .virgaText(.textMd)
        .foregroundStyle(theme.muted)
        .accessibilityIdentifier("composer-opening")
    }
    .task {
      // Opened here, so a link kept from the front page is spent.
      _ = PendingCompose.takePendingCompose(store: app.stores.tab, now: Date().timeIntervalSince1970 * 1000)
      host?.open(ComposerHost.intent(search: navigator.search, fromLink: fromLink))
      navigator.navigate("/posting", keepQuery: false)
    }
  }
}
#endif
