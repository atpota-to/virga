// Ports src/components/Button.jsx
// Ports src/styles/controls.css (.btn, .link-action, .more-link, and their touch sizes)
//
// The app's one button, a pill, in its tiers: quiet (the default, an outline
// in --line-2), primary (ink: New post, and inside a page only the button
// that confirms what was opened), ghost (no edge until pressed: an icon
// alone, or the few quiet words that keep a button's shape) and danger (a
// confirm dialog's red; at night the deep red, since night's --danger is a
// coral meant for words). Three sizes: medium (40 under a finger), small (32,
// pressed through 44), large (46). An icon alone is a circle; a ghost icon is
// 44 square. A button that is a state (Following) is its word alone, quiet
// (`isOn`); the one destructive button a page may show is the outline with
// red words (`destructive`). Disabled is 45%. Weight 500; 600 primary and
// danger. Every finger size is the touch block's (pointer: coarse is every
// iPhone and iPad).
//
//   Button("Sync now") { … }.buttonStyle(.virga)
//   Button("Agree and continue") { … }.buttonStyle(.virga(.primary, size: .large))
//   Button { … } label: { Image(systemName: "xmark") }.buttonStyle(.virga(.ghost, size: .small, icon: true))
//
// A verb that is words alone is a link action (LinkActionStyle), and the
// way to the whole of a list is a more link (MoreLink).

#if canImport(UIKit)
import SwiftUI
import VirgaCore

public enum ButtonTier: Sendable {
  case quiet, primary, ghost, danger
}

public enum KitSize: Sendable {
  case small, medium, large
}

public struct VirgaButtonStyle: ButtonStyle {
  public var tier: ButtonTier
  public var size: KitSize
  public var icon: Bool
  public var isOn: Bool
  public var destructive: Bool

  public init(_ tier: ButtonTier = .quiet, size: KitSize = .medium, icon: Bool = false, isOn: Bool = false, destructive: Bool = false) {
    self.tier = tier
    self.size = size
    self.icon = icon
    self.isOn = isOn
    self.destructive = destructive
  }

  public func makeBody(configuration: Configuration) -> some View {
    VirgaButtonBody(label: configuration.label, isPressed: configuration.isPressed, style: self)
  }
}

extension ButtonStyle where Self == VirgaButtonStyle {
  /// The quiet medium button.
  public static var virga: VirgaButtonStyle { VirgaButtonStyle() }

  public static func virga(
    _ tier: ButtonTier = .quiet, size: KitSize = .medium, icon: Bool = false, isOn: Bool = false, destructive: Bool = false
  ) -> VirgaButtonStyle {
    VirgaButtonStyle(tier, size: size, icon: icon, isOn: isOn, destructive: destructive)
  }
}

/// How an icon and words sit together in a button: the button's own gap.
struct InlineLabelStyle: LabelStyle {
  var gap: CGFloat

  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: gap) {
      configuration.icon
      configuration.title
    }
  }
}

