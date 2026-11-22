// Ports src/styles/controls.css (badges, meta, chips, tokens, the dot)
//
// The small marks:
//   Chip        picks a value in a form, as one of a radio group's choices;
//               pressed is filled with ink. Not a filter and not a tag.
//   TokenView   a value that has been chosen, with a ✕ to take it back; a
//               wrapping row of them is TokenRow.
//   Badge       only a problem the person has to find (Didn't go out, Needs
//               sign-in, This session only): warn or danger, a pill of wash
//               with the words in its colour.
//   MetaLine    the small facts under a title: muted words with a dot
//               between them. The dot belongs to the word before it, so a
//               wrapped line never starts with one. A row's key fact is a
//               step louder.
//   StateDot    7 points, says a state, always beside its word.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

// MARK: - Chip

public struct ChipStyle: ButtonStyle {
  public var isOn: Bool

  public init(isOn: Bool) {
    self.isOn = isOn
  }

  public func makeBody(configuration: Configuration) -> some View {
    ChipBody(label: configuration.label, isOn: isOn, isPressed: configuration.isPressed)
  }
}

struct ChipBody<Label: View>: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  let label: Label
  let isOn: Bool
  let isPressed: Bool

  var body: some View {
    let fill = isOn ? theme.color(ThemeKit.chipOnFill) : Color.clear
    let edge = isOn ? theme.color(ThemeKit.chipOnFill) : (isPressed ? theme.ink : theme.color(ThemeKit.chipBorder))
    let ink = isOn ? theme.color(ThemeKit.chipOnInk) : (isPressed ? theme.ink : theme.color(ThemeKit.chipInk))
    label
      .virgaText(size: theme.points(ThemeKit.chipFontSize), weight: isOn ? ThemeKit.chipOnWeight : ThemeKit.chipWeight)
      .lineLimit(1)
      .foregroundStyle(ink)
      .padding(.horizontal, theme.points(ThemeKit.chipPadding.left))
      .frame(minHeight: theme.points(ThemeKit.touchChipHeight))
      .background(Capsule().fill(fill))
      .overlay(Capsule().strokeBorder(edge, lineWidth: theme.points(ThemeKit.chipBorder)))
      // 40 tall, pressed through 44 (DESIGN.md's Touch).
      .contentShape(Capsule().inset(by: -max(0, (Measure.Touch.target - theme.points(ThemeKit.touchChipHeight)) / 2)))
      .opacity(isEnabled ? 1 : ThemeKit.disabledOpacity)
      .animation(theme.motion.control, value: isOn)
      .virgaFocusOutline(Capsule())
      .accessibilityAddTraits(isOn ? [.isSelected] : [])
  }
}

// MARK: - Token

/// A chosen value with its ✕: `TokenView("Mon 09:00", removeLabel: "Remove Mon 09:00") { … }`.
public struct TokenView: View {
  @Environment(\.virgaTheme) private var theme
  private let text: String
  private let removeLabel: String
  private let onRemove: () -> Void

  public init(_ text: String, removeLabel: String, onRemove: @escaping () -> Void) {
    self.text = text
    self.removeLabel = removeLabel
    self.onRemove = onRemove
  }

  public var body: some View {
    HStack(spacing: theme.points(ThemeKit.tokenGap)) {
      Text(text)
        .virgaText(Measure.Token.fontSize, weight: Measure.Token.weight, lineHeight: Measure.Lines.token)
        .lineLimit(1)
        .foregroundStyle(theme.ink)
      Button(action: onRemove) {
        Image(systemName: Glyph.close)
      }
      .buttonStyle(TokenRemoveStyle())
      .accessibilityLabel(removeLabel)
    }
    .padding(theme.insets(ThemeKit.tokenPadding))
    .frame(minHeight: theme.points(ThemeKit.touchTokenHeight))
    .overlay(Capsule().strokeBorder(theme.line2, lineWidth: Measure.Token.border))
  }
}

/// `.token-remove`: a 24-point disc with the ✕ in muted, the hover's fill
/// and ink while pressed, pressed through 10 points past it; keyboard focus
/// draws the kit's outline round it.
struct TokenRemoveStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    TokenRemoveBody(label: configuration.label, isPressed: configuration.isPressed)
  }
}

