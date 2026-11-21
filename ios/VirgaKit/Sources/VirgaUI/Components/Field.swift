// Ports src/styles/controls.css (.field, .input, textarea.input, .search, .field-hint)
//
// A field: a pale pane (--surface at 72%, so the sky shows through) with a
// --line-2 edge, radius 8, 40 tall under a finger, its words 16 (smaller,
// and iOS zooms in). Focused, its edge turns --focus-ring and --focus rings
// it (a 1-point line with a halo out to 4 points; high contrast's has a gap
// inside it). In trouble (`invalid`), its edge and ring are --danger, the
// element declaring both again as `.input[aria-invalid='true']` does. A
// text area is the same, at least 2.5 controls tall. Search has its glass
// inside the left edge. A count against a limit turns danger and bold past
// it (FieldHint's `isOver`).
//
//   TextField("you.bsky.social", text: $handle).virgaField()
//   TextEditor(text: $text).virgaTextArea()

#if canImport(UIKit)
import SwiftUI
import VirgaCore

/// How big a field is: the kit's medium, or the large one (46, its words
/// --text-md, as the front page's handle field).
public enum FieldSize: Sendable {
  case medium, large
}

struct FieldChrome: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  @FocusState private var focused: Bool
  let invalid: Bool
  let size: FieldSize
  let leading: CGFloat?
  let textArea: Bool

  func body(content: Content) -> some View {
    // A field in trouble declares its ring again, in the danger colour.
    let local: ResolvedTheme
    if invalid {
      let focus = theme.isHighContrast ? ThemeKit.highContrastInvalidFocus : ThemeKit.invalidFocus
      local = theme.tokens.declaring([(.focusRing, ThemeKit.invalidFocusRing), (.focus, focus)])
    } else {
      local = theme.tokens
    }
    let radius = theme.points(ThemeKit.inputRadius)
    let shape = RoundedRectangle(cornerRadius: radius)
    let padding = textArea ? theme.insets(ThemeKit.textAreaPadding) : theme.insets(size == .large ? ThemeKit.largeInputPadding : ThemeKit.inputPadding)
    let height = textArea
      ? theme.points(ThemeKit.textAreaMinHeight)
      : theme.points(size == .large ? ThemeKit.largeInputHeight : ThemeKit.touchInputHeight)
    let edge: Color
    if !isEnabled {
      edge = theme.line
    } else if focused {
      edge = (local.color(.focusRing) ?? .transparent).color
    } else if invalid {
      edge = theme.color(ThemeKit.invalidEdge)
    } else {
      edge = theme.color(ThemeKit.inputBorder)
    }
    let ring = local.shadow(.focus) ?? []
    return content
      .focused($focused)
      .virgaText(size: theme.points(ThemeKit.touchInputFontSize), lineHeight: textArea ? ThemeKit.textAreaLineHeight : nil)
      .foregroundStyle(isEnabled ? theme.ink : theme.muted)
      .tint(theme.accent)
      .padding(.leading, leading ?? padding.leading)
      .padding(.trailing, padding.trailing)
      .padding(.vertical, textArea ? padding.top : 0)
      .frame(minHeight: height, alignment: textArea ? .topLeading : .leading)
      .background(shape.fill(isEnabled ? theme.color(ThemeKit.inputFill) : theme.color(ThemeKit.disabledInputFill)))
      .overlay(shape.strokeBorder(edge, lineWidth: theme.points(ThemeKit.inputBorder)))
      .overlay {
        if focused {
          FocusRing(layers: ring, theme: local, radius: radius)
        }
      }
      .focusEffectDisabled()
      .animation(theme.motion.control, value: focused)
  }
}

/// `--focus`: box-shadow spreads round the field, each an outline of its
/// own width, drawn outside.
struct FocusRing: View {
  let layers: [ThemeShadowLayer]
  let theme: ResolvedTheme
  let radius: CGFloat

