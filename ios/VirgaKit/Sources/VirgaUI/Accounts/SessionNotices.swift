// Ports src/accounts/SessionNotices.jsx
// Ports src/accounts/usePendingReauth.js (its use)
// Ports src/accounts/accounts.css (.session-notices, .session-notice)
//
// The notices that sit over the app about the sign-in itself: an account
// that has to sign in again (with the short hand-off before the sign-in,
// and Cancel), an account that has had to too often lately (a button
// instead), and a sign-in that couldn't start. One model for the app,
// listening to the session's events from launch, so a switch of account
// doesn't take a notice away; the view floats over whatever page is up.
//
// The web's third notice, another tab that switched accounts, has no
// counterpart: every window of the app shares one session (AppModel).

#if canImport(UIKit)
import Observation
import SwiftUI
import VirgaCore
import VirgaSession

@MainActor
@Observable
public final class SessionNoticesModel {
  public struct Notice: Equatable {
    public var text: String
    public var danger: Bool
  }

  /// A line about a sign-in (one that couldn't start, say).
  public private(set) var notice: Notice?
  /// An account to sign in again by hand, once the automatic hand-offs have
  /// run too often.
  public private(set) var stuck: SessionAccount?
  public let pending: PendingReauthModel

  @ObservationIgnored private weak var session: SessionModel?
  @ObservationIgnored private let tabStorage: (any KeyValueStore)?
  @ObservationIgnored private var listeners: [Int] = []

  public init(session: SessionModel, tabStorage: (any KeyValueStore)?, events: SessionEvents = .shared) {
    self.session = session
    self.tabStorage = tabStorage
    self.pending = PendingReauthModel(onRelogin: { _ in })
    pending.onRelogin = { [weak self] account in try await self?.reauth(account) }
    pending.onError = { [weak self] error in self?.showSignInError(error) }
    listeners.append(events.addListener(AccountCopy.reauthRequestEvent) { [weak self] event in self?.onReauthRequest(event) })
    listeners.append(events.addListener(Accounts.sessionExpiredEvent) { [weak self] event in self?.onExpired(event) })
    listeners.append(events.addListener(AccountCopy.sessionNoticeEvent) { [weak self] event in self?.onNotice(event) })
  }

  private func account(_ did: String) -> SessionAccount {
    session?.accounts.first { $0.did.jsEquals(did) } ?? SessionAccount(did: did)
  }

  /// Sign `account` in again, the way it signed in (a long session stays one).
  func reauth(_ account: SessionAccount) async throws {
    guard let session else { return }
    let row = session.accounts.first { $0.did.jsEquals(account.did) } ?? account
    try await session.signIn(
      Accounts.accountSignInId(row),
      SignInOptions(mode: AccountCopy.reauthModeFor(accountMode: row.mode, session.authMode), intent: "reauth", did: row.did))
  }

  /// Asked for by the account menu or Settings.
  private func onReauthRequest(_ event: SessionEvent) {
    guard let did = event.detail["did"]?.stringValue, let session,
      let target = session.accounts.first(where: { $0.did.jsEquals(did) })
    else { return }
    stuck = nil
    if event.detail["immediate"] == .bool(true) {
      Task { @MainActor in
        do {
          try await reauth(target)
        } catch {
          showSignInError(error)
        }
      }
    } else {
      pending.beginPendingReauth(target)
    }
  }

  /// The open account's sign-in turned out to have ended: off it goes to
  /// sign in again, unless that has happened too often lately.
  private func onExpired(_ event: SessionEvent) {
    guard let expired = event.detail["did"]?.stringValue, Optional(expired).jsEquals(session?.did) else { return }
    let target = account(expired)
    let now = Date().timeIntervalSince1970 * 1000
    if SessionHealth.reauthLooping(tabStorage, now: now) {
      stuck = target
      return
    }
    SessionHealth.recordReauthAttempt(tabStorage, now: now)
    pending.beginPendingReauth(target)
  }

  private func onNotice(_ event: SessionEvent) {
    guard let text = event.detail["text"]?.stringValue, !text.isEmpty else { return }
    show(text, danger: (event.detail["tone"]?.stringValue ?? "danger") == "danger")
  }

  func show(_ text: String, danger: Bool) {
    notice = Notice(text: text, danger: danger)
  }

