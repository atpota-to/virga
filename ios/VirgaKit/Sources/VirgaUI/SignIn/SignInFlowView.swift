// Ports src/signin/SignInFlow.jsx
// Ports src/signin/signin.css (.signin-flow, .signin-step, .signin-links, .signin-wick, .signin-hosts)
// Ports src/accounts/accounts.css (.remembered)
//
// Signing in, a step at a time: type a handle, see the account it belongs
// to and where that account signs in, then go there. Or make an account, on
// a host chosen from a short list. The steps and their words are
// VirgaSession's SignInFlow (the web's flow.js reducer); this holds the
// timers, the lookups and the page.
//
// On iOS "going there" is the session's sign-in, which opens the host's
// page in ASWebAuthenticationSession and comes back here signed in: the
// leaving card says where it is going for a moment first, long enough to
// read and to turn back, and Cancel calls the trip off (the sheet too).
//
// `variant` is .page (the front page, on the sky under the lede) or .dialog
// (Add an account, which brings its own title and frame). `remembered`
// lists the accounts this device knows above the field.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaSession

public enum SignInVariant: Sendable {
  case page, dialog
}

public struct SignInFlowView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(SessionModel.self) private var session
  @Environment(AppModel.self) private var app
  private let variant: SignInVariant
  private let remembered: Bool
  private let onSignedIn: (() -> Void)?

  @State private var flow = SignInFlow.initialFlow()
  @State private var handle = ""
  @State private var opening: String?
  @State private var howOpen = false
  @State private var lookup: Task<Void, Never>?
  /// What sends the app on, for the trip the leaving card is showing.
  @State private var go: (@MainActor () async throws -> Void)?
  @State private var tripTask: Task<Void, Never>?
  @State private var stallTask: Task<Void, Never>?
  @State private var lastStep: SignInStep = .entry
  @FocusState private var fieldFocused: Bool
  @AccessibilityFocusState private var headingFocused: Bool

  /// - Parameter onSignedIn: told when a trip came back signed in (Add an
  ///   account closes then).
  public init(variant: SignInVariant = .page, remembered: Bool = false, onSignedIn: (() -> Void)? = nil) {
    self.variant = variant
    self.remembered = remembered
    self.onSignedIn = onSignedIn
  }

  private var inDialog: Bool { variant == .dialog }
  private var showRemembered: Bool { remembered && !session.accounts.isEmpty }

  public var body: some View {
    VStack(alignment: .leading, spacing: Measure.SignIn.flowGap) {
      card
        .id(flow.step == .finding ? SignInStep.found : flow.step)
        .transition(.opacity.combined(with: .offset(y: Measure.SignIn.stepRise)))
    }
    .animation(theme.motion.sheet, value: flow.step == .finding ? SignInStep.found : flow.step)
    .virgaDialog(isPresented: $howOpen, title: "How signing in works", size: .tall) {
      HowSigningInWorks(longSession: session.authMode == "backend")
    }
    .task(id: flow.step == .leaving ? flow.leaving?.trip : nil) {
      // The card is on view for a moment before the app goes.
      guard flow.step == .leaving, let trip = flow.leaving?.trip else { return }
      try? await Task.sleep(nanoseconds: UInt64(SignInFlow.leaveDelayMs * 1_000_000))
      if Task.isCancelled { return }
      depart(trip)
    }
    .onChange(of: flow.step) { _, step in moveFocus(step) }
    .onDisappear {
      lookup?.cancel()
      stallTask?.cancel()
    }
  }

  private func dispatch(_ event: SignInFlowEvent) {
    flow = SignInFlow.flowReducer(flow, event)
  }

  // MARK: Leaving

  private func leave(host: String?, purpose: String, go: @escaping @MainActor () async throws -> Void) {
    tripTask?.cancel()
    self.go = go
    dispatch(.leave(host: host, purpose: purpose))
  }

  private func depart(_ trip: Int) {
    guard let go else { return }
    dispatch(.sent(trip: trip))
    stallTask?.cancel()
    stallTask = Task { @MainActor in
      try? await Task.sleep(nanoseconds: UInt64(SignInFlow.stallMs * 1_000_000))
      if !Task.isCancelled { dispatch(.stalled(trip: trip)) }
    }
    tripTask = Task { @MainActor in
      do {
        try await go()
        stallTask?.cancel()
        if Task.isCancelled { return }
        onSignedIn?()
        dispatch(.cancel)
      } catch {
        // Called off: the card has gone back already, and there is nothing to say.
        if Task.isCancelled { return }
        stallTask?.cancel()
        dispatch(.tripFailed(trip: trip, notice: SignInFlow.tripFailureNotice(error, flow.leaving)))
      }
    }
  }

  private func cancelLeaving() {
    go = nil
    tripTask?.cancel()
    stallTask?.cancel()
    dispatch(.cancel)
  }

  // MARK: The steps

  private func signIn(_ input: String, intent: String = "add", mode: String? = nil, did: String? = nil) -> @MainActor () async throws -> Void {
    let session = self.session
    let options = SignInOptions(mode: mode ?? session.authMode, intent: intent, did: did)
    return { try await session.signIn(input, options) }
  }

  /// `picked` is a suggestion taken from under the field: looked up at once.
  private func find(_ picked: String? = nil) {
    guard flow.step == .entry, opening == nil else { return }
    let value = SignInIdentity.normalizeSignInInput(picked ?? handle)
    let kind = SignInIdentity.classifySignInInput(value)
    // The button is never greyed out; pressed with nothing typed, it sends
    // the reader to the field.
    if kind == "empty" {
      fieldFocused = true
      return
    }
    if !value.jsEquals(handle) { handle = value }
    if kind == "url" {
      guard let host = SignInIdentity.hostnameOf(value) else {
        dispatch(
          .notice(
            SignInNotice(about: "address", text: "That address isn’t one Virga can read. Type your handle (it looks like you.bsky.social).")))
        return
      }
      leave(host: host, purpose: "signin", go: signIn(value))
      return
    }
    lookup?.cancel()
    dispatch(.find)
    let started = Date()
    let lookups = app.lookups
    lookup = Task { @MainActor in
      func settle() async {
        let left = SignInFlow.findingMinMs / 1000 - Date().timeIntervalSince(started)
        if left > 0 { try? await Task.sleep(nanoseconds: UInt64(left * 1_000_000_000)) }
      }
      do {
        let found = try await lookups.identity(value)
        await settle()
        if !Task.isCancelled { dispatch(.found(found)) }
      } catch {
        if Task.isCancelled || error is CancellationError { return }
        await settle()
        if Task.isCancelled { return }
        let notice = error is IdentityNotFoundError ? SignInFlow.notFoundNotice(value) : SignInFlow.lookupFailedNotice(value)
        dispatch(.lookupFailed(notice))
      }
    }
  }

  private func notMe() {
    lookup?.cancel()
    dispatch(.notMe)
  }

  private func continueAs(_ who: SignInIdentityAnswer) {
    let id = (who.handle?.isEmpty == false ? who.handle : nil) ?? who.did
    leave(host: who.host, purpose: "signin", go: signIn(id))
  }

  private func chooseHost(_ host: SignupHost) {
    let session = self.session
    let options = SignInOptions(mode: session.authMode)
    leave(host: host.domain, purpose: "signup") {
      try await SignInHosts.signUpAt({ input, opts in try await session.signIn(input, opts) }, host.url, options: options)
    }
  }

  private func openRemembered(_ account: SessionAccount) {
    guard opening == nil, flow.step == .entry else { return }
    dispatch(.notice(nil))
    let again = signIn(
      Accounts.accountSignInId(account), intent: "reauth", mode: AccountCopy.reauthModeFor(accountMode: account.mode, session.authMode),
      did: account.did)
    let lookups = app.lookups
    func stepOut() {
      opening = nil
      let next = flow.trips + 1
      leave(host: nil, purpose: "signin", go: again)
      // The card comes up at once; the host's name joins it when it's known.
      Task { @MainActor in
        if let known = try? await lookups.host(account.did) { dispatch(.hostKnown(trip: next, host: known.host)) }
      }
    }
    if account.status == .needsSignIn {
      stepOut()
      return
    }
    opening = account.did
    Task { @MainActor in
      do {
        // An account whose session holds opens in place; one that turns out
        // to have ended signs in again.
        try await session.switchAccount(account.did)
        opening = nil
      } catch {
        if Accounts.isReauthRequiredError(error) {
          stepOut()
          return
        }
        opening = nil
        dispatch(.notice(SignInNotice(about: "trip", text: OAuthClient.signInErrorMessage(error))))
      }
    }
  }

  /// Focus goes with the card, so a keyboard and VoiceOver follow it; not
  /// on the first card, and not when the account arrives on the card that
  /// was waiting for it.
  private func moveFocus(_ step: SignInStep) {
    let from = lastStep
    lastStep = step
    if from == .finding && step == .found { return }
    if step == .entry {
      fieldFocused = true
    } else {
      headingFocused = true
    }
  }

  // MARK: The cards

  /// A notice about the handle is the field's own hint; any other is a
  /// callout of its own.
  private var fieldNotice: SignInNotice? {
    guard let notice = flow.notice, notice.about == "field" || notice.about == "address" else { return nil }
    return notice
  }

  @ViewBuilder private var noticeLine: some View {
    if let notice = flow.notice, fieldNotice == nil {
      Callout(tone: .danger) {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
          Text(notice.text)
          if let anyway = notice.anyway {
            Text(" ")
            SignInLink("Continue anyway", strong: true) {
              leave(host: nil, purpose: "signin", go: signIn(anyway))
            }
          }
        }
      }
      .accessibilityIdentifier("signin-notice")
    }
  }

  @ViewBuilder private var card: some View {
    switch flow.step {
    case .entry: entry
    case .finding, .found: finding
    case .leaving: leaving
    case .hosts: hosts
    }
  }

  private var entry: some View {
    VStack(alignment: .leading, spacing: Measure.SignIn.stepGap) {
      if showRemembered {
        RememberedAccounts(
          accounts: session.accounts, opening: opening, onOpen: openRemembered,
          onForget: { account in Task { await session.removeAccount(account.did, deleteData: false) } }
        )
        .padding(.bottom, Measure.SignIn.flowGap)
      }
      FieldLabel(showRemembered ? "Or sign in with another handle" : inDialog ? "Handle" : "Your handle")
        .padding(.bottom, -Measure.SignIn.labelPull)
      entryRow
      noticeLine
      HStack(alignment: .firstTextBaseline) {
        SignInLink("Make an account") { dispatch(.hosts) }
        Spacer(minLength: Measure.SignIn.linksGap)
        SignInLink("How signing in works") { howOpen = true }
      }
      .frame(minHeight: Measure.SignIn.linksHeight)
    }
  }

  private var entryRow: some View {
    let field = VStack(alignment: .leading, spacing: 0) {
      HandleField(
        value: $handle, size: inDialog ? .medium : .large, floats: !inDialog, invalid: fieldNotice != nil, disabled: opening != nil,
        focus: $fieldFocused, onEdit: { dispatch(.typed) },
        onPick: { picked in
          handle = picked
          find(picked)
        },
        onSubmit: { find() })
      if let notice = fieldNotice {
        Text(notice.text)
          .virgaText(.textSm)
          .foregroundStyle(theme.danger)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, Measure.SignIn.errorSpaceAbove)
          .accessibilityIdentifier("signin-field-error")
      }
    }
    let button = Button("Sign in") { find() }
      .buttonStyle(.virga(.primary, size: inDialog ? .medium : .large))
      .disabled(opening != nil)
      .accessibilityIdentifier("signin-submit")
    return Group {
      if theme.isPhone {
        VStack(alignment: .leading, spacing: Measure.SignIn.rowGap) {
          field
          button.environment(\.virgaFillsWidth, true)
        }
      } else {
        HStack(alignment: .top, spacing: Measure.SignIn.rowGap) {
          field
          button
        }
      }
    }
  }

  private var finding: some View {
    let found = flow.step == .found ? flow.identity : nil
    return VStack(alignment: .leading, spacing: Measure.SignIn.stepGap) {
      heading("Is this you?")
      Group {
        if let found {
          IdentityRow(identity: found)
        } else {
          IdentityBones()
        }
      }
      .frame(minHeight: Measure.SignIn.identityHeight)
      if let found {
        Group {
          if let host = found.host, !host.isEmpty {
            Text("Your account lives at ") + Text(host).font(theme.font(.textBase, weight: VirgaWeight.semibold)).foregroundStyle(theme.ink)
              + Text(", so that’s where you sign in.")
          } else {
            Text("Virga couldn’t tell where this account lives. Its host is found when you continue.")
          }
        }
        .modifier(SignInDetail())
      }
      noticeLine
      Button {
        if let found { continueAs(found) }
      } label: {
        HStack(spacing: theme.points(ThemeKit.buttonGap)) {
          Text(found.map { SignInFlow.continueLabel($0) } ?? "Looking you up…")
            .lineLimit(nil)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
          if found != nil {
            Image(systemName: Glyph.externalLink)
          }
        }
        .padding(.vertical, Measure.SignIn.actionPaddingBlock)
      }
      .buttonStyle(.virga(.primary, size: .large))
      .environment(\.virgaFillsWidth, theme.isPhone)
      .opacity(found == nil ? Measure.SignIn.waitingOpacity : 1)
      .accessibilityIdentifier("signin-continue")
      HStack(alignment: .firstTextBaseline) {
        SignInLink("Not you?") { notMe() }
        Spacer(minLength: Measure.SignIn.linksGap)
        if inDialog { aside("\(AppConfig.appName) never sees your password.") }
      }
      .frame(minHeight: Measure.SignIn.linksHeight)
    }
  }

  private var leaving: some View {
    let leaving = flow.leaving
    return VStack(alignment: .leading, spacing: Measure.SignIn.stepGap) {
      heading("\(SignInFlow.leavingTitle(leaving))…")
      Text(SignInFlow.leavingDetail(leaving))
        .modifier(SignInDetail())
      if !theme.reduceMotion {
        Wick(waiting: leaving?.phase == "waiting", trip: leaving?.trip ?? 0)
      }
      if leaving?.phase == "stalled", let trip = leaving?.trip {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
          Text("Still here? ")
          SignInLink(SignInFlow.stallLabel(leaving)) { depart(trip) }
        }
        .modifier(SignInDetail())
      }
      HStack(alignment: .firstTextBaseline) {
        SignInLink("Cancel") { cancelLeaving() }
        Spacer(minLength: Measure.SignIn.linksGap)
        if inDialog { aside("\(AppConfig.appName) never sees your password.") }
      }
      .frame(minHeight: Measure.SignIn.linksHeight)
    }
  }

  private var hosts: some View {
    VStack(alignment: .leading, spacing: Measure.SignIn.stepGap) {
      heading("Where should your account live?")
      Text(
        "Your handle and your posts live with a host you choose. You make the account on their page, then come straight back here, signed in."
      )
      .modifier(SignInDetail())
      noticeLine
      VStack(spacing: 0) {
        ForEach(SignInHosts.signupHosts) { host in
          HostRow(host: host) { chooseHost(host) }
        }
      }
      .overlay(alignment: .top) { Rectangle().fill(theme.rule).frame(height: 1) }
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Hosts")
      HStack(alignment: .firstTextBaseline) {
        SignInLink("I already have an account") { dispatch(.hostsBack) }
        Spacer(minLength: Measure.SignIn.linksGap)
        aside("You can move to another host later.")
      }
      .frame(minHeight: Measure.SignIn.linksHeight)
    }
  }

  private func heading(_ text: String) -> some View {
    Text(text)
      .virgaText(.textMd, weight: VirgaWeight.semibold, lineHeight: Measure.SignIn.titleLineHeight, tracking: Measure.SignIn.titleTracking)
      .foregroundStyle(theme.ink)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.isHeader)
      .accessibilityFocused($headingFocused)
      .accessibilityIdentifier("signin-title")
  }

  private func aside(_ text: String) -> some View {
    Text(text)
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
      .multilineTextAlignment(.trailing)
  }
}