  var body: some View {
    ZStack {
      ForEach(Array(layers.enumerated().reversed()), id: \.offset) { _, layer in
        let spread = CGFloat(layer.spread?.points(in: theme.lengthContext) ?? 0)
        let colour = layer.color.flatMap { theme.color(of: $0) } ?? .transparent
        RoundedRectangle(cornerRadius: radius + spread)
          .inset(by: -spread)
          .strokeBorder(colour.color, lineWidth: spread)
      }
    }
    .allowsHitTesting(false)
  }
}

extension View {
  /// The kit's field round a TextField (or a SecureField, or a Picker).
  public func virgaField(invalid: Bool = false, size: FieldSize = .medium) -> some View {
    modifier(FieldChrome(invalid: invalid, size: size, leading: nil, textArea: false))
  }

  /// A field whose words start further in, for something drawn inside its
  /// leading edge (search's glass, the handle field's @).
  public func virgaField(invalid: Bool = false, size: FieldSize = .medium, leading: CGFloat) -> some View {
    modifier(FieldChrome(invalid: invalid, size: size, leading: leading, textArea: false))
  }

  /// The kit's text area round a TextEditor.
  public func virgaTextArea(invalid: Bool = false) -> some View {
    scrollContentBackground(.hidden)
      .modifier(FieldChrome(invalid: invalid, size: .medium, leading: nil, textArea: true))
  }
}

/// `.field`: a label over its control, 6 apart.
public struct FieldStack<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  private let label: String
  private let content: Content

  public init(_ label: String, @ViewBuilder content: () -> Content) {
    self.label = label
    self.content = content()
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: theme.points(ThemeKit.fieldGap)) {
      FieldLabel(label)
      content
    }
  }
}

/// `.field-label`: --text-sm, 600.
public struct FieldLabel: View {
  @Environment(\.virgaTheme) private var theme
  private let text: String

  public init(_ text: String) {
    self.text = text
  }

  public var body: some View {
    Text(text)
      .virgaText(size: theme.points(ThemeKit.fieldLabelFontSize), weight: ThemeKit.fieldLabelWeight)
      .foregroundStyle(theme.ink)
  }
}

/// `.field-hint`: muted words under a field; a count past its limit
/// (`isOver`) turns danger and bold.
public struct FieldHint: View {
  @Environment(\.virgaTheme) private var theme
  private let text: String
  private let isOver: Bool

  public init(_ text: String, isOver: Bool = false) {
    self.text = text
    self.isOver = isOver
  }

  public var body: some View {
    Text(text)
      .virgaText(.textSm, weight: isOver ? VirgaWeight.semibold : VirgaWeight.regular)
      .foregroundStyle(isOver ? theme.color(ThemeKit.overLimitInk) : theme.muted)
  }
}

/// `.search`: a field with its glass inside the left edge.
public struct SearchField: View {
  @Environment(\.virgaTheme) private var theme
  private let prompt: String
  @Binding private var text: String

  public init(_ prompt: String, text: Binding<String>) {
    self.prompt = prompt
    self._text = text
  }

  public var body: some View {
    ZStack(alignment: .leading) {
      TextField(prompt, text: $text)
        .virgaField(leading: theme.points(ThemeKit.searchInputLeading))
      Image(systemName: Glyph.search)
        .font(.system(size: Measure.Field.searchIcon))
        .foregroundStyle(theme.muted)
        .padding(.leading, theme.points(ThemeKit.searchIconInset))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
  }
}

#Preview("Fields") {
  VirgaPreviewHost {
    VStack(alignment: .leading, spacing: 16) {
      FieldStack("Name") {
        TextField("", text: .constant("Growth")).virgaField()
      }
      TextField("you.bsky.social", text: .constant("")).virgaField(invalid: true, size: .large)
      SearchField("Search", text: .constant(""))
      TextEditor(text: .constant("A text area")).virgaTextArea()
      FieldHint("280 of 300")
      FieldHint("312 of 300", isOver: true)
    }
    .padding()
  }
}
#endif
