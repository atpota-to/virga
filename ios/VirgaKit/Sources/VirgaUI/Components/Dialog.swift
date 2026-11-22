// Ports src/components/Dialog.jsx
// Ports src/shell/shell.css (.dialog, .dialog-head, .dialog-body, .dialog-actions, .dialog-form, .choice)
//
// A dialog: a title (--text-lg, 600), a Close, the content, actions at the
// foot on the right with the confirm in ink. The web draws it as a modal at
// every width (at most 520 wide, --surface with a --line edge, 16-point
// corners and --shadow-lg over --scrim); on iOS it is a sheet, on --surface
// with those corners: wider than a phone 520 wide and as tall as what's in
// it, as the web's is (DialogSheetSizing), and on a phone rising from the
// foot. From 560 down its buttons share the foot in equal halves, 44 tall,
// or, for a dialog whose buttons say too much to share a line
// (`stackActions`, `.dialog--stack-actions`), go one under the other, the
// one that does it first. Swiping it down is the web's Escape: it
// closes. A dialog built with `autofocus: true` focuses, when it opens,
// the field inside it marked `.dialogAutofocus()` (the web's
// `[data-autofocus]`); the focus is the dialog's own, inside its sheet.
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

/// How tall a dialog's sheet may be on a phone: one that fits a few lines
/// (`.fit`, half the screen to start with), or a long one (`.tall`, the
/// whole height). Wider, either is as tall as what's in it.
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
  private let stackActions: Bool
  private let autofocus: Bool
  /// The marked field's focus, held here, inside the sheet, where the
  /// field is.
  @FocusState private var autofocused: Bool

  /// - Parameters:
  ///   - stackActions: on a phone, the buttons one under the other, each
  ///     the full width and 44 tall, the last given (the confirm) first.
  ///   - autofocus: whether the field in `content` marked
  ///     `.dialogAutofocus()` takes focus when the dialog appears.
  public init(
    title: String, onClose: @escaping () -> Void, hasActions: Bool = true, stackActions: Bool = false,
    autofocus: Bool = false, @ViewBuilder content: () -> Content, @ViewBuilder actions: () -> Actions
  ) {
    self.title = title
    self.onClose = onClose
    self.hasActions = hasActions
    self.stackActions = stackActions
    self.autofocus = autofocus
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
        foot(phone: phone)
          .environment(\.virgaFillsWidth, phone)
          .padding(phone ? Measure.Dialog.phoneActions : Measure.Dialog.actions)
      }
    }
    .background(theme.surface)
    // The field (or the button) marked `.dialogAutofocus()`, in the body or
    // the foot.
    .environment(\.virgaDialogAutofocus, autofocus ? $autofocused : nil)
    .onAppear {
      if autofocus { autofocused = true }
    }
  }

  @ViewBuilder private func foot(phone: Bool) -> some View {
    if phone && stackActions {
      StackedActions(spacing: Measure.Dialog.actionsGap) {
        actions
      }
    } else {
      HStack(spacing: Measure.Dialog.actionsGap) {
        if !phone { Spacer(minLength: 0) }
        actions
      }
    }
  }
}

private struct DialogAutofocusKey: EnvironmentKey {
  static let defaultValue: FocusState<Bool>.Binding? = nil
}

extension EnvironmentValues {
  /// Set by a dialog built with `autofocus: true`: the focus its marked
  /// field binds to.
  var virgaDialogAutofocus: FocusState<Bool>.Binding? {
    get { self[DialogAutofocusKey.self] }
    set { self[DialogAutofocusKey.self] = newValue }
  }
}

/// Binds a field to its dialog's focus, when the dialog has one.
struct DialogAutofocus: ViewModifier {
  @Environment(\.virgaDialogAutofocus) private var focus

  func body(content: Content) -> some View {
    if let focus {
      content.focused(focus)
    } else {
      content
    }
  }
}

extension View {
  /// `[data-autofocus]`: the field a dialog opens on. It takes focus when a
  /// dialog built with `autofocus: true` appears; anywhere else it does
  /// nothing.
  public func dialogAutofocus() -> some View {
    modifier(DialogAutofocus())
  }
}

