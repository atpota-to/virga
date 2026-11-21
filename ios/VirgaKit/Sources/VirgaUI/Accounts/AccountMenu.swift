// Ports src/accounts/AccountMenu.jsx
// Ports src/accounts/AddAccountDialog.jsx
// Ports src/accounts/accounts.css (the account menu)
// Ports src/shell/shell.css (.account-menu, .account-who)
//
// The account button at the top of the sidebar (and in a phone's app bar):
// every account signed in here, to switch between in place, and the ways to
// add, lengthen, end or recover a sign-in. A sign-out that would stop work
// waiting on Virga's server asks first (SignOutGuard). Add an account is the
// front page's sign-in, a step at a time, in a dialog.
//
// Not here yet: the compact menu's Sync now (the archive's).

#if canImport(UIKit)
import Observation
import SwiftUI
import VirgaCore
import VirgaSession

/// The name for the open account's profile: display name, else @handle,
/// else a short DID.
func accountName(_ profile: AccountProfile?, did: String?) -> String {
  if let name = profile?.displayName, !name.isEmpty { return name }
  if let handle = profile?.handle, !handle.isEmpty { return "@\(handle)" }
  return Accounts.shortDid(did)
}

/// A row's name, from the remembered account.
func rowName(_ account: SessionAccount) -> String {
  accountName(AccountProfile(handle: account.handle, displayName: account.displayName), did: account.did)
}

/// useAccountActions: switch in place; an account whose sign-in has ended
/// goes to the hand-off that signs it in again (SessionNotices).
@MainActor
enum AccountActions {
  static func open(_ account: SessionAccount, session: SessionModel) {
    if account.status == .needsSignIn {
      AccountCopy.requestReauth(account.did, immediate: true)
      return
    }
    Task { @MainActor in
      do {
        try await session.switchAccount(account.did)
      } catch {
        if Accounts.isReauthRequiredError(error) {
          AccountCopy.requestReauth(account.did)
        } else {
          AccountCopy.showSessionNotice("Couldn’t open \(rowName(account)). Check your connection and try again.")
        }
      }
    }
  }

  static func lengthen(_ account: SessionAccount, session: SessionModel) {
    Task { @MainActor in
      do {
        try await session.signIn(Accounts.accountSignInId(account), SignInOptions(mode: "backend", intent: "reauth", did: account.did))
      } catch {
        AccountCopy.showSessionNotice(OAuthClient.signInErrorMessage(error))
      }
    }
  }
}

/// useSignOutGuard: sign-outs that ask first when they would stop work
/// waiting on Virga's server.
@MainActor
@Observable
final class SignOutGuard {
  struct Ask {
    var account: SessionAccount
    var work: PendingWorkCount?
    var proceed: @MainActor () async -> Void
  }

  var ask: Ask?
  /// The DID being looked at.
  var checking: String?

  /// Runs `proceed` straight away for a browser session or a long one with
  /// nothing waiting; otherwise asks.
  func guardSignOut(_ account: SessionAccount, app: AppModel, proceed: @escaping @MainActor () async -> Void) {
    let requester = account.mode == "backend" && account.status != .needsSignIn ? app.session.backendFor(account.did) : nil
    guard let requester else {
      Task { @MainActor in await proceed() }
      return
    }
    checking = account.did
    let services = app.pendingWork
    Task { @MainActor in
      var work: PendingWorkCount?
      if let services {
        work = try? await PendingWork.readPendingWork(requester, services: services)
      }
      checking = nil
      if !PendingWork.hasPendingWork(work) {
        await proceed()
        return
      }
      ask = Ask(account: account, work: work, proceed: proceed)
    }
  }
}

/// The dialog SignOutGuard opens.
struct SignOutWarning: ViewModifier {
  @Bindable var signOutGuard: SignOutGuard
  @State private var busy = false

  func body(content: Content) -> some View {
    let name = signOutGuard.ask.map { rowName($0.account) } ?? ""
    return content.virgaDialog(
      isPresented: Binding(get: { signOutGuard.ask != nil }, set: { if !$0 { signOutGuard.ask = nil } }), title: "Sign out of \(name)"
    ) {
      if let ask = signOutGuard.ask {
        Callout(tone: .warn) { Text(AccountCopy.pendingWorkWarning(name, ask.work) ?? "") }
      }
    } actions: {
      Button("Cancel") { signOutGuard.ask = nil }.buttonStyle(.virga)
      Button(busy ? "Signing out…" : "Sign out") {
        guard let ask = signOutGuard.ask else { return }
        busy = true
        Task { @MainActor in
          await ask.proceed()
          busy = false
          signOutGuard.ask = nil
        }
      }
      .buttonStyle(.virga(.danger))
      .disabled(busy)
    }
  }
}

