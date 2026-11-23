// Ports src/signin/HowSigningInWorks.jsx
// Ports src/signin/signin.css (.signin-how)
//
// What happens when you sign in, for someone who hasn't met this kind of
// sign-in: the password goes to the account's own host and stops there;
// Virga gets a pass. What the pass lets Virga do, in a line each, and what
// it can't: the same things as Settings › Permissions, said shorter, none
// left out.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

enum HowSigningInWorksCopy {
  static let can = [
    "Read your follower list and your notifications",
    "Follow or unfollow, when you press the button",
    "Post, reply and delete posts, and set who can reply or quote, when you ask it to",
    "Upload the pictures and video in your posts",
    "Keep your drafts and post templates",
    "Read your saved posts and reply settings, and search posts, for the composer",
  ]

  static let cannot = [
    "See your password", "Like, repost or read your messages", "Change your handle, email or profile", "Delete your account",
  ]
}

/// The dialog's body (its frame is the caller's `.virgaDialog`).
struct HowSigningInWorks: View {
  @Environment(\.virgaTheme) private var theme
  let longSession: Bool

  var body: some View {
    let name = AppConfig.appName
    VStack(alignment: .leading, spacing: Measure.SignIn.howGap) {
      Text("It works like “Sign in with Google”: the same open standard, with your account’s host where Google would be.")
      flow(name)
      Text(
        "You type your password on your host’s own page, and it stays there. \(name) gets a pass that you approve on that page, for the things listed here and nothing else."
      )
      asks(name)
      NoteText(
        (longSession
          ? "\(name)’s server keeps the pass, so you stay signed in for longer and scheduled posts can go out while this browser is closed. Signing out of the last browser you use it in ends it."
          : "The pass is kept in this browser. Signing out ends it.") + " Your posts and everything else in your account stay with your host.")
    }
    .fixedSize(horizontal: false, vertical: true)
  }

  private func flow(_ name: String) -> some View {
    HStack(alignment: .top, spacing: Measure.SignIn.howFlowGap) {
      stop(glyph: AnyView(Image(systemName: Glyph.person).font(.system(size: Measure.SignIn.howGlyphIcon))), label: "You", edge: true)
      link(Glyph.key)
      stop(glyph: AnyView(Image(systemName: Glyph.server).font(.system(size: Measure.SignIn.howGlyphIcon))), label: "Your host", edge: true)
      link(Glyph.ticket)
      stop(glyph: AnyView(LogoMark()), label: name, edge: false)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, Measure.SignIn.howFlowPadding)
    .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Your password goes only to your host. Your host gives \(name) a pass, which you approve.")
  }

  private func stop(glyph: AnyView, label: String, edge: Bool) -> some View {
    VStack(spacing: Measure.SignIn.howFlowGap) {
      glyph
        .foregroundStyle(theme.ink)
        .frame(width: Measure.SignIn.howGlyph, height: Measure.SignIn.howGlyph)
        .overlay(Circle().strokeBorder(edge ? theme.line2 : Color.clear, lineWidth: 1))
      Text(label)
        .virgaText(.textSm, weight: VirgaWeight.semibold)
        .foregroundStyle(theme.ink)
        .multilineTextAlignment(.center)
    }
    .frame(maxWidth: Measure.SignIn.howStopWidth)
  }

  private func link(_ systemImage: String) -> some View {
    ZStack {
      Line()
        .stroke(theme.line2, style: StrokeStyle(lineWidth: 1, dash: [Measure.SignIn.howDash, Measure.SignIn.howDash]))
        .frame(height: 1)
      Image(systemName: systemImage)
        .font(.system(size: Measure.SignIn.howLinkIcon))
        .foregroundStyle(theme.ink2)
        .padding(Measure.SignIn.howLinkIconPadding)
        .background(Circle().fill(theme.surface))
    }
    .frame(maxWidth: Measure.SignIn.howLinkWidth)
    .frame(height: Measure.SignIn.howGlyph)
  }

  private func asks(_ name: String) -> some View {
    ViewThatFits(in: .horizontal) {
      HStack(alignment: .top, spacing: Measure.SignIn.asksGap) {
        list("\(name) can", HowSigningInWorksCopy.can, Glyph.check)
        list("It can’t", HowSigningInWorksCopy.cannot, Glyph.close)
      }
      VStack(alignment: .leading, spacing: Measure.SignIn.howGap) {
        list("\(name) can", HowSigningInWorksCopy.can, Glyph.check)
        list("It can’t", HowSigningInWorksCopy.cannot, Glyph.close)
      }
    }
  }

  private func list(_ title: String, _ lines: [String], _ glyph: String) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(title)
        // `.signin-how-asks h3`: the heading's 1.25.
        .virgaText(.textBase, weight: VirgaWeight.semibold, lineHeight: ThemeKit.headingLineHeight)
        .foregroundStyle(theme.ink)
        .padding(.bottom, Measure.SignIn.asksHeadSpace)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.rule).frame(height: 1) }
        .padding(.bottom, Measure.SignIn.asksHeadSpace)
        .accessibilityAddTraits(.isHeader)
      VStack(alignment: .leading, spacing: Measure.SignIn.asksListGap) {
        ForEach(lines, id: \.self) { line in
          HStack(alignment: .firstTextBaseline, spacing: Measure.SignIn.asksItemGap) {
            Image(systemName: glyph)
              .font(.system(size: Measure.SignIn.asksIcon))
              .foregroundStyle(theme.ink2)
              .accessibilityHidden(true)
            Text(line)
              .virgaText(.textSm, lineHeight: Measure.SignIn.asksLineHeight)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
      }
    }
    .frame(minWidth: Measure.SignIn.asksMinWidth, maxWidth: .infinity, alignment: .leading)
  }
}

/// A straight line across its frame, for a dashed rule.
struct Line: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    path.move(to: CGPoint(x: rect.minX, y: rect.midY))
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
    return path
  }
}
#endif