/// `.signin-detail`: --ink-2, --text-base, line 1.5, at most 60ch.
struct SignInDetail: ViewModifier {
  @Environment(\.virgaTheme) private var theme

  func body(content: Content) -> some View {
    content
      .virgaText(.textBase, lineHeight: Measure.SignIn.detailLineHeight)
      .foregroundStyle(theme.ink2)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: theme.characters(Measure.SignIn.detailMeasure, size: theme.textBase), alignment: .leading)
  }
}

/// `.signin-link`: a button that reads as a link (it does something here
/// rather than going somewhere): ink, underlined, small, 500.
struct SignInLink: View {
  @Environment(\.virgaTheme) private var theme
  let title: String
  let strong: Bool
  let action: () -> Void

  init(_ title: String, strong: Bool = false, action: @escaping () -> Void) {
    self.title = title
    self.strong = strong
    self.action = action
  }

  var body: some View {
    Button(action: action) {
      label
        .frame(minHeight: Measure.SignIn.linkHeight)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm))
  }

  /// In a callout a link takes the callout's colour, at 600.
  @ViewBuilder private var label: some View {
    if strong {
      Text(title).virgaText(.textSm, weight: VirgaWeight.semibold).underline()
    } else {
      Text(title).virgaText(.textSm, weight: VirgaWeight.medium).underline().foregroundStyle(theme.ink)
    }
  }
}

