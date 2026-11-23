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
// A Defense scan holds other people's names, so it goes when its account
// is signed out or forgotten (ScanStore's keepScansFor). The shell is made
// again when the number and date formats change, so nothing keeps a
// string written the old way (App.jsx's `<Shell key={formats}>`), and when
// the device moves to another time zone: the web's Date and Intl follow
// the system's zone at once, so the app reads it again when the system
// says it changed and whenever the app comes back to the front (a flight
// while it was in the background).
//
// On iOS a sign-in comes back into the running app (ASWebAuthenticationSession),
// not as a new page load on the return path, so "a sign-in that came back
// without a session" is the session's error, whichever page is up; it
// says so until it is dismissed. A universal link to the return page (a
// sign-in finished in Safari) is finished the same way. A compose link,
// virga://compose?… or the universal link to /intent/compose, opens the
// composer filled in, or is kept for after the sign-in.

#if canImport(UIKit)
import SwiftUI
import UIKit
import VirgaCore
import VirgaDefense
import VirgaNetwork
import VirgaPosting
import VirgaSession

public struct AppRoot: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  @Environment(ShellNavigator.self) private var navigator
  @Environment(SessionModel.self) private var session
  @Environment(TermsAcceptanceModel.self) private var terms
  @Environment(PreferencesModel.self) private var preferences
  @Environment(\.scenePhase) private var scenePhase
  /// The composer's host (ComposerContext), above the per-account identity,
  /// so an open composer survives switching accounts.
  @State private var composer = ComposerHost()
  /// A compose link opened while signed out waits for the sign-in: the
  /// front page says so (Landing's `composing`).
  @State private var composing = false

  public init() {}

  /// What the agreement is asked of: the open account, once it has an agent.
  private struct TermsSubject: Equatable {
    var did: String?
    var mode: String?
  }

  private var subject: TermsSubject {
    TermsSubject(did: session.session != nil && session.agent != nil ? session.did : nil, mode: session.mode)
  }

  /// The accounts that are signed in (not needing a sign-in), whose scans
  /// are kept.
  private var signedIn: [String] {
    session.accounts.filter { $0.status != .needsSignIn }.map(\.did)
  }

  public var body: some View {
    content
      .environment(\.signInComposing, composing)
      .task(id: session.did) {
        let remembered = session.accounts.first { Optional($0.did).jsEquals(session.did) }
        await app.profile.load(did: session.did, remembered: remembered)
      }
      .onChange(of: subject, initial: true) { _, next in
        terms.update(did: next.did, mode: next.mode)
      }
      // A scan goes with its account's session.
      .onChange(of: signedIn, initial: true) { _, dids in
        ScanStore.shared.keepScansFor(dids)
      }
      // An account removed takes its unsent post with it, while the sheet is
      // down too, and whichever state is drawn: the composer's host outlives
      // the shell, so with the last account gone nothing is signed in, and
      // a late patch (a video still processing) must find nobody to save for.
      .onChange(of: session.accounts.map(\.did)) { _, _ in composer.controller?.forgetGoneAccounts() }
      .onChange(of: session.did) { _, _ in composer.controller?.forgetGoneAccounts() }
      .onOpenURL { url in
        if openCompose(url) { return }
        finishReturn(url)
      }
      .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
        guard let url = activity.webpageURL else { return }
        if openCompose(url) { return }
        finishReturn(url)
      }
      .task { await followDeviceZone(on: .NSSystemTimeZoneDidChange) }
      .task { await followDeviceZone(on: UIApplication.significantTimeChangeNotification) }
      .onChange(of: scenePhase) { _, phase in
        if phase == .active { lookAtDeviceZone() }
      }
  }

  @ViewBuilder private var content: some View {
    if let document = LegalDocuments.documentFor(navigator.path) {
      // A page per document, as the web's navigate starts a new one at its
      // top and LegalPage goes to the address's section for each docKey:
      // Terms to Privacy doesn't keep the Terms' place.
      LegalPageView(docKey: document).id(document)
    } else if session.loading {
      AppStatus(session.returning ? "Signing you in…" : "Opening Virga…")
    } else if let error = session.error {
      SignInReturnView(error: error)
    } else if let did = session.did, session.session != nil, session.agent != nil {
      signedIn(did)
    } else {
      // The page's scroll view, for the sign-in to bring its field up over
      // a phone's keyboard.
      LandingView().signInScrolling()
    }
  }

  /// The agreement's answer for the account drawn: the model's once it has
  /// been told of this account, and until then decided afresh here, from
  /// the same note and the same rule (useTermsAcceptance decides in the
  /// same render), so the app is never drawn for an account on the strength
  /// of the last one's answer. The model is told just after this body
  /// (`.onChange(of: subject)`) and comes to the same answer.
  private func termsStatus(for did: String) -> TermsStatus {
    if terms.did.jsEquals(did) { return terms.status }
    let mode = session.mode
    let canAsk = mode == "backend" && session.backendFor(did) != nil
    return Acceptance.startingStatus(entry: Acceptance.readAcceptance(app.stores.keyValue, did), mode: mode, canAsk: canAsk)
  }

  @ViewBuilder private func signedIn(_ did: String) -> some View {
    switch termsStatus(for: did) {
    case .checking:
      // Asking the server whether this account agreed somewhere else: the
      // same line as the app starting, so nothing flashes before the answer.
      AppStatus("Opening Virga…").sessionNotices()
    case .needs:
      TermsGateView().id(did).sessionNotices()
    case .accepted:
      ArchiveHost(did: did) {
        // Drawn again in the new formats, or the device's new zone, when
        // they change.
        ShellView(store: app.stores.keyValue, did: did)
          .id("\(preferences.formats)|\(preferences.timeZone.identifier)")
      }
      .id(did)
      .composerHost(composer)
      .task {
        // A compose link opened while signed out (PendingCompose), now
        // there is an account to post as. It is kept in the tab store
        // (sessionStorage: "for this tab only"), which the sign-in comes
        // back into and a new launch starts without.
        let now = Date().timeIntervalSince1970 * 1000
        composing = false
        if let kept = PendingCompose.takePendingCompose(store: app.stores.tab, now: now) { navigator.navigate(kept) }
      }
      .sessionNotices()
    }
  }

  /// virga://compose?text=…&url=…&tags=…, or the universal link
  /// https://<virga>/intent/compose?… (the only one the app's associated
  /// domain claims): the composer, filled in. Kept for after the sign-in
  /// when nobody is signed in yet.
  private func openCompose(_ url: URL) -> Bool {
    guard let search = ComposeIntent.composeLinkSearch(url) else { return false }
    if session.did != nil, session.session != nil, terms.status == .accepted {
      composer.openLink(url)
    } else {
      let now = Date().timeIntervalSince1970 * 1000
      if PendingCompose.rememberPendingCompose(ComposeIntent.intentComposePath, search, store: app.stores.tab, now: now) {
        composing = true
      }
    }
    return true
  }

  /// Each time `name` is posted, the device's zone, read again.
  private func followDeviceZone(on name: Notification.Name) async {
    for await _ in NotificationCenter.default.notifications(named: name) { lookAtDeviceZone() }
  }

  /// The device's zone now (the system's cached one dropped first), made
  /// the active one if it has changed.
  private func lookAtDeviceZone() {
    NSTimeZone.resetSystemTimeZone()
    preferences.deviceZoneChanged(TimeZone.current)
  }

  /// A return to `https://<server>/oauth/return#session=…` that reached the
  /// app as a link rather than through the sign-in sheet.
  private func finishReturn(_ url: URL) {
    guard url.path.hasPrefix(AppConfig.oauthReturnPath) else { return }
    Task { await session.completeSignIn(callbackURL: url.absoluteString) }
  }
}
#endif
