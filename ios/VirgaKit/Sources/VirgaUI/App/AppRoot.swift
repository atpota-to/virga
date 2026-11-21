// Ports src/App.jsx
//
// The app's states: restoring a session, signed out (the front page),
// coming back from a sign-in that failed, and signed in (the shell). Two
// things stand in front of those. The Terms of Service and the Privacy
// Policy are pages of their own (/terms, /privacy), read the same whatever
// the session is doing. And a signed-in account that hasn't agreed to the
// current ones gets the agreement screen in the shell's place: nothing of
// the app is drawn, and nothing read for the account, until it agrees.
//
// Switching accounts happens in place: the shell stays up while the next
// account's agent is built, then everything below the per-account identity
// is made again for it. The session notices sit above that, so a notice
// outlives a switch.
//
// On iOS a sign-in comes back into the running app (ASWebAuthenticationSession),
// not as a new page load on the return path, so "a sign-in that came back
// without a session" is the session's error, whichever page is up; it
// says so until it is dismissed. A universal link to the return page (a
// sign-in finished in Safari) is finished the same way.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaNetwork
import VirgaSession

public struct AppRoot: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  @Environment(ShellNavigator.self) private var navigator
  @Environment(SessionModel.self) private var session
  @Environment(TermsAcceptanceModel.self) private var terms

  public init() {}

  /// What the agreement is asked of: the open account, once it has an agent.
  private struct TermsSubject: Equatable {
    var did: String?
    var mode: String?
  }

  private var subject: TermsSubject {
    TermsSubject(did: session.session != nil && session.agent != nil ? session.did : nil, mode: session.mode)
  }

  public var body: some View {
    content
      .task(id: session.did) {
        let remembered = session.accounts.first { Optional($0.did).jsEquals(session.did) }
        await app.profile.load(did: session.did, remembered: remembered)
      }
      .onChange(of: subject, initial: true) { _, next in
        terms.update(did: next.did, mode: next.mode)
      }
      .onOpenURL { url in finishReturn(url) }
      .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
        if let url = activity.webpageURL { finishReturn(url) }
      }
  }

  @ViewBuilder private var content: some View {
    if let document = LegalDocuments.documentFor(navigator.path) {
      LegalPageView(docKey: document)
    } else if session.loading {
      AppStatus("Opening Virga…")
    } else if let error = session.error {
      SignInReturnView(error: error)
    } else if let did = session.did, session.session != nil, session.agent != nil {
      signedIn(did)
    } else {
      LandingView()
    }
  }

  @ViewBuilder private func signedIn(_ did: String) -> some View {
    switch terms.status {
    case .checking:
      // Asking the server whether this account agreed somewhere else: the
      // same line as the app starting, so nothing flashes before the answer.
      AppStatus("Opening Virga…").sessionNotices()
    case .needs:
      TermsGateView().id(did).sessionNotices()
    case .accepted:
      ArchiveHost(archive: app.archive(for: did)) {
        ShellView(store: app.stores.keyValue, did: did)
      }
      .id(did)
      .sessionNotices()
    }
  }

  /// A return to `https://<server>/oauth/return#session=…` that reached the
  /// app as a link rather than through the sign-in sheet.
  private func finishReturn(_ url: URL) {
    guard url.path.hasPrefix(AppConfig.oauthReturnPath) else { return }
    Task { await session.completeSignIn(callbackURL: url.absoluteString) }
  }
}
#endif