/// The warnings for `accounts` whose sign-out would stop work waiting on
/// Virga's server. Without the posting services to read it through, each
/// long session reads as one that couldn't be checked, as a failed read
/// does on the web.
struct PendingWorkWarnings: View {
  let accounts: [SessionAccount]
  let model: PendingWorkModel?

  var body: some View {
    if let model, model.checking {
      NoteText("Checking for scheduled posts and post timers…")
    } else {
      ForEach(lines, id: \.0) { line in
        Callout(tone: .warn) { Text(line.1) }
      }
    }
  }

  private var lines: [(String, String)] {
    accounts.compactMap { account -> (String, String)? in
      guard account.mode == "backend", account.status != .needsSignIn else { return nil }
      let entry: PendingWorkEntry = model.map { $0.entry(account.did) } ?? .unreadable
      guard PendingWork.hasPendingWork(entry), let text = AccountCopy.pendingWorkWarning(rowName(account), entry) else { return nil }
      return (account.did, text)
    }
  }
}

/// Confirm, then sign every account here out, the open one last.
struct SignOutAllDialog: ViewModifier {
  @Environment(AppModel.self) private var app
  @Binding var isPresented: Bool
  @State private var busy = false
  @State private var work: PendingWorkModel?

  func body(content: Content) -> some View {
    let session = app.session
    let signedIn = session.accounts.filter { $0.status != .needsSignIn }
    return content.virgaDialog(isPresented: $isPresented, title: "Sign out of all \(signedIn.count) accounts") {
      DialogForm {
        Text("Each account’s session in this browser ends. Their archives and dashboards stay here, and each can sign back in from the front page.")
          .fixedSize(horizontal: false, vertical: true)
        PendingWorkWarnings(accounts: signedIn, model: work)
      }
    } actions: {
      Button("Cancel") { isPresented = false }.buttonStyle(.virga)
      Button(busy ? "Signing out…" : "Sign out of all") {
        busy = true
        let order = signedIn.filter { !Optional($0.did).jsEquals(session.did) } + signedIn.filter { Optional($0.did).jsEquals(session.did) }
        Task { @MainActor in
          for account in order { await session.signOutAccount(account.did) }
          busy = false
          isPresented = false
        }
      }
      .buttonStyle(.virga(.danger))
      .disabled(busy || work?.checking == true)
    }
    .onChange(of: isPresented) { _, open in
      if open, let services = app.pendingWork {
        let model = PendingWorkModel(backendFor: { [weak session] did in session?.backendFor(did) }, services: services)
        model.update(accounts: signedIn, enabled: true)
        work = model
      } else if !open {
        work?.stop()
        work = nil
      }
    }
  }
}

/// Add an account: the front page's sign-in, started afresh each time.
struct AddAccountDialog: ViewModifier {
  @Environment(SessionModel.self) private var session
  @Binding var isPresented: Bool

  func body(content: Content) -> some View {
    content.virgaDialog(isPresented: $isPresented, title: "Add an account", size: .tall) {
      DialogForm {
        SignInFlowView(variant: .dialog) { isPresented = false }
        NoteText(
          "You sign in on the account’s own host, then come back here with it open. The accounts already signed in stay signed in, and each keeps its own archive."
            + (session.authMode == "backend" ? " It will be a long session, kept by Virga’s server." : ""))
      }
    }
  }
}

