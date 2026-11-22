// Ports src/pages/SignInReturn.jsx
// Ports src/styles/app.css (.landing-narrow, .return-title, .return-code, .app-status)
//
// A sign-in that came back without a session: declined at the consent
// screen, or the return couldn't be matched to the request that started
// it. It says which, and the way out is back into the app, where any
// account already signed in is still open.
//
// AppStatus is the line the app shows while it opens ("Opening Virga…"):
// fading in after half a second, so a quick start shows nothing.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaSession

public struct SignInReturnView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(SessionModel.self) private var session
  private let error: any Error

  public init(error: any Error) {
    self.error = error
  }

  private var detail: String {
    let fields = JSErrorFields(error)
    if let description = fields?.params?["error_description"], !description.isEmpty { return description }
    if let message = fields?.message, !message.isEmpty { return message }
    return String(describing: error)
  }

  public var body: some View {
    ScrollView {
      LandingFrame {
        Button {
          leave()
        } label: {
          Brand()
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(AppConfig.appName), to the front page")
      } main: {
        NarrowColumn {
          Text("Sign-in didn’t complete")
            .virgaText(
              size: theme.points(ThemeKit.returnTitleFontSize), weight: VirgaWeight.semibold, lineHeight: ThemeKit.returnTitleLineHeight,
              tracking: ThemeKit.returnTitleTracking)
            .foregroundStyle(theme.ink)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("return-title")
          Text(OAuthClient.callbackErrorMessage(error))
            .modifier(LandingLede())
          Button(session.session != nil ? "Back to Virga" : "Back to the start") { leave() }
            .buttonStyle(.virga(.primary, size: .large))
          Disclosure("Details") {
            // `.return-code` sets its own size (--text-xs) on the code, in
            // place of base.css's 0.92em.
            Text(detail)
              .font(Font.system(size: theme.scaled(theme.textXs), design: .monospaced))
              .foregroundStyle(theme.muted)
              .textSelection(.enabled)
              .padding(.top, Measure.Landing.codeSpaceAbove)
          }
        }
      }
    }
    .background(PageGround().ignoresSafeArea())
  }

  private func leave() {
    session.clearError()
    navigate("/")
  }
}

/// `.landing-lede`: --text-lg in --ink-2, held to 52ch; --text-md from 560 down.
struct LandingLede: ViewModifier {
  @Environment(\.virgaTheme) private var theme

  func body(content: Content) -> some View {
    let size = theme.isPhone ? theme.textMd : theme.textLg
    content
      .virgaText(theme.isPhone ? .textMd : .textLg, lineHeight: ThemeKit.landingLedeLineHeight)
      .foregroundStyle(theme.ink2)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: theme.points(ThemeKit.landingLedeMaxWidth, inTextOf: size), alignment: .leading)
  }
}

/// `.landing-narrow`: one narrow column, a little way down the sky.
struct NarrowColumn<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  private let gap: CGFloat
  private let content: Content

  init(gap: CGFloat = Measure.Landing.narrowGap, @ViewBuilder content: () -> Content) {
    self.gap = gap
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: gap) {
      content
    }
    .frame(maxWidth: Measure.Landing.narrowMaxWidth, alignment: .leading)
    .frame(maxWidth: .infinity)
    .padding(.top, Measure.Landing.narrowSpaceAbove.of(theme.windowHeight))
    .padding(.bottom, Measure.Landing.mainSpaceBelow)
  }
}

/// `.app-status`: a muted line, centred, two fifths of the way down.
public struct AppStatus: View {
  @Environment(\.virgaTheme) private var theme
  @State private var shown = false
  private let text: String

  public init(_ text: String) {
    self.text = text
  }

  public var body: some View {
    GeometryReader { geometry in
      Text(text)
        .virgaText(.textLg, weight: VirgaWeight.medium)
        .foregroundStyle(theme.muted)
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .offset(y: geometry.size.height * Measure.Landing.statusTopShare)
        .opacity(shown ? 1 : 0)
    }
    // The body's sky (base.css), as every page outside the shell has it.
    .background(alignment: .top) { SkyWash().ignoresSafeArea() }
    .onAppear {
      if let animation = theme.motion.status {
        withAnimation(animation) { shown = true }
      } else {
        shown = true
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("app-status")
  }
}
#endif