  /// A sign-in that couldn't start says so; one called off (Cancel on the
  /// system's sign-in sheet) has nothing to say.
  func showSignInError(_ error: any Error) {
    if SignInTrip.calledOff(error) { return }
    show(OAuthClient.signInErrorMessage(error), danger: true)
  }

  public func dismissNotice() { notice = nil }
  public func dismissStuck() { stuck = nil }

  /// "Sign in" on the stuck account's notice.
  public func signInStuck() {
    guard let stuck else { return }
    self.stuck = nil
    Task { @MainActor in
      do {
        try await reauth(stuck)
      } catch {
        showSignInError(error)
      }
    }
  }
}

/// A sign-in trip's end, as the flow reads it.
enum SignInTrip {
  /// Called off: the system's sign-in sheet was cancelled, or the reader
  /// came back from the host (an AbortError, code CANCELLED, "navigated
  /// back"). The web never sees these here, since its page leaves; the
  /// flow's own rule (tripFailureNotice) has nothing to say about them.
  static func calledOff(_ error: any Error) -> Bool {
    SignInFlow.tripFailureNotice(error, nil) == nil
  }
}

/// The notices, floating at the top of the window over whatever page is up.
struct SessionNoticesView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app

  var body: some View {
    let model = app.notices
    VStack(spacing: Measure.Accounts.noticesGap) {
      if let account = model.pending.pendingReauthAccount {
        NoticeCard(danger: false) {
          Text("Signing you in again as \(Accounts.reauthNoticeLabel(account))…")
        } actions: {
          Button("Cancel") { model.pending.cancelPendingReauth() }
            .buttonStyle(.virga(size: .small))
        }
      }
      if let stuck = model.stuck, model.pending.pendingReauthAccount == nil {
        NoticeCard(danger: false) {
          Text("\(Accounts.reauthNoticeLabel(stuck)) needs to sign in again.")
        } actions: {
          Button("Sign in") { model.signInStuck() }
            .buttonStyle(.virga(size: .small))
          DismissButton { model.dismissStuck() }
        }
      }
      if let notice = model.notice {
        NoticeCard(danger: notice.danger) {
          Text(notice.text)
        } actions: {
          DismissButton { model.dismissNotice() }
        }
        .accessibilityIdentifier("session-notice")
      }
    }
    .frame(maxWidth: Measure.Accounts.noticesWidth)
    .padding(.horizontal, Measure.Toast.inset)
    .padding(.top, Measure.Accounts.noticesTop)
    .animation(theme.motion.sheet, value: model.notice)
  }
}

/// `.session-notice`: what floats has (--surface, a --line edge,
/// --shadow-lg); something gone wrong has the danger colour, and a rule of
/// it down the side.
struct NoticeCard<Words: View, Actions: View>: View {
  @Environment(\.virgaTheme) private var theme
  let danger: Bool
  let words: Words
  let actions: Actions

  init(danger: Bool, @ViewBuilder words: () -> Words, @ViewBuilder actions: () -> Actions) {
    self.danger = danger
    self.words = words()
    self.actions = actions()
  }

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: theme.radiusLg)
    HStack(spacing: Measure.Accounts.noticeGap) {
      words
        .virgaText(.textBase)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
      actions
    }
    .foregroundStyle(danger ? theme.danger : theme.ink)
    .padding(Measure.Accounts.noticePadding)
    .background(shape.fill(theme.surface))
    .overlay(alignment: .leading) {
      if danger {
        Rectangle().fill(theme.danger).frame(width: Measure.Accounts.noticeDangerRule)
      }
    }
    .clipShape(shape)
    .overlay(shape.strokeBorder(theme.line, lineWidth: 1))
    .virgaShadow(theme.shadow(theme.tokens.shadowLg))
    .transition(.opacity.combined(with: .offset(y: -Measure.SignIn.stepRise)))
    .accessibilityElement(children: .contain)
  }
}

/// A notice's ✕: "Dismiss".
struct DismissButton: View {
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: Glyph.close)
    }
    .buttonStyle(.virga(.ghost, size: .small, icon: true))
    .accessibilityLabel("Dismiss")
  }
}

extension View {
  /// The session's notices over this view.
  func sessionNotices() -> some View {
    overlay(alignment: .top) {
      SessionNoticesView()
    }
  }
}
#endif