public struct AccountMenu: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(\.openURL) private var openURL
  @Environment(AppModel.self) private var app
  @Environment(SessionModel.self) private var session
  @State private var adding = false
  @State private var signingOutAll = false
  @State private var signOutGuard = SignOutGuard()
  private let compact: Bool

  public init(compact: Bool) {
    self.compact = compact
  }

  public var body: some View {
    let profile = app.profile.profile
    let did = session.did
    let name = accountName(profile, did: did)
    let handle = profile?.handle
    VirgaMenu(
      accessibilityLabel: "Account: \(handle.map { "@\($0)" } ?? did ?? "")\(session.switching != nil ? ". Switching accounts…" : "")",
      entries: entries(name: name, handle: handle)
    ) {
      label(profile: profile, name: name, handle: handle)
    }
    .accessibilityIdentifier("account-menu")
    .modifier(AddAccountDialog(isPresented: $adding))
    .modifier(SignOutAllDialog(isPresented: $signingOutAll))
    .modifier(SignOutWarning(signOutGuard: signOutGuard))
  }

  @ViewBuilder
  private func label(profile: AccountProfile?, name: String, handle: String?) -> some View {
    if compact {
      Avatar(src: profile?.avatar, name: name, size: .small, side: Measure.Account.avatarSize)
        .frame(width: Measure.Account.compactSize, height: Measure.Account.compactSize)
        .contentShape(Circle())
    } else {
      HStack(spacing: Measure.Account.buttonGap) {
        Avatar(src: profile?.avatar, name: name, size: .medium, side: Measure.Account.avatarSize)
        VStack(alignment: .leading, spacing: 0) {
          Text(name)
            .virgaText(.textBase, weight: VirgaWeight.semibold, lineHeight: ThemeKit.headingLineHeight)
            .foregroundStyle(theme.ink)
            .lineLimit(1)
          if session.switching != nil {
            Text("Switching…").virgaText(.textSm).foregroundStyle(theme.muted).lineLimit(1)
          } else if let handle {
            Text("@\(handle)").virgaText(.textSm).foregroundStyle(theme.muted).lineLimit(1)
          }
        }
        Spacer(minLength: 0)
      }
      .padding(Measure.Account.buttonPadding)
      .frame(minHeight: Measure.Account.buttonHeight)
      .contentShape(RoundedRectangle(cornerRadius: theme.radiusLg))
      .padding(-Measure.Account.buttonPadding)
    }
  }

  private func entries(name: String, handle: String?) -> [MenuEntry] {
    let model = session
    let shell = app
    let guarding = signOutGuard
    let did = session.did
    let accounts = session.accounts
    let active = accounts.first { Optional($0.did).jsEquals(did) }
    let signedIn = accounts.filter { $0.status != .needsSignIn }
    // The open account first, then the rest by when they were last used.
    let ordered = accounts.filter { Optional($0.did).jsEquals(did) } + accounts.filter { !Optional($0.did).jsEquals(did) }
    var out: [MenuEntry] = []
    if ordered.count > 1 || active?.status == .needsSignIn {
      for account in ordered {
        let isActive = Optional(account.did).jsEquals(did)
        var words: [String] = []
        if let h = account.handle, !h.isEmpty { words.append("@\(h)") }
        if let status = AccountCopy.statusLabel(
          account.status.rawValue, active: isActive, switching: Optional(account.did).jsEquals(session.switching))
        {
          words.append(status)
        }
        if account.status == .needsSignIn { words.append("Sign back in") }
        let opens = !(isActive && account.status != .needsSignIn)
        out.append(
          .item(
            MenuItem(
              rowName(account), key: "account:\(account.did)", hint: words.joined(separator: " · "), systemImage: Glyph.account,
              action: opens ? { AccountActions.open(account, session: model) } : nil)))
      }
      out.append(.separator)
    }
    out.append(.item(MenuItem("Add an account", key: "add", systemImage: Glyph.userPlus) { adding = true }))
    if let active, AccountCopy.offersLongerSession(accountMode: active.mode, session.authMode) {
      out.append(
        .item(
          MenuItem(
            "Reconnect for a longer session", key: "lengthen",
            hint: "Sign in again through Virga’s server, so you stay signed in and can schedule posts.", systemImage: Glyph.timer
          ) { AccountActions.lengthen(active, session: model) }))
    }
    if active?.status == .needsSignIn {
      out.append(
        .item(MenuItem("Sign back in as \(name)", key: "sign-back-in", systemImage: Glyph.signIn) { AccountCopy.requestReauth(did, immediate: true) }))
    }
    out.append(.separator)
    let profileId = handle ?? did ?? ""
    out.append(
      .item(
        MenuItem("Open your profile on Bluesky", key: "profile", systemImage: Glyph.externalLink) {
          if let url = URL(string: "https://bsky.app/profile/\(JSURI.encodeURIComponent(profileId))") { openURL(url) }
        }))
    out.append(.item(MenuItem("Accounts and settings", key: "settings", systemImage: Glyph.settings) { navigate("/settings") }))
    out.append(.separator)
    // No hint: when signing out would stop scheduled posts or timers, the
    // guard asks first and says so.
    let me = active ?? SessionAccount(did: did ?? "", mode: session.mode ?? "backend")
    out.append(
      .item(
        MenuItem(signedIn.count > 1 ? "Sign out of \(name)" : "Sign out", key: "sign-out", systemImage: Glyph.signOut) {
          guarding.guardSignOut(me, app: shell) { await shell.session.signOut() }
        }))
    if signedIn.count > 1 {
      out.append(
        .item(
          MenuItem("Sign out of all \(signedIn.count) accounts", key: "sign-out-all", systemImage: Glyph.users, destructive: true) {
            signingOutAll = true
          }))
    }
    return out
  }
}
#endif