/// `.signin-wick`: fills over the wait before the app goes, then breathes
/// while the host's page loads.
struct Wick: View {
  @Environment(\.virgaTheme) private var theme
  let waiting: Bool
  let trip: Int
  @State private var filled = false
  @State private var dim = false

  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .leading) {
        Rectangle().fill(theme.line)
        Rectangle()
          .fill(theme.accent)
          .frame(width: waiting ? (filled ? geometry.size.width : 0) : geometry.size.width)
          .opacity(dim ? 0.5 : 1)
      }
    }
    .frame(maxWidth: Measure.SignIn.wickMaxWidth)
    .frame(height: Measure.SignIn.wickHeight)
    .clipShape(RoundedRectangle(cornerRadius: Measure.SignIn.wickHeight / 2))
    .onAppear {
      withAnimation(.linear(duration: SignInFlow.leaveDelayMs / 1000)) { filled = true }
    }
    .onChange(of: waiting) { _, now in
      guard !now else { return }
      withAnimation(.easeInOut(duration: Measure.SignIn.wickPulseSeconds / 2).repeatForever(autoreverses: true)) { dim = true }
    }
    .accessibilityHidden(true)
  }
}

/// A host to make an account on: its name (and the note on the one most
/// people start at), its domain and where it keeps its accounts' data.
struct HostRow: View {
  @Environment(\.virgaTheme) private var theme
  let host: SignupHost
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: Measure.SignIn.hostGap) {
        VStack(alignment: .leading, spacing: Measure.SignIn.identityTextGap) {
          (Text(host.name)
            + (host.recommended ? Text(" ") + Text("· most people start here").font(theme.font(.textSm)).foregroundStyle(theme.muted) : Text("")))
            .virgaText(.textMd, weight: VirgaWeight.medium)
            .foregroundStyle(theme.ink)
          Text("\(host.domain) · \(host.region)")
            .virgaText(.textSm)
            .foregroundStyle(theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        Image(systemName: Glyph.externalLink)
          .font(.system(size: Measure.SignIn.hostIcon))
          .foregroundStyle(theme.muted)
      }
      .padding(.vertical, Measure.SignIn.hostPadding)
      .frame(minHeight: Measure.SignIn.hostHeight)
      .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm), placement: .inside)
    .accessibilityIdentifier("signin-host-\(host.id)")
  }
}