struct VirgaButtonBody<Label: View>: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  @Environment(\.virgaFillsWidth) private var fillsWidth
  let label: Label
  let isPressed: Bool
  let style: VirgaButtonStyle

  var body: some View {
    let metrics = self.metrics
    let paint = self.paint
    label
      .labelStyle(InlineLabelStyle(gap: metrics.gap))
      .virgaText(size: metrics.fontSize, weight: paint.weight, lineHeight: Measure.Lines.button)
      .lineLimit(1)
      // `white-space: nowrap`, and a flex item's least width is its words:
      // a row short of room gives way around the button, which keeps them.
      .fixedSize(horizontal: true, vertical: false)
      .foregroundStyle(paint.ink)
      .padding(.horizontal, style.icon ? 0 : metrics.padding)
      .frame(minWidth: style.icon ? metrics.width : nil, minHeight: metrics.height)
      .frame(width: style.icon ? metrics.width : nil, height: style.icon ? metrics.width : nil)
      // A phone's dialog ends in equal halves, each a full 44 to press.
      .frame(maxWidth: fillsWidth ? .infinity : nil, minHeight: fillsWidth ? Measure.Touch.target : nil)
      .background(Capsule().fill(paint.fill))
      .overlay(Capsule().strokeBorder(paint.edge, lineWidth: theme.points(ThemeKit.buttonBorder)))
      .contentShape(Capsule().inset(by: -metrics.reach))
      .opacity(isEnabled ? 1 : ThemeKit.disabledOpacity)
      .animation(theme.motion.control, value: isPressed)
      .virgaFocusOutline(Capsule())
  }

  struct Metrics {
    var height: CGFloat
    var width: CGFloat
    var padding: CGFloat
    var fontSize: CGFloat
    var gap: CGFloat
    /// How far past its box a finger may press it (the touch block's ::after).
    var reach: CGFloat
  }

  var metrics: Metrics {
    switch style.size {
    case .small:
      let height = theme.points(ThemeKit.touchSmallButtonHeight)
      let width = theme.points(style.tier == .ghost ? ThemeKit.touchGhostIconButtonSize : ThemeKit.touchSmallIconButtonWidth)
      // A ghost icon is simply 44 square; anything else small reaches 6 past
      // its edges to 44.
      let reach: CGFloat = style.tier == .ghost && style.icon ? 0 : (theme.points(ThemeKit.touchGhostIconButtonSize) - height) / 2
      return Metrics(
        height: style.tier == .ghost && style.icon ? width : height, width: width,
        padding: theme.points(ThemeKit.smallButtonPadding.left), fontSize: theme.points(ThemeKit.smallButtonFontSize),
        gap: theme.points(ThemeKit.smallButtonGap), reach: reach)
    case .medium:
      let height = theme.points(ThemeKit.touchButtonHeight)
      let width = theme.points(style.tier == .ghost ? ThemeKit.touchGhostIconButtonSize : ThemeKit.touchIconButtonWidth)
      // 40 tall, pressed through 44 (DESIGN.md's Touch: every control at
      // least 44 to press, without looking bigger); a ghost icon is 44.
      let reach: CGFloat = style.tier == .ghost && style.icon ? 0 : max(0, (Measure.Touch.target - height) / 2)
      return Metrics(
        height: style.tier == .ghost && style.icon ? width : height, width: width,
        padding: theme.points(ThemeKit.buttonPadding.left), fontSize: theme.points(ThemeKit.buttonFontSize),
        gap: theme.points(ThemeKit.buttonGap), reach: reach)
    case .large:
      let height = theme.points(ThemeKit.touchLargeButtonHeight)
      return Metrics(
        height: height, width: theme.points(ThemeKit.largeIconButtonWidth),
        padding: theme.points(ThemeKit.largeButtonPadding.left), fontSize: theme.points(ThemeKit.largeButtonFontSize),
        gap: theme.points(ThemeKit.buttonGap), reach: 0)
    }
  }

  struct Paint {
    var fill: Color
    var edge: Color
    var ink: Color
    var weight: Double
  }

  var paint: Paint {
    let night = theme.colorScheme == .dark
    if style.isOn {
      // A state: the word alone, quiet; pressed brings its edge back.
      return Paint(
        fill: .clear, edge: isPressed ? theme.line2 : .clear, ink: isPressed ? theme.ink : theme.color(ThemeKit.stateButtonInk),
        weight: ThemeKit.buttonWeight)
    }
    switch style.tier {
    case .primary:
      let fill = theme.color(isPressed ? ThemeKit.primaryButtonHoverFill : ThemeKit.primaryButtonFill)
      return Paint(fill: fill, edge: fill, ink: theme.color(ThemeKit.primaryButtonInk), weight: ThemeKit.primaryButtonWeight)
    case .danger:
      let value: ThemeValue
      if night {
        value = isPressed ? ThemeKit.dangerButtonHoverFillAtNight : ThemeKit.dangerButtonFillAtNight
      } else {
        value = isPressed ? ThemeKit.dangerButtonHoverFill : ThemeKit.dangerButtonFill
      }
      let fill = theme.color(value)
      return Paint(fill: fill, edge: fill, ink: theme.color(ThemeKit.dangerButtonInk), weight: ThemeKit.primaryButtonWeight)
    case .ghost:
      return Paint(
        fill: isPressed ? theme.color(ThemeKit.ghostButtonHoverFill) : .clear, edge: .clear,
        ink: isPressed ? theme.ink : theme.color(ThemeKit.ghostButtonInk), weight: ThemeKit.buttonWeight)
    case .quiet:
      let ink = style.destructive ? theme.color(ThemeKit.destructiveButtonInk) : theme.color(ThemeKit.buttonInk)
      let pressedEdge = style.destructive ? theme.danger : theme.color(ThemeKit.buttonHoverEdge)
      return Paint(
        fill: .clear, edge: isPressed ? pressedEdge : theme.color(ThemeKit.buttonBorder), ink: ink, weight: ThemeKit.buttonWeight)
    }
  }
}

