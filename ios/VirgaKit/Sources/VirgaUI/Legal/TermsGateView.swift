// Ports src/legal/TermsGate.jsx
// Ports src/legal/legal.css (.terms-card, .terms-check, .terms-agree)
//
// The agreement screen: shown in the app's place to a signed-in account
// that hasn't agreed to the current Terms of Service and Privacy Policy.
// Nothing of the app is drawn behind it and nothing is read for the account
// until it agrees. The two ways on are agreeing and signing out. The button
// is never greyed out: pressed before the box is ticked, it says what is
// missing. If the agreement can't be recorded the screen stays and says why
// (Acceptance.acceptFailure, never the server's own words).

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaSession

public struct TermsGateView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(SessionModel.self) private var session
  @Environment(TermsAcceptanceModel.self) private var terms
  @Environment(AppModel.self) private var app
  @State private var agreed = false
  @State private var nudge = false
  @State private var busy = false
  @State private var failure: TermsAcceptFailure?
  @State private var reading: String?
  @State private var waited = false
  @State private var leaving = false
  @AccessibilityFocusState private var checkFocused: Bool

  /// How long to wait for the account's name before showing it by its DID.
  static let nameWaitMs: Double = 2_500

  public init() {}

  public var body: some View {
    let profile = app.profile.profile
    let identity = SignInIdentityAnswer(
      did: session.did ?? "", handle: profile?.handle, displayName: profile?.displayName, avatar: profile?.avatar)
    let named = (identity.handle?.isEmpty == false) || (identity.displayName?.isEmpty == false)
    ScrollView {
      LandingFrame {
        Brand().accessibilityHidden(true)
      } main: {
        NarrowColumn(gap: Measure.Legal.termsGap) {
          Text("Before you start")
            .virgaText(
              size: theme.points(ThemeKit.returnTitleFontSize), weight: VirgaWeight.semibold, lineHeight: ThemeKit.returnTitleLineHeight,
              tracking: ThemeKit.returnTitleTracking)
            .foregroundStyle(theme.ink)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("terms-title")
          Group {
            if named || waited {
              IdentityRow(identity: identity) {
                Button {
                  signOut()
                } label: {
                  Label(leaving ? "Signing out…" : "Sign out", systemImage: Glyph.signOut)
                }
                .buttonStyle(.linkAction)
                .disabled(busy || leaving)
              }
            } else {
              IdentityBones()
            }
          }
          .frame(minHeight: Measure.SignIn.identityHeight)
          documents
          Toggle(isOn: $agreed) {
            Text("I’ve read the Terms of Service and the Privacy Policy, and I agree to them.")
              .virgaText(.textBase, weight: VirgaWeight.medium, lineHeight: Measure.Legal.checkLineHeight)
              .foregroundStyle(theme.ink)
              .fixedSize(horizontal: false, vertical: true)
          }
          .toggleStyle(.virgaCheck)
          // The nudge is the box's description while it shows.
          .accessibilityHint(checkHint)
          .accessibilityFocused($checkFocused)
          .accessibilityIdentifier("terms-check")
          .onChange(of: agreed) { _, now in if now { nudge = false } }
          if nudge && !agreed {
            Callout(tone: .warn) { Text("Tick the box to say you agree, then carry on.") }
          }
          if let failure {
            Callout(tone: .danger) { Text(failure.text) }
              .accessibilityIdentifier("terms-failure")
          }
          Button(busy ? "Recording…" : "Agree and continue") { agree() }
            .buttonStyle(.virga(.primary, size: .large))
            .environment(\.virgaFillsWidth, theme.isPhone)
            .disabled(leaving)
            .accessibilityIdentifier("terms-agree")
          NoteText(
            session.mode == "backend"
              ? "\(AppConfig.appName)’s server keeps a record that this account agreed, and when, with the IP address and browser the agreement came from."
              : "\(AppConfig.appName) notes in this browser that this account agreed, and sends its server a report of it, with the IP address and browser the agreement came from."
          )
        }
      }
    }
    .background(PageGround().ignoresSafeArea())
    .legalDialog($reading)
    .task(id: session.did) {
      waited = false
      try? await Task.sleep(nanoseconds: UInt64(Self.nameWaitMs * 1_000_000))
      if !Task.isCancelled { waited = true }
    }
  }

  /// The box's description: the nudge, while it shows.
  private var checkHint: String {
    nudge && !agreed ? "Tick the box to say you agree, then carry on." : ""
  }

  /// The sentence with the two documents in it, each opening in a dialog.
  private var documents: some View {
    let name = AppConfig.appName
    func link(_ title: String, _ key: String) -> AttributedString {
      var link = AttributedString(title)
      link.link = URL(string: "\(Self.documentScheme):\(key)")
      link.underlineStyle = Text.LineStyle.single
      link.font = theme.font(.textBase, weight: VirgaWeight.medium)
      link.foregroundColor = theme.ink
      return link
    }
    let text = AttributedString("Have a look at the ") + link("Terms of Service", "terms") + AttributedString(" and the ")
      + link("Privacy Policy", "privacy")
      + AttributedString(". They say what \(name) does, what it keeps about your account, and what you agree to by using it.")
    return Text(text)
      .modifier(SignInDetail())
      .tint(theme.ink)
      .environment(\.openURL, OpenURLAction { url in
        guard url.scheme == Self.documentScheme else { return .systemAction }
        reading = String(url.absoluteString.dropFirst(Self.documentScheme.count + 1))
        return .handled
      })
      .accessibilityIdentifier("terms-documents")
  }

  /// The links in the sentence open a document in place.
  static let documentScheme = "virga-document"

  private func agree() {
    guard !busy else { return }
    if !agreed {
      nudge = true
      checkFocused = true
      return
    }
    busy = true
    failure = nil
    Task { @MainActor in
      do {
        try await terms.accept()
      } catch {
        let failed = Acceptance.acceptFailure(error)
        failure = failed
        // role="alert": read out as it comes up.
        AccessibilityNotification.Announcement(failed.text).post()
      }
      busy = false
    }
  }

  private func signOut() {
    leaving = true
    Task { @MainActor in
      await session.signOut()
      leaving = false
    }
  }
}
#endif
