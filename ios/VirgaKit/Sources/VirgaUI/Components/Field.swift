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
// it (FieldHint's `isOver`). A placeholder is --muted (`.input::placeholder`),
// which only a TextField built with its prompt can say: VirgaTextField and
// SearchField are. A select (`select.input`) is VirgaSelect: its value in
// ink at the field's start, on one line, a chevron in --ink-2 at its end.
//
//   VirgaTextField("you.bsky.social", text: $handle).virgaField()
//   TextEditor(text: $text).virgaTextArea()
//   VirgaSelect("Week starts on", selection: $start, options: [SelectChoice(.monday, "Week starts Monday"), …])

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
  /// A text area round a TextEditor, whose text view keeps insets of its
  /// own; a `TextField(axis: .vertical)` keeps none.
  var editorInset = false

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
    var padding = textArea ? theme.insets(ThemeKit.textAreaPadding) : theme.insets(size == .large ? ThemeKit.largeInputPadding : ThemeKit.inputPadding)
    if textArea && editorInset {
      // A TextEditor keeps its text view's own insets inside it; the field
      // gives only the rest, so the words start where the web's do.
      let own = Measure.Field.textEditorInset
      padding = EdgeInsets(
        top: max(0, padding.top - own.top), leading: max(0, padding.leading - own.leading),
        bottom: max(0, padding.bottom - own.bottom), trailing: max(0, padding.trailing - own.trailing))
    }
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
  /// The kit's field round a TextField or a SecureField (a select is
  /// VirgaSelect, whose value a Picker would draw in the accent, centred).
  public func virgaField(invalid: Bool = false, size: FieldSize = .medium) -> some View {
    modifier(FieldChrome(invalid: invalid, size: size, leading: nil, textArea: false))
  }

  /// A field whose words start further in, for something drawn inside its
  /// leading edge (search's glass, the handle field's @).
  public func virgaField(invalid: Bool = false, size: FieldSize = .medium, leading: CGFloat) -> some View {
    modifier(FieldChrome(invalid: invalid, size: size, leading: leading, textArea: false))
  }

  /// The kit's text area round a TextEditor, or, with `editor: false`, round
  /// a `TextField(axis: .vertical)`: an editor's own text view keeps 8 above
  /// and below and 5 at the sides, which the field's padding leaves out; a
  /// vertical TextField keeps none, so it takes the whole padding.
  public func virgaTextArea(invalid: Bool = false, editor: Bool = true) -> some View {
    scrollContentBackground(.hidden)
      .modifier(FieldChrome(invalid: invalid, size: .medium, leading: nil, textArea: true, editorInset: editor))
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

/// A TextField whose placeholder is --muted (`.input::placeholder { color:
/// var(--muted); opacity: 1 }`), not the system's pale grey. Put the field
/// round it as for any TextField: `VirgaTextField("Name", text: $name).virgaField()`.
public struct VirgaTextField: View {
  @Environment(\.virgaTheme) private var theme
  private let prompt: String
  @Binding private var text: String
  private let axis: Axis

  /// - Parameter axis: `.vertical` for words that may run onto more lines.
  public init(_ prompt: String, text: Binding<String>, axis: Axis = .horizontal) {
    self.prompt = prompt
    self._text = text
    self.axis = axis
  }

  public var body: some View {
    TextField(prompt, text: $text, prompt: Text(prompt).foregroundStyle(theme.muted), axis: axis)
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
      VirgaTextField(prompt, text: $text)
        .virgaField(leading: theme.points(ThemeKit.searchInputLeading))
      Image(systemName: Glyph.search)
        .virgaGlyph(Measure.Field.searchIcon, beside: theme.points(ThemeKit.touchInputFontSize))
        .foregroundStyle(theme.muted)
        .padding(.leading, theme.points(ThemeKit.searchIconInset))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
  }
}

/// One of a select's choices: its value and its words.
public struct SelectChoice<Value: Hashable>: Identifiable {
  public var value: Value
  public var label: String

  public var id: Value { value }

  public init(_ value: Value, _ label: String) {
    self.value = value
    self.label = label
  }
}

/// `select.input`: the field with the chosen value's words in ink at its
/// start, on one line, and a chevron in --ink-2 at its end (the web's
/// 5-point one, 11 in from the edge). A press opens the choices as the
/// system's menu, the chosen one ticked.
public struct VirgaSelect<Value: Hashable>: View {
  @Environment(\.virgaTheme) private var theme
  private let label: String
  @Binding private var selection: Value
  private let options: [SelectChoice<Value>]
  private let size: FieldSize
  private let invalid: Bool

  /// - Parameter label: the select's name, for VoiceOver (its field label).
  public init(
    _ label: String, selection: Binding<Value>, options: [SelectChoice<Value>], size: FieldSize = .medium, invalid: Bool = false
  ) {
    self.label = label
    self._selection = selection
    self.options = options
    self.size = size
    self.invalid = invalid
  }

  public var body: some View {
    let current = options.first { $0.value == selection }?.label ?? ""
    Menu {
      Picker(label, selection: $selection) {
        ForEach(options) { option in
          Text(option.label).tag(option.value)
        }
      }
      .pickerStyle(.inline)
      .labelsHidden()
    } label: {
      SelectFieldFace(current: current)
        .virgaField(invalid: invalid, size: size)
    }
    .menuOrder(.fixed)
    .accessibilityLabel(label)
    .accessibilityValue(current)
  }
}

/// What a select shows: its value, then the chevron at the end.
struct SelectFieldFace: View {
  @Environment(\.virgaTheme) private var theme
  let current: String

  var body: some View {
    HStack(spacing: 0) {
      Text(current)
        .lineLimit(1)
        .foregroundStyle(theme.ink)
      Spacer(minLength: Measure.Field.selectChevronGap)
      Image(systemName: Glyph.chevronDown)
        .virgaGlyph(Measure.Field.selectChevron, weight: .semibold)
        .foregroundStyle(theme.ink2)
        .padding(.trailing, Measure.Field.selectChevronInset - theme.points(ThemeKit.inputPadding.right))
        .accessibilityHidden(true)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(Rectangle())
  }
}

#Preview("Fields") {
  VirgaPreviewHost {
    VStack(alignment: .leading, spacing: 16) {
      FieldStack("Name") {
        TextField("", text: .constant("Growth")).virgaField()
      }
      VirgaTextField("you.bsky.social", text: .constant("")).virgaField(invalid: true, size: .large)
      VirgaSelect(
        "Week starts on", selection: .constant(1),
        options: [SelectChoice(0, "Week starts as in this region (Sunday)"), SelectChoice(1, "Week starts Monday")])
      SearchField("Search", text: .constant(""))
      TextEditor(text: .constant("A text area")).virgaTextArea()
      FieldHint("280 of 300")
      FieldHint("312 of 300", isOver: true)
    }
    .padding()
  }
}
#endif