/// `.dialog--stack-actions .dialog-actions`: one under the other, each the
/// foot's width, the one that does it (a dialog's last, its confirm) first.
struct StackedActions: Layout {
  var spacing: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? subviews.map { $0.sizeThatFits(.unspecified).width }.max() ?? 0
    let heights = subviews.map { $0.sizeThatFits(ProposedViewSize(width: width, height: nil)).height }
    return CGSize(width: width, height: heights.reduce(0, +) + spacing * CGFloat(max(0, subviews.count - 1)))
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for subview in subviews.reversed() {
      let height = subview.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil)).height
      subview.place(at: CGPoint(x: bounds.minX, y: y), proposal: ProposedViewSize(width: bounds.width, height: height))
      y += height + spacing
    }
  }
}

struct DialogSheet<Inner: View, Foot: View>: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  @Binding var isPresented: Bool
  let title: String
  let size: DialogSize
  let hasActions: Bool
  var stackActions = false
  var autofocus = false
  let inner: () -> Inner
  let foot: () -> Foot

  func body(content: Content) -> some View {
    content.sheet(isPresented: $isPresented) {
      DialogFrame(
        title: title, onClose: { isPresented = false }, hasActions: hasActions, stackActions: stackActions, autofocus: autofocus,
        content: inner, actions: foot)
        .dialogSheetSizing(phone: theme.isPhone, detents: size == .fit ? [.medium, .large] : [.large])
        .presentationBackground(theme.surface)
        .presentationCornerRadius(Measure.Dialog.radius)
    }
  }
}

/// How a dialog's sheet is sized. On a phone it rises from the foot and
/// holds at `detents`. Wider, it is the web's modal: `width` wide (`.dialog
/// { width: min(520px, 100vw - 32px) }`, or the dialog's own) and as tall
/// as what's in it, its foot straight under its last line, which the
/// system keeps inside the window as `max-height: calc(100svh - 48px)`
/// does; or `height` tall, for a dialog the web gives a height
/// (`.lib-dialog`). A sheet sized by its content is iOS 18's; before that
/// a wider window keeps the system's form sheet, at `detents`.
struct DialogSheetSizing: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  let phone: Bool
  let detents: Set<PresentationDetent>
  var width: CGFloat = Measure.Dialog.width
  var height: CGFloat?

  func body(content: Content) -> some View {
    if phone {
      content.presentationDetents(detents)
    } else if #available(iOS 18.0, *) {
      // `min(width, 100vw - 32px)`, and a set height `min(height, 100svh - 48px)`.
      content
        .frame(
          idealWidth: min(width, theme.windowWidth - Measure.Dialog.windowSpaceAcross),
          idealHeight: height.map { min($0, theme.windowHeight - Measure.Dialog.windowSpaceDown) })
        .presentationSizing(.form.fitted(horizontal: true, vertical: true))
    } else {
      content.presentationDetents(detents)
    }
  }
}

extension View {
  /// A dialog's sheet: at `detents` on a phone, `width` wide and its
  /// content's height (or `height`) on a wider window.
  func dialogSheetSizing(
    phone: Bool, detents: Set<PresentationDetent>, width: CGFloat = Measure.Dialog.width, height: CGFloat? = nil
  ) -> some View {
    modifier(DialogSheetSizing(phone: phone, detents: detents, width: width, height: height))
  }
}

extension View {
  /// A dialog over this view, while `isPresented`. `autofocus`: its field
  /// marked `.dialogAutofocus()` takes focus when it opens.
  public func virgaDialog<Content: View, Actions: View>(
    isPresented: Binding<Bool>,
    title: String,
    size: DialogSize = .fit,
    stackActions: Bool = false,
    autofocus: Bool = false,
    @ViewBuilder content: @escaping () -> Content,
    @ViewBuilder actions: @escaping () -> Actions
  ) -> some View {
    modifier(
      DialogSheet(
        isPresented: isPresented, title: title, size: size, hasActions: true, stackActions: stackActions, autofocus: autofocus,
        inner: content, foot: actions))
  }