struct TokenRemoveBody<Label: View>: View {
  @Environment(\.virgaTheme) private var theme
  let label: Label
  let isPressed: Bool

  var body: some View {
    let side = theme.points(ThemeKit.tokenRemoveSize)
    label
      .virgaGlyph(theme.points(ThemeKit.tokenRemoveIconSize), weight: .medium)
      .foregroundStyle(isPressed ? theme.ink : theme.muted)
      .frame(width: side, height: side)
      .background(Circle().fill(isPressed ? theme.hover : Color.clear))
      .contentShape(Circle().inset(by: -Measure.Touch.tokenRemoveReach))
      .animation(theme.motion.control, value: isPressed)
      .virgaFocusOutline(Circle())
  }
}

/// `.tokens`: a wrapping row of tokens, 8 apart (12 between lines on touch).
public struct TokenRow<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  private let content: Content

  public init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  public var body: some View {
    FlowLayout(spacing: theme.points(ThemeKit.tokensGap), lineSpacing: theme.points(ThemeKit.touchTokensRowGap)) {
      content
    }
  }
}

// MARK: - Badge

public enum BadgeTone: Sendable {
  case warn, danger
}

public struct Badge: View {
  @Environment(\.virgaTheme) private var theme
  private let text: String
  private let tone: BadgeTone
  private let systemImage: String?

  public init(_ text: String, tone: BadgeTone = .warn, systemImage: String? = nil) {
    self.text = text
    self.tone = tone
    self.systemImage = systemImage
  }

  public var body: some View {
    let fill = tone == .warn ? ThemeKit.warnBadgeFill : ThemeKit.dangerBadgeFill
    let ink = tone == .warn ? ThemeKit.warnBadgeInk : ThemeKit.dangerBadgeInk
    // `border: 1px solid transparent`: the pill is its line and its padding
    // plus that edge, 22 tall and 8 in at the sides.
    let edge = Measure.Badge.border
    HStack(spacing: theme.points(ThemeKit.badgeGap)) {
      if let systemImage {
        Image(systemName: systemImage)
          .virgaGlyph(theme.points(ThemeKit.badgeIconSize), beside: theme.points(ThemeKit.badgeFontSize))
          .accessibilityHidden(true)
      }
      Text(text)
        .virgaText(size: theme.points(ThemeKit.badgeFontSize), weight: ThemeKit.badgeWeight)
        .lineLimit(1)
    }
    .foregroundStyle(theme.color(ink))
    .padding(theme.insets(ThemeKit.badgePadding))
    .padding(edge)
    .frame(minHeight: theme.points(ThemeKit.badgeLineHeight) + edge * 2)
    .background(Capsule().fill(theme.color(fill)))
    .accessibilityElement(children: .combine)
  }
}

// MARK: - Meta line

/// One fact on a meta line.
public struct MetaItem: Identifiable {
  public var id: String
  public var text: String
  public var systemImage: String?
  /// The row's key fact, a step louder (ThemeKit.metaKeyInk, 500).
  public var isKey: Bool

  public init(_ text: String, systemImage: String? = nil, isKey: Bool = false, id: String? = nil) {
    self.id = id ?? text
    self.text = text
    self.systemImage = systemImage
    self.isKey = isKey
  }
}

/// `.meta`: muted words at --text-sm with a dot between them, the dot
/// belonging to the word before it.
public struct MetaLine: View {
  @Environment(\.virgaTheme) private var theme
  private let items: [MetaItem]

  public init(_ items: [MetaItem]) {
    self.items = items
  }

  public init(_ texts: [String]) {
    self.items = texts.map { MetaItem($0) }
  }

  public var body: some View {
    let size = theme.points(ThemeKit.metaFontSize)
    FlowLayout(spacing: 0, lineSpacing: 0, alignment: .center) {
      ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
        MetaItemView(item: item, size: size, isLast: index == items.count - 1)
      }
    }
    .foregroundStyle(theme.color(ThemeKit.metaInk))
  }
}

struct MetaItemView: View {
  @Environment(\.virgaTheme) private var theme
  let item: MetaItem
  let size: CGFloat
  let isLast: Bool

