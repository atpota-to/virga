// Ports src/accounts/AccountsSettings.jsx
// Ports src/accounts/PostingPermissionNotice.jsx
// Ports src/accounts/accounts.css (.accounts-row, .accounts-how)
//
// Settings › Account: every account signed in here, how each is signed in,
// and the ways to switch, lengthen, end or forget it. One account a row:
// who it is, how it's signed in, then at most one thing to do in words
// (sign back in, sign in again, or switch to it) and a ⋯ for the rest, with
// removing it from this device last and in red.
//
// PostingPermissionNotice is shown where an account is about to post when
// its session was granted before Virga asked for posting: signing in again
// asks for it.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaSession

struct AccountsSettings: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(AppModel.self) private var app
  @Environment(SessionModel.self) private var session
  @State private var adding = false
  @State private var signingOutAll = false
  @State private var removing: SessionAccount?
  @State private var signOutGuard = SignOutGuard()

  var body: some View {
    let did = session.did
    let accounts = session.accounts
    let ordered = accounts.filter { Optional($0.did).jsEquals(did) } + accounts.filter { !Optional($0.did).jsEquals(did) }
    let signedIn = accounts.filter { $0.status != .needsSignIn }
    VStack(alignment: .leading, spacing: theme.sectionGap) {
      SettingsSectionView(
        title: "Accounts",
        subView: AnyView(
          Text(
            AttributedString(
              "Each account has its own archive and dashboards. Switching doesn’t sign anyone out. Your DID, PDS and past handles are in the "
            ) + pageLink("Identity inspector", to: "/tools/identity") + AttributedString(".")
          )
          .tint(theme.ink)),
        action: AnyView(
          Button {
            adding = true
          } label: {
            Label("Add an account", systemImage: Glyph.userPlus)
          }
          .buttonStyle(.linkAction)
          .accessibilityIdentifier("accounts-add"))
      ) {
        VStack(spacing: 0) {
          ForEach(ordered, id: \.did) { account in
            AccountSettingsRow(
              account: account, active: Optional(account.did).jsEquals(did), signOutGuard: signOutGuard, onRemove: { removing = account })
          }
        }
        if signedIn.count > 1 {
          SectionFoot {
            Button {
              signingOutAll = true
            } label: {
              Label("Sign out of all \(signedIn.count) accounts", systemImage: Glyph.signOut)
            }
            .buttonStyle(.linkAction)
          }
        }
      }
      howLong
    }
    .modifier(AddAccountDialog(isPresented: $adding))
    .modifier(SignOutAllDialog(isPresented: $signingOutAll))
    .modifier(SignOutWarning(signOutGuard: signOutGuard))
    .modifier(RemoveAccountDialog(account: $removing))
  }

  /// What the two kinds of sign-in mean, for whoever wants to know: closed
  /// until it's opened, so the page is the accounts first.
  private var howLong: some View {
    let host = AppConfig.backendHost(app.flags.backendURL)
    return Disclosure("How long a sign-in lasts") {
      VStack(alignment: .leading, spacing: theme.space3) {
        Text("There are two kinds. Each account above says which it has.")
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: theme.measure, alignment: .leading)
        SettingsBody {
          SettingsRow(label: "Browser session", kind: .prose) {
            note(
              "The sign-in is kept by the browser, which talks to your account’s server directly. It usually lasts up to two weeks."
            )
          }
          SettingsRow(label: "Long session through Virga’s server", kind: .prose) {
            note(
              "The sign-in is held by Virga’s server (\(host)), which passes your requests on and stays signed in while you keep using it. Scheduled posts, timers and the post adviser need one."
            )
          }
          SettingsRow(label: "Signing out", kind: .prose) {
            note(
              "Signing out ends the session here only: your other browsers and devices stay signed in. Scheduled posts and timers keep running while any browser or device is signed in with a long session; signing out of the last one stops them."
                + (session.authMode != "backend" ? " This copy of Virga signs new accounts in through the browser." : ""))
          }
        }
      }
    }
  }

  private func note(_ text: String) -> some View {
    Text(text)
      .virgaText(.textBase)
      .foregroundStyle(theme.ink2)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: theme.measure, alignment: .leading)
  }
}