  /// A dialog with no foot (its content ends it, as Add an account's does).
  public func virgaDialog<Content: View>(
    isPresented: Binding<Bool>,
    title: String,
    size: DialogSize = .fit,
    autofocus: Bool = false,
    @ViewBuilder content: @escaping () -> Content
  ) -> some View {
    modifier(
      DialogSheet(
        isPresented: isPresented, title: title, size: size, hasActions: false, autofocus: autofocus, inner: content,
        foot: { EmptyView() }))
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

/// What a choice is marked by: a radio (one of a few), or a checkbox.
public enum ChoiceKind: Sendable {
  case radio, check
}

/// `.choice`: one of a few things to pick between (a radio, the default),
/// or a thing to tick (a checkbox): a row under a hairline, its label (600)
/// and a description under it beside the mark, 3 down and 12 from it; the
/// picked one is marked by its mark and by a 2-point rule in the accent
/// down its side. A list of them is ruled between rows and under the last:
/// each row draws its own line under it where the next row's would be, so
/// two rows share one line. VoiceOver reads a radio as a button, selected
/// when picked, and a checkbox as on or off.
public struct ChoiceRow: View {
  @Environment(\.virgaTheme) private var theme
  private let label: String
  private let description: String?
  private let kind: ChoiceKind
  @Binding private var isOn: Bool

  public init(_ label: String, description: String? = nil, isOn: Binding<Bool>, kind: ChoiceKind = .radio) {
    self.label = label
    self.description = description
    self.kind = kind
    self._isOn = isOn
  }

  public var body: some View {
    let hairline = Measure.Section.hairline
    mark
      .overlay(alignment: .leading) {
        Rectangle().fill(isOn ? theme.accent : Color.clear).frame(width: Measure.Dialog.choiceRule)
      }
      .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: hairline) }
      .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: hairline).offset(y: hairline) }
  }

  @ViewBuilder private var mark: some View {
    switch kind {
    case .radio:
      Button {
        isOn = true
      } label: {
        row
      }
      .buttonStyle(.plain)
      .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm), placement: .inside)
      .accessibilityElement(children: .combine)
      .accessibilityAddTraits(isOn ? [.isSelected] : [])
    case .check:
      Button {
        isOn.toggle()
      } label: {
        row
      }
      .buttonStyle(.plain)
      .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm), placement: .inside)
      // Read as a switch, on or off, with its description as the radio's
      // combined row reads it.
      .accessibilityRepresentation {
        Toggle(isOn: $isOn) {
          Text(label)
          if let description { Text(description) }
        }
      }
    }
  }

  private var row: some View {
    HStack(alignment: .top, spacing: Measure.Dialog.choiceGap) {
      Group {
        if kind == .radio {
          RadioMark(isOn: isOn)
        } else {
          CheckBox(isOn: isOn, side: theme.points(ThemeKit.checkboxSize))
        }
      }
      .padding(.top, Measure.Dialog.choiceInputSpaceAbove)
      .accessibilityHidden(true)
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
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    // The row's padding is inside the button: the whole row is the
    // `<label>`, pressed anywhere in it.
    .padding(Measure.Dialog.choicePadding)
    .contentShape(Rectangle())
  }
}

/// The browser's radio (`input[type='radio']` with `accent-color`), drawn:
/// a 16-point ring in --line-2, the accent's ring and a dot in it when on.
struct RadioMark: View {
  @Environment(\.virgaTheme) private var theme
  let isOn: Bool

  var body: some View {
    let side = theme.points(ThemeKit.checkboxSize)
    ZStack {
      Circle().fill(theme.surface)
      Circle().strokeBorder(isOn ? theme.accent : theme.line2, lineWidth: Measure.Check.edge)
      if isOn {
        Circle()
          .fill(theme.accent)
          .frame(width: side * Measure.Check.radioDotShare, height: side * Measure.Check.radioDotShare)
      }
    }
    .frame(width: side, height: side)
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