  var body: some View {
    let dot = ThemeKit.metaDotMargin
    // `.meta > * { display: inline-flex; gap: 5px }`: the dot (its ::after)
    // is one of the item's flex items, so it sits the gap and its own 1
    // after the word, 6 in all, and 6 before the next.
    HStack(spacing: theme.points(ThemeKit.metaItemGap)) {
      if let image = item.systemImage {
        Image(systemName: image)
          .virgaGlyph(theme.points(ThemeKit.metaIconSize), beside: size)
          .accessibilityHidden(true)
      }
      Text(item.text)
        .virgaText(
          size: size, weight: item.isKey ? ThemeKit.metaKeyWeight : VirgaWeight.regular, lineHeight: ThemeKit.metaLineHeight,
          lineBox: true)
        .foregroundStyle(item.isKey ? theme.color(ThemeKit.metaKeyInk) : theme.color(ThemeKit.metaInk))
      if !isLast {
        Text("·")
          .virgaText(size: size, lineHeight: ThemeKit.metaLineHeight, lineBox: true)
          .foregroundStyle(theme.color(ThemeKit.metaInk))
          .padding(.leading, theme.points(dot.left))
          .padding(.trailing, theme.points(dot.right))
          .accessibilityHidden(true)
      }
    }
  }
}

/// One piece of a meta line drawn by its caller (a badge, a link): the
/// line's words and size, and its dot after it unless it is the last.
public struct MetaPiece<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  private let isLast: Bool
  private let content: Content

  public init(isLast: Bool, @ViewBuilder content: () -> Content) {
    self.isLast = isLast
    self.content = content()
  }

  public var body: some View {
    let size = theme.points(ThemeKit.metaFontSize)
    // An item of `.meta`: inline-flex with a 5-point gap, its dot one of
    // its flex items, 1 more after the gap (6 from the word) and 6 before
    // the next.
    HStack(spacing: theme.points(ThemeKit.metaItemGap)) {
      content
      if !isLast {
        Text("·")
          .foregroundStyle(theme.color(ThemeKit.metaInk))
          .padding(.leading, theme.points(ThemeKit.metaDotMargin.left))
          .padding(.trailing, theme.points(ThemeKit.metaDotMargin.right))
          .accessibilityHidden(true)
      }
    }
    .virgaText(size: size, lineHeight: ThemeKit.metaLineHeight)
    // The meta line's box, 1.45 of its words, as MetaItemView's; a taller
    // piece (a badge) keeps its own height.
    .frame(minHeight: theme.scaled(size) * CGFloat(ThemeKit.metaLineHeight))
    .foregroundStyle(theme.color(ThemeKit.metaInk))
  }
}

// MARK: - Dot

public enum DotState: Sendable {
  case ok, warn, danger, idle, current
}

/// `.dot`: a state, always beside its word.
public struct StateDot: View {
  @Environment(\.virgaTheme) private var theme
  private let state: DotState

  public init(_ state: DotState) {
    self.state = state
  }

  public var body: some View {
    let fill: ThemeValue
    switch state {
    case .ok: fill = ThemeKit.dotFill
    case .warn: fill = ThemeKit.warnDotFill
    case .danger: fill = ThemeKit.dangerDotFill
    case .idle: fill = ThemeKit.idleDotFill
    case .current: fill = ThemeKit.currentDotFill
    }
    let size = theme.points(ThemeKit.dotSize)
    return Circle()
      .fill(theme.color(fill))
      .frame(width: size, height: size)
      .accessibilityHidden(true)
  }
}

#Preview("Marks") {
  VirgaPreviewHost {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Button("Yes") {}.buttonStyle(ChipStyle(isOn: true))
        Button("No") {}.buttonStyle(ChipStyle(isOn: false))
      }
      TokenRow {
        TokenView("Mon 09:00", removeLabel: "Remove Mon 09:00") {}
        TokenView("#gardening", removeLabel: "Remove #gardening") {}
      }
      HStack {
        Badge("Signed out")
        Badge("Didn’t go out", tone: .danger)
      }
      MetaLine([MetaItem("Acts in 2 days", isKey: true), MetaItem("Reply"), MetaItem("12 likes")])
      HStack {
        StateDot(.current)
        Text("Open now")
      }
    }
    .padding()
  }
}
#endif
