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
// lists the accounts this device knows above the field. A compose link kept
// for after the sign-in (`\.signInComposing`, AppRoot's) puts a callout over
// the front page's first card.
//
// VoiceOver hears what the web's live regions say: "Looking you up…" and
// "Found …" as the account is looked up, a notice as it comes up, and
// "Still here?" when the trip is slow. Focus goes with the card: to the
// field on the first card (and in Add an account as it opens), to the way
// on while the account is looked up and found, else to the card's title.

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
  @AccessibilityFocusState private var actionFocused: Bool
  @Environment(\.signInComposing) private var composingLink

  /// - Parameter onSignedIn: told when a trip came back signed in (Add an
  ///   account closes then).
  public init(variant: SignInVariant = .page, remembered: Bool = false, onSignedIn: (() -> Void)? = nil) {
    self.variant = variant
    self.remembered = remembered
    self.onSignedIn = onSignedIn
  }

  private var inDialog: Bool { variant == .dialog }
  private var showRemembered: Bool { remembered && !session.accounts.isEmpty }
  /// The front page's, when a compose link waits for the sign-in.
  private var composing: Bool { composingLink && !inDialog }
  /// FINDING and FOUND are one card: the account takes the bones' place
  /// rather than the whole card changing.
  private var cardKey: SignInStep { flow.step == .finding ? .found : flow.step }

  /// The label's id on the first card, which a phone brings to the page's
  /// top when suggestions come up under the field.
  static let fieldAnchor = "signin-field-label"

  public var body: some View {
    // The card that goes leaves at once, and the next rises in
    // (`signin-step-in`), as the web's keyed card is mounted afresh.
    VStack(alignment: .leading, spacing: Measure.SignIn.flowGap) {
      card
        .modifier(SignInArriving(animation: theme.motion.animation(Measure.SignIn.stepIn), rise: Measure.SignIn.stepRise))
        .id(cardKey)
    }
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
    .onChange(of: flow.step) { _, step in
      moveFocus(step)
      announce(step)
    }
    .onChange(of: flow.notice) { _, notice in
      // A notice raised is read out (role=alert), but for a handle that
      // wasn't found: focus goes back to the field, whose hint it is.
      if let notice, notice.about != "field" { AccessibilityNotification.Announcement(notice.text).post() }
    }
    .onChange(of: flow.leaving?.phase) { _, phase in
      if phase == "stalled" { AccessibilityNotification.Announcement("Still here? \(SignInFlow.stallLabel(flow.leaving))").post() }
    }
    .task {
      // Add an account puts the cursor in the field as it opens.
      if inDialog && flow.step == .entry { fieldFocused = true }
    }
    .onDisappear {
      // Closing it calls everything off: the lookup, the trip (and the
      // system's sheet with it) and the stall's timer.
      lookup?.cancel()
      go = nil
      tripTask?.cancel()
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
    // Going again ("Still here? Open <host>") calls the trip under way off
    // first, and waits for it to end, so it can't clear this one's pending
    // sign-in or leave a second sheet behind.
    let previous = tripTask
    previous?.cancel()
    dispatch(.sent(trip: trip))
    stallTask?.cancel()
    stallTask = Task { @MainActor in
      try? await Task.sleep(nanoseconds: UInt64(SignInFlow.stallMs * 1_000_000))
      if !Task.isCancelled { dispatch(.stalled(trip: trip)) }
    }
    tripTask = Task { @MainActor in
      if let previous { await previous.value }
      if Task.isCancelled { return }
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
  /// was waiting for it. While the account is looked up and found it is on
  /// the way on, so it works the moment the account is found.
  private func moveFocus(_ step: SignInStep) {
    let from = lastStep
    lastStep = step
    if from == .finding && step == .found { return }
    switch step {
    case .entry: fieldFocused = true
    case .finding, .found: actionFocused = true
    case .leaving, .hosts: headingFocused = true
    }
  }

  /// The visually hidden status of "Is this you?": "Looking you up…", then
  /// "Found {name}, {meta}."
  private func announce(_ step: SignInStep) {
    switch step {
    case .finding:
      AccessibilityNotification.Announcement("Looking you up…").post()
    case .found:
      guard let identity = flow.identity else { return }
      let words = [SignInFlow.identityName(identity), SignInFlow.identityMeta(identity)].filter { !$0.isEmpty }
      AccessibilityNotification.Announcement("Found \(words.joined(separator: ", ")).").post()
    default:
      break
    }
  }

  // MARK: The cards

  /// A notice about the handle is the field's own hint; any other is a
  /// callout of its own.
  private var fieldNotice: SignInNotice? {
    guard let notice = flow.notice, notice.about == "field" || notice.about == "address" else { return nil }
    return notice
  }

  /// A lookup or a trip that failed: a callout of its own. "Continue anyway"
  /// ends its sentence, as a link in it.
  @ViewBuilder private var noticeLine: some View {
    if let notice = flow.notice, fieldNotice == nil {
      Callout(tone: .danger) {
        if notice.anyway != nil {
          Text(AttributedString("\(notice.text) ") + SignInInlineLink.words("Continue anyway", action: "anyway", theme: theme, strong: true))
        } else {
          Text(notice.text)
        }
      }
      .environment(\.openURL, OpenURLAction { url in
        guard SignInInlineLink.action(url) == "anyway" else { return .systemAction }
        if let anyway = flow.notice?.anyway { leave(host: nil, purpose: "signin", go: signIn(anyway)) }
        return .handled
      })
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
      if composing {
        Callout {
          Text("Sign in to finish your post. What you were sharing opens in the composer once you’re in.")
        }
        .accessibilityIdentifier("signin-composing")
      }
      if showRemembered {
        RememberedAccounts(
          accounts: session.accounts, opening: opening, onOpen: openRemembered,
          onForget: { account in Task { await session.removeAccount(account.did, deleteData: false) } }
        )
        .padding(.bottom, Measure.SignIn.flowGap)
      }
      FieldLabel(fieldLabel)
        .padding(.bottom, -Measure.SignIn.labelPull)
        .id(Self.fieldAnchor)
        .accessibilityHidden(true)
      // Over what follows it, so the suggestions floating under the field
      // are drawn (and pressed) above the links.
      entryRow.zIndex(1)
      noticeLine
      HStack(alignment: .firstTextBaseline) {
        SignInLink("Make an account") { dispatch(.hosts) }
        Spacer(minLength: Measure.SignIn.linksGap)
        SignInLink("How signing in works") { howOpen = true }
      }
      .frame(minHeight: Measure.SignIn.linksHeight)
    }
  }

  private var fieldLabel: String {
    showRemembered ? "Or sign in with another handle" : inDialog ? "Handle" : "Your handle"
  }

  private var entryRow: some View {
    let field = VStack(alignment: .leading, spacing: 0) {
      HandleField(
        value: $handle, label: fieldLabel, hint: fieldNotice?.text, reveal: Self.fieldAnchor, size: inDialog ? .medium : .large,
        floats: !inDialog, invalid: fieldNotice != nil, disabled: opening != nil,
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
    .zIndex(1)
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
          // It fades in in the bones' place (`signin-identity--arriving`).
          IdentityRow(identity: found)
            .modifier(SignInArriving(animation: theme.motion.animation(Measure.SignIn.identityIn)))
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
            // The whole width on a phone, its words centred in it.
            .multilineTextAlignment(theme.isPhone ? .center : .leading)
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
      .accessibilityFocused($actionFocused)
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
      // Keyed by the host, so a host learned a moment later fades in rather
      // than replacing the words under the reader (`signin-arriving`).
      heading("\(SignInFlow.leavingTitle(leaving))…")
        .modifier(SignInArriving(animation: theme.motion.animation(Measure.SignIn.identityIn)))
        .id(leaving?.host ?? "")
      Text(SignInFlow.leavingDetail(leaving))
        .modifier(SignInDetail())
      if !theme.reduceMotion {
        Wick(waiting: leaving?.phase == "waiting", trip: leaving?.trip ?? 0)
      }
      if leaving?.phase == "stalled", let trip = leaving?.trip {
        // The link sits in the sentence, at the sentence's height.
        Text(AttributedString("Still here? ") + SignInInlineLink.words(SignInFlow.stallLabel(leaving), action: "again", theme: theme))
          .modifier(SignInDetail())
          .tint(theme.ink)
          .environment(\.openURL, OpenURLAction { url in
            guard SignInInlineLink.action(url) == "again" else { return .systemAction }
            depart(trip)
            return .handled
          })
          .accessibilityIdentifier("signin-stalled")
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

/// `.signin-link` in the middle of a sentence ("Continue anyway", "Still
/// here? Open <host>"): a run of the sentence's Text that is a link, at the
/// sentence's height, handled by the sentence's OpenURLAction. In a callout
/// it takes the callout's colour (its tint), at 600.
enum SignInInlineLink {
  static let scheme = "virga-signin"

  @MainActor
  static func words(_ title: String, action: String, theme: VirgaTheme, strong: Bool = false) -> AttributedString {
    var link = AttributedString(title)
    link.link = URL(string: "\(scheme):\(action)")
    link.underlineStyle = Text.LineStyle.single
    link.font = theme.font(.textSm, weight: strong ? VirgaWeight.semibold : VirgaWeight.medium)
    return link
  }

  /// The action a `virga-signin:` address names, or nil for any other.
  static func action(_ url: URL) -> String? {
    guard url.scheme == scheme else { return nil }
    return String(url.absoluteString.dropFirst(scheme.count + 1))
  }
}

/// `.signin-link`: a button that reads as a link (it does something here
/// rather than going somewhere): ink, underlined, small, 500. Under a
/// finger one that stands alone is 36 tall and reaches 4 past it above and
/// below (6 at the sides), to be 44 to press.
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
        .touchReach(horizontal: Measure.SignIn.linkReachSides, vertical: Measure.SignIn.linkReachAbove)
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
  }

  private func row(_ account: SessionAccount) -> some View {
    let name = Accounts.accountName(account)
    let handle = Accounts.accountHandle(account)
    let opened = Accounts.lastOpenedLabel(account.lastUsed, now: Date().timeIntervalSince1970 * 1000)
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
            RememberedMeta(handle: handle, opened: opened)
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
      .accessibilityHint("Forget on this browser (its archive stays)")
      .help("Forget on this browser (its archive stays)")
    }
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}

/// What the web animates as it is mounted (a keyed card, the account as it
/// arrives): drawn faded, `rise` points lower, then brought in by
/// `animation`; at once under Reduce Motion (nil). Keyed by `.id` outside
/// it, so each new one arrives afresh; the one it replaces goes at once.
struct SignInArriving: ViewModifier {
  let animation: Animation?
  var rise: CGFloat = 0
  @State private var arrived = false

  func body(content: Content) -> some View {
    content
      .opacity(arrived ? 1 : 0)
      .offset(y: arrived ? 0 : rise)
      .onAppear {
        if let animation {
          withAnimation(animation) { arrived = true }
        } else {
          arrived = true
        }
      }
  }
}

/// `.remembered-meta`: the handle and when it was last opened, on one meta
/// line with a dot between; a phone never has room for both on one line,
/// so each has its own there, with no dot.
struct RememberedMeta: View {
  @Environment(\.virgaTheme) private var theme
  let handle: String?
  let opened: String?

  var body: some View {
    if theme.isPhone {
      VStack(alignment: .leading, spacing: 0) {
        if let handle { line(handle) }
        if let opened { line(opened) }
      }
    } else {
      let meta = [handle, opened].compactMap { $0 }.map { MetaItem($0) }
      if !meta.isEmpty { MetaLine(meta) }
    }
  }

  private func line(_ text: String) -> some View {
    Text(text)
      .virgaText(.textSm, lineHeight: Measure.Accounts.rememberedMetaLineHeight)
      .foregroundStyle(theme.muted)
  }
}

private struct SignInComposingKey: EnvironmentKey {
  static let defaultValue = false
}

extension EnvironmentValues {
  /// A compose link waits for the sign-in (AppRoot's): the front page's
  /// sign-in says what happens to it.
  var signInComposing: Bool {
    get { self[SignInComposingKey.self] }
    set { self[SignInComposingKey.self] = newValue }
  }
}

extension Measure.SignIn {
  /// `.signin-links .signin-link::after { inset: -4px -6px }` under a finger.
  static let linkReachAbove: CGFloat = 4
  static let linkReachSides: CGFloat = 6
  /// `.signin-card { animation: signin-step-in 0.28s var(--ease) }`
  static let stepIn = ThemeAnimation(name: "signin-step-in", duration: 0.28, easing: .variable(.ease))
  /// `.signin-identity--arriving, .signin-arriving { animation: signin-identity-in 0.32s var(--ease) }`
  static let identityIn = ThemeAnimation(name: "signin-identity-in", duration: 0.32, easing: .variable(.ease))
}

extension Measure.Accounts {
  /// `.meta { line-height: 1.45 }`, each of `.remembered-meta`'s lines on a phone.
  static let rememberedMetaLineHeight: Double = 1.45
}
#endif
