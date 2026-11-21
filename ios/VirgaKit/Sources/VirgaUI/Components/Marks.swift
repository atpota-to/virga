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
      .contentShape(Capsule())
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
    let remove = theme.points(ThemeKit.tokenRemoveSize)
    HStack(spacing: theme.points(ThemeKit.tokenGap)) {
      Text(text)
        .virgaText(size: theme.points(ThemeKit.chipFontSize), weight: ThemeKit.chipWeight)
        .lineLimit(1)
        .foregroundStyle(theme.ink)
      Button(action: onRemove) {
        Image(systemName: Glyph.close)
          .font(.system(size: theme.points(ThemeKit.tokenRemoveIconSize), weight: .medium))
          .foregroundStyle(theme.muted)
          .frame(width: remove, height: remove)
          .background(Circle().fill(Color.clear))
          .contentShape(Circle().inset(by: -Measure.Touch.tokenRemoveReach))
      }
      .buttonStyle(.plain)
      .accessibilityLabel(removeLabel)
    }
    .padding(theme.insets(ThemeKit.tokenPadding))
    .frame(minHeight: theme.points(ThemeKit.touchTokenHeight))
    .overlay(Capsule().strokeBorder(theme.line2, lineWidth: 1))
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
    HStack(spacing: theme.points(ThemeKit.badgeGap)) {
      if let systemImage {
        Image(systemName: systemImage)
          .font(.system(size: theme.points(ThemeKit.badgeIconSize)))
      }
      Text(text)
        .virgaText(size: theme.points(ThemeKit.badgeFontSize), weight: ThemeKit.badgeWeight)
        .lineLimit(1)
    }
    .foregroundStyle(theme.color(ink))
    .padding(theme.insets(ThemeKit.badgePadding))
    .frame(minHeight: theme.points(ThemeKit.badgeLineHeight))
    .background(Capsule().fill(theme.color(fill)))
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
    HStack(spacing: theme.points(ThemeKit.metaItemGap)) {
      if let image = item.systemImage {
        Image(systemName: image)
          .font(.system(size: theme.points(ThemeKit.metaIconSize)))
          .accessibilityHidden(true)
      }
      Text(item.text)
        .virgaText(size: size, weight: item.isKey ? ThemeKit.metaKeyWeight : VirgaWeight.regular, lineHeight: ThemeKit.metaLineHeight)
        .foregroundStyle(item.isKey ? theme.color(ThemeKit.metaKeyInk) : theme.color(ThemeKit.metaInk))
      if !isLast {
        Text("·")
          .virgaText(size: size)
          .padding(.leading, theme.points(dot.left) - theme.points(ThemeKit.metaItemGap))
          .padding(.trailing, theme.points(dot.right))
          .accessibilityHidden(true)
      }
    }
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