/// "Continue as": the accounts this device remembers, to come back to
/// without typing a handle. One whose sign-in still holds opens at once;
/// the rest sign in again.
struct RememberedAccounts: View {
  @Environment(\.virgaTheme) private var theme
  let accounts: [SessionAccount]
  let opening: String?
  let onOpen: (SessionAccount) -> Void
  let onForget: (SessionAccount) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: Measure.Accounts.rememberedGap) {
      Text("Continue as")
        .virgaText(.textMd, weight: VirgaWeight.semibold, lineHeight: Measure.SignIn.titleLineHeight, tracking: Measure.SignIn.titleTracking)
        .foregroundStyle(theme.ink)
        .accessibilityAddTraits(.isHeader)
      VStack(spacing: 0) {
        ForEach(accounts, id: \.did) { account in
          row(account)
        }
      }
      .overlay(alignment: .top) { Rectangle().fill(theme.rule).frame(height: 1) }
    }
    .padding(.bottom, theme.space4)
  }

  private func row(_ account: SessionAccount) -> some View {
    let name = Accounts.accountName(account)
    let handle = Accounts.accountHandle(account)
    let opened = Accounts.lastOpenedLabel(account.lastUsed, now: Date().timeIntervalSince1970 * 1000)
    var meta: [MetaItem] = []
    if let handle { meta.append(MetaItem(handle)) }
    if let opened { meta.append(MetaItem(opened)) }
    let busy = opening != nil
    return HStack(spacing: Measure.Accounts.rememberedRowGap) {
      Button {
        onOpen(account)
      } label: {
        HStack(spacing: Measure.Accounts.rememberedOpenGap) {
          Avatar(src: account.avatar, name: name, size: .large)
          VStack(alignment: .leading, spacing: Measure.Accounts.rememberedTextGap) {
            Text(opening.jsEquals(account.did) ? "Opening…" : name)
              .virgaText(.textMd, weight: VirgaWeight.medium, lineHeight: Measure.Accounts.rememberedLineHeight)
              .foregroundStyle(theme.ink)
            if !meta.isEmpty {
              MetaLine(meta)
            }
          }
          Spacer(minLength: 0)
          Image(systemName: Glyph.chevronRight)
            .font(.system(size: Measure.Accounts.rememberedChevron))
            .foregroundStyle(theme.muted)
        }
        .padding(.vertical, Measure.Accounts.rememberedPadding)
        .frame(minHeight: Measure.Accounts.rememberedHeight)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .disabled(busy)
      .opacity(busy ? Measure.Accounts.disabledOpacity : 1)
      .accessibilityLabel("Continue as \(name)")
      .accessibilityIdentifier("remembered-\(account.did)")
      Button {
        onForget(account)
      } label: {
        Image(systemName: Glyph.close)
      }
      .buttonStyle(.virga(.ghost, size: .small, icon: true))
      .disabled(busy)
      .accessibilityLabel("Forget \(name) on this browser")
    }
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}
#endif
