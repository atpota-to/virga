// Ports src/components/Dialog.jsx
// Ports src/shell/shell.css (.dialog, .dialog-head, .dialog-body, .dialog-actions, .dialog-form, .choice)
//
// A dialog: a title (--text-lg, 600), a Close, the content, actions at the
// foot on the right with the confirm in ink. The web draws it as a modal at
// every width (at most 520 wide, --surface with a --line edge, 16-point
// corners and --shadow-lg over --scrim); on iOS it is a sheet, on --surface
// with those corners, and from 560 down its buttons share the foot in equal
// halves, 44 tall. Swiping it down is the web's Escape: it closes.
//
//   .virgaDialog(isPresented: $confirming, title: "Sign out of Mira Okafor") {
//     Callout(…)
//   } actions: {
//     Button("Cancel") { confirming = false }.buttonStyle(.virga)
//     Button("Sign out") { … }.buttonStyle(.virga(.danger))
//   }

#if canImport(UIKit)
import SwiftUI
import VirgaCore

/// How tall a dialog's sheet may be: one that fits a few lines (`.fit`, half
/// the screen to start with), or a long one (`.tall`, the whole height).
public enum DialogSize: Sendable {
  case fit, tall
}

private struct FillsWidthKey: EnvironmentKey {
  static let defaultValue = false
}

extension EnvironmentValues {
  /// Set in a phone's dialog foot: each button takes an equal share of it.
  var virgaFillsWidth: Bool {
    get { self[FillsWidthKey.self] }
    set { self[FillsWidthKey.self] = newValue }
  }
}

/// The dialog itself: head, body, foot.
public struct DialogFrame<Content: View, Actions: View>: View {
  @Environment(\.virgaTheme) private var theme
  private let title: String
  private let onClose: () -> Void
  private let content: Content
  private let actions: Actions
  private let hasActions: Bool

  public init(
    title: String, onClose: @escaping () -> Void, hasActions: Bool = true, @ViewBuilder content: () -> Content,
    @ViewBuilder actions: () -> Actions
  ) {
    self.title = title
    self.onClose = onClose
    self.hasActions = hasActions
    self.content = content()
    self.actions = actions()
  }

  public var body: some View {
    let phone = theme.isPhone
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .center, spacing: theme.space3) {
        Text(title)
          .virgaText(.textLg, weight: VirgaWeight.semibold, lineHeight: ThemeKit.headingLineHeight, tracking: Measure.Dialog.titleTracking)
          .foregroundStyle(theme.ink)
          .accessibilityAddTraits(.isHeader)
          .accessibilityIdentifier("dialog-title")
        Spacer(minLength: 0)
        Button(action: onClose) {
          Image(systemName: Glyph.close)
        }
        .buttonStyle(.virga(.ghost, size: .small, icon: true))
        .accessibilityLabel("Close")
        .accessibilityIdentifier("dialog-close")
      }
      .padding(phone ? Measure.Dialog.phoneHead : Measure.Dialog.head)
      ScrollView {
        content
          .virgaText(.textBase)
          .foregroundStyle(theme.ink2)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(phone ? Measure.Dialog.phoneBody : Measure.Dialog.body)
      }
      .scrollBounceBehavior(.basedOnSize)
      if hasActions {
        HStack(spacing: Measure.Dialog.actionsGap) {
          if !phone { Spacer(minLength: 0) }
          actions
        }
        .environment(\.virgaFillsWidth, phone)
        .padding(phone ? Measure.Dialog.phoneActions : Measure.Dialog.actions)
      }
    }
    .background(theme.surface)
  }
}

struct DialogSheet<Inner: View, Foot: View>: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  @Binding var isPresented: Bool
  let title: String
  let size: DialogSize
  let hasActions: Bool
  let inner: () -> Inner
  let foot: () -> Foot

  func body(content: Content) -> some View {
    content.sheet(isPresented: $isPresented) {
      DialogFrame(title: title, onClose: { isPresented = false }, hasActions: hasActions, content: inner, actions: foot)
        .presentationDetents(size == .fit ? [.medium, .large] : [.large])
        .presentationBackground(theme.surface)
        .presentationCornerRadius(Measure.Dialog.radius)
    }
  }
}

extension View {
  /// A dialog over this view, while `isPresented`.
  public func virgaDialog<Content: View, Actions: View>(
    isPresented: Binding<Bool>,
    title: String,
    size: DialogSize = .fit,
    @ViewBuilder content: @escaping () -> Content,
    @ViewBuilder actions: @escaping () -> Actions
  ) -> some View {
    modifier(DialogSheet(isPresented: isPresented, title: title, size: size, hasActions: true, inner: content, foot: actions))
  }

  /// A dialog with no foot (its content ends it, as Add an account's does).
  public func virgaDialog<Content: View>(
    isPresented: Binding<Bool>,
    title: String,
    size: DialogSize = .fit,
    @ViewBuilder content: @escaping () -> Content
  ) -> some View {
    modifier(
      DialogSheet(isPresented: isPresented, title: title, size: size, hasActions: false, inner: content, foot: { EmptyView() }))
  }
}

/// `.dialog-form`: a dialog's parts, 16 apart.
public struct DialogForm<Content: View>: View {
  private let content: Content

  public init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: Measure.Dialog.formGap) {
      content
    }
  }
}

/// `.choice`: one of a few things to pick (or tick) between, a row between
/// hairlines, marked when on by its box and a rule in the accent down its
/// side: `{ label, desc }` beside a checkbox.
public struct ChoiceRow: View {
  @Environment(\.virgaTheme) private var theme
  private let label: String
  private let description: String?
  @Binding private var isOn: Bool

  public init(_ label: String, description: String? = nil, isOn: Binding<Bool>) {
    self.label = label
    self.description = description
    self._isOn = isOn
  }

  public var body: some View {
    Toggle(isOn: $isOn) {
      VStack(alignment: .leading, spacing: 0) {
        Text(label)
          .virgaText(.textBase, weight: VirgaWeight.semibold)
          .foregroundStyle(theme.ink)
        if let description {
          Text(description)
            .virgaText(.textSm)
            .foregroundStyle(theme.muted)
        }
      }
    }
    .toggleStyle(.virgaCheck)
    .padding(Measure.Dialog.choicePadding)
    .overlay(alignment: .leading) {
      Rectangle().fill(isOn ? theme.accent : Color.clear).frame(width: Measure.Dialog.choiceRule)
    }
    .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}

#Preview("Dialog") {
  VirgaPreviewHost {
    DialogFrame(title: "Sign out of Mira Okafor", onClose: {}) {
      Text("Each account’s session in this browser ends.")
    } actions: {
      Button("Cancel") {}.buttonStyle(.virga)
      Button("Sign out") {}.buttonStyle(.virga(.danger))
    }
  }
}
#endif