// MARK: - Link action

/// `.link-action`: every other verb, as words in ink with a line under them
/// (1 point, 3 under the baseline), led by a 14-point icon (Export, Show as
/// table, Add an account). Heavier, with a 2-point line, while what it opens
/// is open (`isOpen`), and while pressed (the pointer's hover). Its line is
/// 1.45 of its words, and a finger presses it through 13 points above and
/// below that and 6 at the sides.
public struct LinkActionStyle: ButtonStyle {
  public var isOpen: Bool

  public init(isOpen: Bool = false) {
    self.isOpen = isOpen
  }

  public func makeBody(configuration: Configuration) -> some View {
    LinkActionBody(label: configuration.label, isPressed: configuration.isPressed, isOpen: isOpen)
  }
}

extension ButtonStyle where Self == LinkActionStyle {
  public static var linkAction: LinkActionStyle { LinkActionStyle() }
  public static func linkAction(isOpen: Bool) -> LinkActionStyle { LinkActionStyle(isOpen: isOpen) }
}

private struct LinkLineKey: EnvironmentKey {
  static let defaultValue: CGFloat = Measure.LinkAction.underline
}

extension EnvironmentValues {
  /// How thick a link action's line is (1, or 2 while open or pressed).
  var virgaLinkLine: CGFloat {
    get { self[LinkLineKey.self] }
    set { self[LinkLineKey.self] = newValue }
  }
}

/// Set by a link action's label style, so the action knows its words
/// draw their own line (a Label's title) and it doesn't draw another.
private struct LinkTitledKey: PreferenceKey {
  static let defaultValue = false
  static func reduce(value: inout Bool, nextValue: () -> Bool) {
    value = value || nextValue()
  }
}

/// `text-decoration: underline` at `text-underline-offset: 3px` and the
/// environment's thickness: a rule in the words' colour whose top is 3
/// points under their last baseline. SwiftUI's own underline takes the
/// font's thickness and offset, which can't be set.
struct LinkUnderline: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.virgaLinkLine) private var thickness
  var drawn: Bool = true

  func body(content: Content) -> some View {
    let offset = theme.points(ThemeKit.linkActionUnderlineOffset)
    content
      .overlay(alignment: Alignment(horizontal: .leading, vertical: .lastTextBaseline)) {
        if drawn {
          Rectangle()
            .frame(height: thickness)
            .alignmentGuide(.lastTextBaseline) { _ in -offset }
            .accessibilityHidden(true)
        }
      }
  }
}

/// The 14-point glyph a link action leads with, centred on its words' line;
/// the line under the words alone.
struct LinkActionIconStyle: LabelStyle {
  @Environment(\.virgaTheme) private var theme

  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: theme.points(ThemeKit.linkActionGap)) {
      configuration.icon
        .font(.system(size: theme.points(ThemeKit.linkActionIconSize)))
      configuration.title
        .modifier(LinkUnderline())
    }
    .preference(key: LinkTitledKey.self, value: true)
  }
}

