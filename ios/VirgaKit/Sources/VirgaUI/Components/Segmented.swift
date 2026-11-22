// Ports src/components/Segmented.jsx
// Ports src/styles/controls.css (.segmented, .scroll-row and their touch sizes)
// Ports src/styles/theme.css
//
// A row of words, one pressed: the pressed one is ink, 600, with a 2-point
// line under it (3 in high contrast); no track and no chip (not
// Picker(.segmented), which is a track of chips). Each key keeps the width
// of its word in bold, so pressing one doesn't nudge the rest. Medium is the
// window of the whole page; small narrows one list or one chart. When it
// doesn't fit it scrolls sideways, without a scroll bar, fading the edge
// with more behind it, and brings the pressed key into view. A group of
// toggle buttons (VoiceOver reads the pressed one as selected), not a radio
// group: each key acts the moment it is pressed. Pressing the pressed key
// calls `onChange` with it again, which a caller may ignore.
//
//   Segmented(label: "Contrast", options: [.init("system", "Match system"), …], selection: $contrast)

#if canImport(UIKit)
import SwiftUI
import VirgaCore

public struct SegmentedOption<Value: Hashable>: Identifiable {
  public var value: Value
  public var label: String
  /// A glyph before the label (Custom's calendar).
  public var systemImage: String?
  /// What VoiceOver reads instead of the label (the web's aria-label).
  public var accessibilityLabel: String?
  /// What the key means, read by VoiceOver after its name (the web's
  /// `title`, the browser's tooltip: "Posts per week" for Weekly).
  public var hint: String?
  /// The glyph alone, its words kept as its name (a phone's Custom key).
  public var iconOnly: Bool

  public var id: Value { value }

  public init(
    _ value: Value, _ label: String, systemImage: String? = nil, accessibilityLabel: String? = nil, hint: String? = nil,
    iconOnly: Bool = false
  ) {
    self.value = value
    self.label = label
    self.systemImage = systemImage
    self.accessibilityLabel = accessibilityLabel
    self.hint = hint
    self.iconOnly = iconOnly
  }
}

public struct Segmented<Value: Hashable>: View {
  @Environment(\.virgaTheme) private var theme
  private let label: String
  private let options: [SegmentedOption<Value>]
  private let selection: Value
  private let size: KitSize
  private let onChange: (Value) -> Void

  /// - Parameters:
  ///   - label: the group's name, for VoiceOver.
  ///   - size: `.medium` (the page's window) or `.small` (one list or chart).
  public init(
    label: String, options: [SegmentedOption<Value>], selection: Value, size: KitSize = .medium,
    onChange: @escaping (Value) -> Void
  ) {
    self.label = label
    self.options = options
    self.selection = selection
    self.size = size
    self.onChange = onChange
  }

  /// With a binding: pressing a key sets it.
  public init(label: String, options: [SegmentedOption<Value>], selection: Binding<Value>, size: KitSize = .medium) {
    self.init(label: label, options: options, selection: selection.wrappedValue, size: size) { selection.wrappedValue = $0 }
  }

  public var body: some View {
    // Whole when it fits; otherwise a row that scrolls sideways.
    ViewThatFits(in: .horizontal) {
      keys.fixedSize()
      ScrollRow(focus: AnyHashable(selection)) { keys }
    }
    // The row is let out 11 points at each end, its words held where they
    // were by as much padding, so the end keys' reach is inside the row.
    .padding(.horizontal, -Measure.Touch.segmentedReach)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(label)
  }

  private var keys: some View {
    HStack(spacing: theme.points(ThemeKit.touchSegmentedGap)) {
      ForEach(options) { option in
        SegmentedKey(option: option, isOn: option.value == selection, size: size) { onChange(option.value) }
          .id(AnyHashable(option.value))
      }
    }
    .padding(.horizontal, Measure.Touch.segmentedReach)
  }
}

struct SegmentedKey<Value: Hashable>: View {
  @Environment(\.virgaTheme) private var theme
  let option: SegmentedOption<Value>
  let isOn: Bool
  let size: KitSize
  let action: () -> Void

  var body: some View {
    let fontSize = theme.points(size == .small ? ThemeKit.smallSegmentedKeyFontSize : ThemeKit.segmentedKeyFontSize)
    let underline = theme.isHighContrast ? ThemeKit.highContrastSegmentedOnUnderline : ThemeKit.segmentedOnUnderline
    let lineWidth = abs(theme.points(underline.first?.y ?? .px(-2)))
    Button(action: action) {
      HStack(spacing: Measure.Segmented.keyGap) {
        if let image = option.systemImage {
          Image(systemName: image)
            .font(.system(size: theme.points(ThemeKit.segmentedIconSize)))
        }
        // The word in bold holds the key's width, so pressing doesn't nudge
        // the keys beside it.
        if !(option.iconOnly && option.systemImage != nil) {
          ZStack {
            Text(option.label)
              .virgaText(size: fontSize, weight: ThemeKit.segmentedOnWeight, lineHeight: Measure.Lines.segmentedKey)
              .hidden()
            Text(option.label)
              .virgaText(
                size: fontSize, weight: isOn ? ThemeKit.segmentedOnWeight : ThemeKit.segmentedKeyWeight,
                lineHeight: Measure.Lines.segmentedKey)
          }
        }
      }
      .lineLimit(1)
      .foregroundStyle(theme.color(isOn ? ThemeKit.segmentedOnInk : ThemeKit.segmentedKeyInk))
      .frame(minHeight: theme.points(ThemeKit.touchSegmentedKeyHeight))
      .overlay(alignment: .bottom) {
        if isOn {
          Rectangle()
            .fill(theme.color(underline.first?.color ?? .color(.transparent)))
            .frame(height: lineWidth)
        }
      }
      .touchReach(horizontal: Measure.Touch.segmentedReach, vertical: 0)
      .animation(theme.motion.control, value: isOn)
      // Where the pressed key is, for a row that scrolls to bring it clear
      // of the fade (ScrollRow).
      .scrollRowFocus(isOn)
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm), placement: .inside)
    .accessibilityLabel(option.accessibilityLabel ?? option.label)
    .accessibilityHint(option.hint ?? "")
    .accessibilityAddTraits(isOn ? [.isSelected] : [])
  }
}

#Preview("Segmented") {
  VirgaPreviewHost {
    VStack(alignment: .leading, spacing: 24) {
      Segmented(
        label: "Contrast",
        options: [SegmentedOption("system", "Match system"), SegmentedOption("normal", "Standard"), SegmentedOption("high", "High")],
        selection: .constant("system"))
      Segmented(
        label: "Period",
        options: ["7d", "30d", "90d", "1y", "All"].map { SegmentedOption($0, $0) },
        selection: .constant("30d"), size: .small)
    }
    .padding()
  }
}
#endif
