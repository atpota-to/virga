// Ports src/signin/parts.jsx
// Ports src/signin/signin.css (.signin-identity, .signin-bone)
//
// An account, as the sign-in (and the agreement screen) shows it: picture,
// name, and the handle (or DID) under it, one row under a rule in ink and
// over a hairline; `action` at the row's end. And bones in the row's own
// shape, so nothing moves when the account arrives.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaSession

public struct IdentityRow<Action: View>: View {
  @Environment(\.virgaTheme) private var theme
  private let identity: SignInIdentityAnswer
  private let action: Action

  public init(identity: SignInIdentityAnswer, @ViewBuilder action: () -> Action) {
    self.identity = identity
    self.action = action()
  }

  public var body: some View {
    let name = SignInFlow.identityName(identity)
    let meta = SignInFlow.identityMeta(identity)
    IdentityFrame {
      Avatar(src: identity.avatar, name: name, size: .large)
      VStack(alignment: .leading, spacing: Measure.SignIn.identityTextGap) {
        Text(name)
          .virgaText(.textMd, weight: VirgaWeight.medium, lineHeight: Measure.SignIn.titleLineHeight)
          .foregroundStyle(theme.ink)
          .fixedSize(horizontal: false, vertical: true)
        if !meta.isEmpty {
          Text(meta)
            .virgaText(.textSm)
            .foregroundStyle(theme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityElement(children: .combine)
      action
    }
    .transition(.opacity)
  }
}

extension IdentityRow where Action == EmptyView {
  public init(identity: SignInIdentityAnswer) {
    self.init(identity: identity) { EmptyView() }
  }
}

/// The bones: a disc and two bars, pulsing (still under Reduce Motion).
public struct IdentityBones: View {
  @Environment(\.virgaTheme) private var theme
  @State private var dim = false

  public init() {}

  public var body: some View {
    IdentityFrame {
      Circle()
        .fill(theme.tint)
        .frame(width: Measure.SignIn.boneAvatar, height: Measure.SignIn.boneAvatar)
      GeometryReader { geometry in
        VStack(alignment: .leading, spacing: Measure.SignIn.boneMargin * 2) {
          RoundedRectangle(cornerRadius: theme.radiusSm)
            .fill(theme.tint)
            .frame(width: geometry.size.width * Measure.SignIn.boneNameShare, height: Measure.SignIn.boneNameHeight)
          RoundedRectangle(cornerRadius: theme.radiusSm)
            .fill(theme.tint)
            .frame(width: geometry.size.width * Measure.SignIn.boneMetaShare, height: Measure.SignIn.boneMetaHeight)
        }
        .padding(.vertical, Measure.SignIn.boneMargin)
        .frame(maxHeight: .infinity, alignment: .center)
      }
    }
    .opacity(dim ? 0.5 : 1)
    .onAppear {
      guard !theme.reduceMotion else { return }
      withAnimation(.easeInOut(duration: Measure.SignIn.pulseSeconds / 2).repeatForever(autoreverses: true)) { dim = true }
    }
    .accessibilityHidden(true)
  }
}

/// `.signin-identity`: the row's frame, a rule in ink over it and a hairline
/// under it.
struct IdentityFrame<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    HStack(spacing: Measure.SignIn.identityGap) {
      content
    }
    .padding(.vertical, Measure.SignIn.identityPadding)
    .frame(maxWidth: .infinity, minHeight: Measure.SignIn.identityHeight, alignment: .leading)
    .overlay(alignment: .top) { Rectangle().fill(theme.rule).frame(height: 1) }
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}
#endif