struct LinkActionBody<Label: View>: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  @State private var titled = false
  let label: Label
  let isPressed: Bool
  let isOpen: Bool

  var body: some View {
    let heavy = isOpen || (isPressed && isEnabled)
    label
      .labelStyle(LinkActionIconStyle())
      // Words alone (Button("Renumber")): the line is drawn under them here.
      .modifier(LinkUnderline(drawn: !titled))
      .onPreferenceChange(LinkTitledKey.self) { titled = $0 }
      .virgaText(
        size: theme.points(ThemeKit.linkActionFontSize), weight: isOpen ? ThemeKit.linkActionOpenWeight : ThemeKit.linkActionWeight,
        lineHeight: Measure.LinkAction.lineHeight, lineBox: true)
      .lineLimit(1)
      .foregroundStyle(theme.ink)
      .environment(\.virgaLinkLine, heavy ? Measure.LinkAction.heavyUnderline : Measure.LinkAction.underline)
      .opacity(isEnabled ? 1 : ThemeKit.disabledOpacity)
      .touchReach(horizontal: Measure.LinkAction.reachSides, vertical: Measure.LinkAction.reachAbove)
      .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm))
  }
}

// MARK: - More link

/// `.more-link`: the way to the whole of a list, at the right of its
/// heading (All scheduled, All posts), in muted words: a place to go.
/// Pressed (the pointer's hover), its words turn ink and take a line.
public struct MoreLink: View {
  @Environment(\.navigate) private var navigate
  private let title: String
  private let address: String

  public init(_ title: String, to address: String) {
    self.title = title
    self.address = address
  }

  public var body: some View {
    Button {
      navigate(address)
    } label: {
      Text(title)
    }
    .buttonStyle(MoreLinkStyle())
    .accessibilityAddTraits(.isLink)
    .accessibilityRemoveTraits(.isButton)
  }
}

struct MoreLinkStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    MoreLinkBody(label: configuration.label, isPressed: configuration.isPressed)
  }
}

struct MoreLinkBody<Label: View>: View {
  @Environment(\.virgaTheme) private var theme
  let label: Label
  let isPressed: Bool

  var body: some View {
    label
      .modifier(LinkUnderline(drawn: isPressed))
      .virgaText(
        size: theme.points(ThemeKit.moreLinkFontSize), weight: ThemeKit.moreLinkWeight, lineHeight: Measure.LinkAction.lineHeight,
        lineBox: true)
      .foregroundStyle(isPressed ? theme.ink : theme.color(ThemeKit.moreLinkInk))
      .lineLimit(1)
      .touchReach(horizontal: Measure.LinkAction.reachSides, vertical: Measure.LinkAction.reachAbove)
      .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm))
  }
}

#Preview("Buttons") {
  VirgaPreviewHost {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Button("Agree and continue") {}.buttonStyle(.virga(.primary, size: .large))
        Button("Cancel") {}.buttonStyle(.virga)
      }
      HStack {
        Button("Sign out") {}.buttonStyle(.virga(.danger))
        Button("Switch") {}.buttonStyle(.virga(size: .small))
        Button("Following") {}.buttonStyle(.virga(isOn: true))
        Button {
        } label: {
          Image(systemName: Glyph.close)
        }
        .buttonStyle(.virga(.ghost, size: .small, icon: true))
        .accessibilityLabel("Close")
      }
      Button("Delete the archive…") {}.buttonStyle(.virga(destructive: true))
      Button("Disabled") {}.buttonStyle(.virga).disabled(true)
      Button {
      } label: {
        Label("Add an account", systemImage: Glyph.userPlus)
      }
      .buttonStyle(.linkAction)
      MoreLink("All posts", to: "/posting/posted")
    }
    .padding()
  }
}
#endif
