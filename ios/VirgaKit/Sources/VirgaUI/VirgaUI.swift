// Ports src/main.jsx
//
// VirgaUI: the SwiftUI layer. The sky and its theme (Theme/), the kit
// (Components/), the shell (Shell/: the tab bar on a phone, the sidebar
// from 900 points), the app's states (App/: restoring, the front page, a
// failed sign-in's return, the agreement, the legal pages, the shell), the
// sign-in (SignIn/), accounts (Accounts/), Settings (Settings/) and the
// platform's stores (Platform/). Views only bind to the observable models
// in the logic targets; the logic lives there, where it is tested on every
// platform. Built only on Apple platforms (Package.swift), and only where
// UIKit is (an iPhone or an iPad).
//
// VirgaRootView is what the app's window holds. It takes the app's models
// (AppModel.shared: made once for the process, the demo's under
// `-VirgaDemo YES`), puts them in the environment, gives the window its own
// address (ShellNavigator), resolves the theme at its root, and starts the
// session.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaSession

/// The app's root view: what VirgaApp puts in its window.
public struct VirgaRootView: View {
  @State private var navigator = ShellNavigator()
  private let app: AppModel

  public init() {
    self.app = AppModel.shared
  }

  /// A root over models of the caller's (a preview's, a test's).
  public init(app: AppModel) {
    self.app = app
  }

  public var body: some View {
    VirgaThemeRoot {
      AppRoot()
    }
    .environment(\.navigate, NavigateAction { [navigator] address in navigator.navigate(address) })
    .environment(\.openURL, OpenURLAction { [navigator] url in
      // A link inside the app's own text (`virga-nav:/terms`): an address
      // of the app's, not a page to leave for.
      guard let href = InternalLink.href(url) else { return .systemAction }
      navigator.navigate(href)
      return .handled
    })
    .environment(navigator)
    .environment(app)
    .environment(app.preferences)
    .environment(app.session)
    .environment(app.terms)
    .task { await app.start() }
  }
}
#endif