struct AccountSettingsRow: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  @Environment(AppModel.self) private var app
  @Environment(SessionModel.self) private var session
  let account: SessionAccount
  let active: Bool
  let signOutGuard: SignOutGuard
  let onRemove: () -> Void
  @State private var busy = false

  private var profileURL: URL? {
    URL(string: "https://bsky.app/profile/\(JSURI.encodeURIComponent(account.handle ?? account.did))")
  }

  var body: some View {
    let name = rowName(account)
    let needsSignIn = account.status == .needsSignIn
    let switching = Optional(account.did).jsEquals(session.switching)
    let label = AccountCopy.statusLabel(account.status.rawValue, active: active, switching: switching)
    // The open account is marked after its name: the accent's dot and quiet words.
    let current = active && !needsSignIn && account.status != .unknown && !switching
    let checking = Optional(account.did).jsEquals(signOutGuard.checking)
    let working: String? = busy ? "Signing out…" : checking ? "Checking…" : nil
    let state = working ?? (current ? nil : label)
    // The name is the handle when there's no display name; it isn't said twice.
    let handle = (account.displayName?.isEmpty == false) && (account.handle?.isEmpty == false) ? account.handle : nil
    // The web's grid, 'avatar name actions' / 'avatar meta meta': the
    // picture centred beside both lines, the actions on the name's line,
    // and the line under the name running on beneath them, so a phone
    // keeps the row's width for it.
    HStack(alignment: .center, spacing: Measure.Accounts.rowGap) {
      Avatar(src: account.avatar, name: name, size: .large)
      VStack(alignment: .leading, spacing: Measure.Accounts.rowLineGap) {
        HStack(alignment: .top, spacing: Measure.Accounts.rowGap) {
          HStack(spacing: Measure.Accounts.nameGap) {
            Text(name)
              .virgaText(.textMd, weight: VirgaWeight.medium, lineHeight: Measure.Accounts.nameLineHeight)
              .foregroundStyle(theme.ink)
              .fixedSize(horizontal: false, vertical: true)
            if current, let label {
              HStack(spacing: Measure.Accounts.currentGap) {
                StateDot(.current)
                Text(label).virgaText(.textSm).foregroundStyle(theme.muted)
              }
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          HStack(spacing: theme.points(ThemeKit.rowActionsGap)) {
            action(name: name)
            MoreMenu(label: "More for \(name)", entries: entries)
          }
          // Centred on the name's line, reaching past it above by the
          // difference and 3 below it; 4 more than the gap from the words.
          .padding(.top, -Measure.Section.rowActionsLift)
          .padding(.bottom, -Measure.Accounts.actionsReachBelow)
          .padding(.leading, Measure.Accounts.actionsSpaceBefore)
        }
        meta(state: state, needsSignIn: needsSignIn, working: working, handle: handle)
      }
    }
    .padding(.vertical, theme.rowPadLg)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("account-row-\(account.did)")
  }

  /// What there is to know about the sign-in: a state if it has one, the
  /// handle (the way to its profile) and how it is signed in. On a phone how
  /// it is signed in takes a line of its own, with no dot before it.
  @ViewBuilder
  private func meta(state: String?, needsSignIn: Bool, working: String?, handle: String?) -> some View {
    let ownLine = theme.isPhone && (state != nil || handle != nil)
    VStack(alignment: .leading, spacing: 0) {
      FlowLayout(spacing: 0, lineSpacing: 0) {
        if let state {
          MetaPiece(isLast: ownLine && handle == nil) {
            if needsSignIn && working == nil {
              Badge(state)
            } else {
              Text(state)
            }
          }
        }
        if let handle {
          MetaPiece(isLast: ownLine) {
            handleLink(handle)
          }
        }
        if !ownLine {
          MetaPiece(isLast: true) {
            Text(AccountCopy.modeLabel(account.mode))
          }
        }
      }
      if ownLine {
        MetaPiece(isLast: true) {
          Text(AccountCopy.modeLabel(account.mode))
        }
      }
    }
  }

  /// `.accounts-row-handle`: the way to its profile, pressed by a finger
  /// reaching past its line into the words above and below it.
  private func handleLink(_ handle: String) -> some View {
    Button {
      if let profileURL { openURL(profileURL) }
    } label: {
      HStack(spacing: theme.points(ThemeKit.metaItemGap)) {
        Text("@\(handle)")
        Image(systemName: Glyph.externalLink).font(.system(size: Measure.Accounts.handleIcon))
      }
      .touchReach(horizontal: Measure.Accounts.handleReachSides, vertical: Measure.Accounts.handleReachAbove)
    }
    .buttonStyle(.plain)
    .accessibilityHint("Open on Bluesky")
  }

  @ViewBuilder
  private func action(name: String) -> some View {
    if account.status == .needsSignIn {
      Button("Sign back in") { AccountCopy.requestReauth(account.did, immediate: true) }
        .buttonStyle(.virga(size: .small))
        .accessibilityLabel("Sign back in as \(name)")
    } else if account.status == .unknown {
      Button("Sign in again") { AccountCopy.requestReauth(account.did, immediate: true) }
        .buttonStyle(.virga(size: .small))
        .accessibilityLabel("Sign in again as \(name)")
        .accessibilityHint("Virga couldn’t confirm this sign-in; signing in again settles it")
    } else if !active {
      Button("Switch") { AccountActions.open(account, session: session) }
        .buttonStyle(.virga(size: .small))
        .disabled(session.switching != nil)
        .accessibilityLabel("Switch to \(name)")
    }
  }

  private var entries: [MenuEntry] {
    let needsSignIn = self.account.status == .needsSignIn
    let model = self.session
    let row = self.account
    var out: [MenuEntry] = []
    if !needsSignIn && AccountCopy.offersLongerSession(accountMode: row.mode, model.authMode) {
      out.append(
        .item(
          MenuItem("Reconnect for a longer session", key: "lengthen", hint: "Sign in again through Virga’s server", systemImage: Glyph.timer) {
            AccountActions.lengthen(row, session: model)
          }))
    }
    let url = profileURL
    let opener = self.openURL
    out.append(.item(MenuItem("Open on Bluesky", key: "bluesky", systemImage: Glyph.externalLink) { if let url { opener(url) } }))
    if !needsSignIn {
      let shell = self.app
      let guarding = self.signOutGuard
      let busy = $busy
      out.append(
        .item(
          MenuItem("Sign out", key: "sign-out", systemImage: Glyph.signOut) {
            guard !busy.wrappedValue, guarding.checking == nil else { return }
            guarding.guardSignOut(row, app: shell) {
              busy.wrappedValue = true
              await model.signOutAccount(row.did)
              busy.wrappedValue = false
            }
          }))
    }
    out.append(.separator)
    out.append(.item(MenuItem("Remove from this browser", key: "remove", systemImage: Glyph.trash, destructive: true, action: onRemove)))
    return out
  }
}

/// Remove an account from this device, and, if asked, what it keeps here.
struct RemoveAccountDialog: ViewModifier {
  @Environment(AppModel.self) private var app
  @Binding var account: SessionAccount?
  @State private var deleteData = false
  @State private var busy = false
  @State private var work: PendingWorkModel?

  func body(content: Content) -> some View {
    let name = account.map { rowName($0) } ?? ""
    return content.virgaDialog(
      isPresented: Binding(get: { account != nil }, set: { if !$0 { account = nil } }), title: "Remove \(name) from this browser"
    ) {
      DialogForm {
        Text("It signs out here. Sign in to add it back.")
          .fixedSize(horizontal: false, vertical: true)
        if let account {
          PendingWorkWarnings(accounts: [account], model: work)
        }
        ChoiceRow(
          "Also delete what it keeps in this browser",
          description:
            "Its archive, dashboards, tool lists, posting settings and unsent drafts’ pictures. Nothing in the account itself is touched.",
          isOn: $deleteData, kind: .check)
      }
    } actions: {
      Button("Cancel") { account = nil }.buttonStyle(.virga)
      Button(busy ? "Removing…" : "Remove") {
        guard let gone = account else { return }
        busy = true
        let session = app.session
        let delete = deleteData
        Task { @MainActor in
          await session.removeAccount(gone.did, deleteData: delete)
          busy = false
          deleteData = false
          account = nil
        }
      }
      .buttonStyle(.virga(.danger))
      .disabled(busy || work?.checking == true)
      .accessibilityIdentifier("remove-account-confirm")
    }
    .onChange(of: account?.did) { _, did in
      work?.stop()
      work = nil
      guard did != nil, let account, let services = app.pendingWork else { return }
      let session = app.session
      let model = PendingWorkModel(backendFor: { [weak session] did in session?.backendFor(did) }, services: services)
      model.update(accounts: [account], enabled: true)
      work = model
    }
  }
}

/// `PostingPermissionNotice({ did, force })`: for a session granted before
/// Virga asked for posting, or a write refused for want of the permission.
public struct PostingPermissionNotice: View {
  @Environment(SessionModel.self) private var session
  private let did: String
  private let force: Bool

  public init(did: String, force: Bool = false) {
    self.did = did
    self.force = force
  }

  public var body: some View {
    let account = session.accounts.first { $0.did.jsEquals(did) }
    if let account, account.status != .needsSignIn, force || !session.capabilitiesFor(did).canPost {
      Callout(tone: .warn) {
        ViewThatFits(in: .horizontal) {
          HStack(spacing: Measure.Accounts.noticeGap) {
            Text(AccountCopy.postingRegrantMessage)
            Spacer(minLength: 0)
            signInAgain
          }
          VStack(alignment: .leading, spacing: Measure.SignIn.rowGap) {
            Text(AccountCopy.postingRegrantMessage)
            signInAgain
          }
        }
      }
    }
  }

  private var signInAgain: some View {
    Button("Sign in again") { AccountCopy.requestReauth(did, immediate: true) }
      .buttonStyle(.virga(size: .small))
  }
}
extension Measure.Accounts {
  /// `.accounts-row > .row-actions { margin-block: -6px -3px }` under a finger.
  static let actionsReachBelow: CGFloat = 3
  /// `.accounts-row > .row-actions { margin-left: 4px }`: with the grid's 12, 16 from the words.
  static let actionsSpaceBefore: CGFloat = 4
  /// `.accounts-row-handle::after { inset: -12px -6px }` under a finger.
  static let handleReachAbove: CGFloat = 12
  static let handleReachSides: CGFloat = 6
}
#endif
