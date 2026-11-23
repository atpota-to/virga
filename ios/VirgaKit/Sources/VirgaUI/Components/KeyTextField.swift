// Ports src/styles/controls.css (.input, for a field that hands its keys on)
// Ports src/posting/composer/LanguagePicker.jsx (the search field's onKeyDown)
//
// The web's combobox fields read ↑, ↓, Enter and Escape in their onKeyDown
// and call preventDefault, so the list has those keys before the input
// does, and every other key is the input's. KeyTextField is that field on
// iOS: a one-line UITextField whose hardware ↑, ↓, Return and Escape go to
// what holds it while it takes them (`keys`), and to the field otherwise.
// It is drawn as VirgaTextField is inside `.virgaField()`: the field's type
// (16, grown with Dynamic Type), ink words (--muted while disabled), a
// --muted placeholder, the accent's caret, and no edge of its own; the
// field round it is `.virgaField(focused:)`, told the focus SwiftUI can't
// see in a UIKit field.
//
// It isn't SwiftUI's TextField with .onKeyPress because on CI's iPad (run
// 99, iPadOS 26.5) the language search's `.onKeyPress(.escape)` never fired,
// while the post editor's UIKit key command took ↓. So a key reaches what
// holds the field by whichever of three ways comes first: the field's own
// pressesBegan, which sees a press before the field's text handling does
// (a press it takes goes no further in any of its phases); key commands
// that ask for priority over the system's use of the key
// (wantsPriorityOverSystemBehavior), as the post editor's ↓ does; and, for
// Return, the field's delegate (textFieldShouldReturn), which a phone's
// Return reaches as well. The same key by another way within a quarter
// second is the same press, already taken, however UIKit orders the three.
// Return never ends the field's editing: the web's Enter leaves the caret
// in the field. While an input method is composing (marked text), every key
// is the field's. Inline predictions are off, as Apple advises for a field
// with suggestions of its own: one may show as marked text, which would
// leave the keys to the field.

#if canImport(UIKit)
import SwiftUI
import UIKit
import VirgaCore

/// A key a KeyTextField can hand to what holds it.
enum FieldKey: Hashable, Sendable {
  case up, down, enter, escape

  /// A combobox's keys, while its list has rows.
  static let all: Set<FieldKey> = [.up, .down, .enter, .escape]
}

/// A one-line text field whose hardware ↑, ↓, Return and Escape go first to
/// what holds it while it takes them (`keys`), a phone's Return too, and to
/// the field otherwise. Put the field round it, told the same focus:
///
///   KeyTextField("Add a language", text: $query, focused: $focused, label: "Languages",
///                keys: options.isEmpty ? [] : FieldKey.all) { key in … }
///     .virgaField(focused: focused)
struct KeyTextField: UIViewRepresentable {
  let prompt: String
  @Binding var text: String
  /// Whether the field has the keyboard: the field says so as it gains and
  /// loses it, and a change from SwiftUI's side asks it to take or let go.
  @Binding var focused: Bool
  /// Its name for VoiceOver (and for UI tests, `app.textFields[label]`).
  let label: String
  var identifier: String?
  /// The keys what holds the field takes now.
  var keys: Set<FieldKey>
  var autocorrect: Bool
  var capitalization: UITextAutocapitalizationType
  /// A press on the field, whether or not it has the keyboard yet (the
  /// web's onClick).
  var onPress: () -> Void
  /// One of `keys`, pressed: true when it was taken. Asked at the moment of
  /// the key, so it should read what holds the field as it is then.
  var onKey: (FieldKey) -> Bool

  init(
    _ prompt: String, text: Binding<String>, focused: Binding<Bool>, label: String, identifier: String? = nil,
    keys: Set<FieldKey>, autocorrect: Bool = false, capitalization: UITextAutocapitalizationType = .none,
    onPress: @escaping () -> Void = {}, onKey: @escaping (FieldKey) -> Bool
  ) {
    self.prompt = prompt
    self._text = text
    self._focused = focused
    self.label = label
    self.identifier = identifier
    self.keys = keys
    self.autocorrect = autocorrect
    self.capitalization = capitalization
    self.onPress = onPress
    self.onKey = onKey
  }

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeUIView(context: Context) -> KeyField {
    let field = KeyField()
    field.delegate = context.coordinator
    field.borderStyle = .none
    field.backgroundColor = .clear
    // The theme scales the type with Dynamic Type itself (KeyFieldStyle).
    field.adjustsFontForContentSizeCategory = false
    field.spellCheckingType = .no
    field.smartQuotesType = .no
    field.smartDashesType = .no
    field.smartInsertDeleteType = .no
    field.inlinePredictionType = .no
    // The UI tests that press hardware keys run with no software keyboard
    // (SoftwareKeyboard); nil, the system's keyboard, otherwise.
    field.inputView = SoftwareKeyboard.inputView()
    // The field round it draws the focus (`.virgaField(focused:)`).
    field.focusEffect = nil
    field.setContentHuggingPriority(.defaultLow, for: .horizontal)
    field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    field.addTarget(context.coordinator, action: #selector(Coordinator.edited(_:)), for: .editingChanged)
    // A press alongside the field's own handling of it, which it neither
    // waits for nor cancels.
    let press = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pressed(_:)))
    press.cancelsTouchesInView = false
    press.delaysTouchesEnded = false
    press.delegate = context.coordinator
    field.addGestureRecognizer(press)
    field.text = text
    return field
  }

  func updateUIView(_ field: KeyField, context: Context) {
    let coordinator = context.coordinator
    coordinator.parent = self
    let enabled = context.environment.isEnabled
    let style = KeyFieldStyle(theme: context.environment.virgaTheme, enabled: enabled)
    if coordinator.drawn != style || coordinator.prompt != prompt {
      field.font = style.font
      field.textColor = style.ink
      field.attributedPlaceholder = NSAttributedString(
        string: prompt, attributes: [.font: style.font, .foregroundColor: style.placeholder])
      coordinator.drawn = style
      coordinator.prompt = prompt
    }
    // The caret and selection; set each time, should SwiftUI's own tint
    // have reached the field since.
    if field.tintColor != style.tint { field.tintColor = style.tint }
    coordinator.enabled = enabled
    // One with the keyboard is disabled once it has let it go (below).
    if enabled || !field.isFirstResponder { field.isEnabled = enabled }
    field.autocorrectionType = autocorrect ? .yes : .no
    field.autocapitalizationType = capitalization
    field.accessibilityLabel = label
    field.accessibilityIdentifier = identifier
    field.keys = keys
    field.onKey = onKey
    // The field's own typing is in the binding already (`edited`), so a
    // binding that differs was changed by what holds the field (a search
    // emptied as its pick is added). Only then is the text set, which puts
    // the caret at its end.
    if (field.text ?? "") != text {
      field.text = text
    }
    if !enabled {
      // A disabled field lets the keyboard go, as SwiftUI's does, after
      // this update, and only then is disabled: a field disabled while it
      // has the keyboard may let it go at once, which would tell SwiftUI
      // its focus in the middle of the update (the language search, as its
      // third language is added). Should it be enabled again first, it
      // keeps the keyboard.
      if field.isFirstResponder {
        DispatchQueue.main.async {
          guard !coordinator.enabled else { return }
          _ = field.resignFirstResponder()
          field.isEnabled = false
        }
      }
    } else if focused != coordinator.reported {
      // Asked from SwiftUI's side; the field's own changes are reported
      // before the binding is set, so they don't come back here.
      let wanted = focused
      DispatchQueue.main.async {
        if wanted, !field.isFirstResponder, field.window != nil {
          _ = field.becomeFirstResponder()
        } else if !wanted, field.isFirstResponder {
          _ = field.resignFirstResponder()
        }
        // One it couldn't take or let go of: the binding hears where it is.
        if field.isFirstResponder != wanted { coordinator.report(field.isFirstResponder) }
      }
    }
  }

  /// As wide as it is offered (a text field takes the row), as tall as its
  /// line; the field round it gives it its height and edges.
  func sizeThatFits(_ proposal: ProposedViewSize, uiView field: KeyField, context: Context) -> CGSize? {
    let natural = field.intrinsicContentSize
    let offered = proposal.width.flatMap { $0.isFinite ? $0 : nil }
    return CGSize(width: offered ?? natural.width, height: natural.height)
  }

  @MainActor
  final class Coordinator: NSObject, UITextFieldDelegate, UIGestureRecognizerDelegate {
    var parent: KeyTextField
    /// Whether the field last said it had the keyboard.
    var reported = false
    /// Whether SwiftUI last had the field enabled.
    var enabled = true
    /// What the field's type and colours were last set from.
    var drawn: KeyFieldStyle?
    var prompt: String?

    init(_ parent: KeyTextField) {
      self.parent = parent
    }

    @objc func edited(_ field: UITextField) {
      let now = field.text ?? ""
      if parent.text != now { parent.text = now }
    }

    @objc func pressed(_ recognizer: UITapGestureRecognizer) {
      // A disabled field's recognizer still sees the press; the field doesn't.
      if let field = recognizer.view as? UITextField, !field.isEnabled { return }
      parent.onPress()
    }

    func textFieldDidBeginEditing(_ field: UITextField) {
      report(true)
    }

    func textFieldDidEndEditing(_ field: UITextField) {
      report(false)
    }

    func report(_ now: Bool) {
      reported = now
      if parent.focused != now { parent.focused = now }
    }

    /// Return, from a phone's keyboard or a hardware one that neither
    /// pressesBegan nor a key command took first: what holds the field has
    /// it if it takes it. Either way the field keeps the keyboard, as the
    /// web's field keeps the caret on Enter.
    func textFieldShouldReturn(_ field: UITextField) -> Bool {
      _ = (field as? KeyField)?.take(.enter, by: .delegate)
      return false
    }

    func gestureRecognizer(
      _ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool {
      true
    }
  }
}

/// The field's type and colours: `.input`'s, as VirgaTextField draws them
/// inside `.virgaField()`. Two are equal when they draw the same.
struct KeyFieldStyle: Equatable {
  var font: UIFont
  var ink: UIColor
  var placeholder: UIColor
  var tint: UIColor

  @MainActor
  init(theme: VirgaTheme, enabled: Bool) {
    // The touch field's 16, grown with Dynamic Type for its text style,
    // in tabular figures (FieldChrome's virgaText(size:)).
    let size = theme.scaled(theme.points(ThemeKit.touchInputFontSize))
    if theme.hasTypeface, let face = VirgaTypeface.face(size: size, weight: VirgaWeight.regular) {
      font = unsafeBitCast(face, to: UIFont.self)
    } else {
      font = UIFont.monospacedDigitSystemFont(ofSize: size, weight: .regular)
    }
    // `.input:disabled` is --muted; `.input::placeholder` is --muted always.
    ink = UIColor(enabled ? theme.ink : theme.muted)
    placeholder = UIColor(theme.muted)
    tint = UIColor(theme.accent)
  }
}

/// The text field inside a KeyTextField: hands ↑, ↓, Return and Escape to
/// what holds it while it takes them, by the first of three ways (above).
final class KeyField: UITextField {
  /// How a key reached the field.
  enum Way {
    case press, command, delegate
  }

  /// The keys what holds the field takes now, and what it does with one.
  var keys: Set<FieldKey> = []
  var onKey: ((FieldKey) -> Bool)?
  /// Presses taken in pressesBegan: their later phases go no further either.
  private var taken: Set<UIPress> = []
  /// The last key taken, the way it came and when.
  private var last: (key: FieldKey, way: Way, at: TimeInterval)?

  /// Within this, the same key by another way is the same press.
  static let samePress: TimeInterval = 0.25

  /// Hands `key` on, unless it is the press another way just took: true
  /// when it was taken (now or by that other way). A key what holds the
  /// field doesn't take now is the field's, even one pressed just after a
  /// press it took (a second Escape, once the first has closed the list).
  @discardableResult
  func take(_ key: FieldKey, by way: Way) -> Bool {
    guard markedTextRange == nil, keys.contains(key) else { return false }
    let now = ProcessInfo.processInfo.systemUptime
    if let last, last.key == key, last.way != way, now - last.at < Self.samePress { return true }
    guard let onKey, onKey(key) else { return false }
    last = (key, way, now)
    return true
  }

  // MARK: Presses

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    taken = taken.filter { $0.phase != .ended && $0.phase != .cancelled }
    var rest = Set<UIPress>()
    for press in presses {
      if let key = Self.fieldKey(press), take(key, by: .press) {
        taken.insert(press)
      } else {
        rest.insert(press)
      }
    }
    if !rest.isEmpty { super.pressesBegan(rest, with: event) }
  }

  override func pressesChanged(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let rest = presses.subtracting(taken)
    if !rest.isEmpty { super.pressesChanged(rest, with: event) }
  }

  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let rest = presses.subtracting(taken)
    taken.subtract(presses)
    if !rest.isEmpty { super.pressesEnded(rest, with: event) }
  }

  override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let rest = presses.subtracting(taken)
    taken.subtract(presses)
    if !rest.isEmpty { super.pressesCancelled(rest, with: event) }
  }

  /// The key a press is, if it is one of the four: an arrow with anything
  /// held (the web reads none), Return (either one, and the keypad's
  /// Enter) and Escape with nothing held but ⇧. A press without a key (the
  /// semantic twin some keys also send) is the field's.
  private static func fieldKey(_ press: UIPress) -> FieldKey? {
    guard let key = press.key else { return nil }
    let held = key.modifierFlags.intersection([.command, .control, .alternate])
    switch key.keyCode {
    case .keyboardUpArrow: return .up
    case .keyboardDownArrow: return .down
    case .keyboardReturnOrEnter, .keyboardReturn, .keypadEnter: return held.isEmpty ? .enter : nil
    case .keyboardEscape: return held.isEmpty ? .escape : nil
    default: return nil
    }
  }

  // MARK: Key commands

  override var keyCommands: [UIKeyCommand]? {
    let own = super.keyCommands ?? []
    guard markedTextRange == nil, !keys.isEmpty else { return own }
    var commands: [UIKeyCommand] = []
    if keys.contains(.up) {
      for flags in Self.arrowModifiers {
        commands.append(Self.command(UIKeyCommand.inputUpArrow, flags, #selector(commandUp)))
      }
    }
    if keys.contains(.down) {
      for flags in Self.arrowModifiers {
        commands.append(Self.command(UIKeyCommand.inputDownArrow, flags, #selector(commandDown)))
      }
    }
    if keys.contains(.enter) {
      commands.append(Self.command("\r", [], #selector(commandEnter)))
      commands.append(Self.command("\r", .shift, #selector(commandEnter)))
    }
    if keys.contains(.escape) {
      commands.append(Self.command(UIKeyCommand.inputEscape, [], #selector(commandEscape)))
      commands.append(Self.command(UIKeyCommand.inputEscape, .shift, #selector(commandEscape)))
    }
    return commands + own
  }

  private static let arrowModifiers: [UIKeyModifierFlags] = [[], .shift, .alternate, .command, .control]

  private static func command(_ input: String, _ flags: UIKeyModifierFlags, _ action: Selector) -> UIKeyCommand {
    let command = UIKeyCommand(input: input, modifierFlags: flags, action: action)
    command.wantsPriorityOverSystemBehavior = true
    return command
  }

  @objc private func commandUp() { take(.up, by: .command) }
  @objc private func commandDown() { take(.down, by: .command) }
  @objc private func commandEnter() { take(.enter, by: .command) }
  @objc private func commandEscape() { take(.escape, by: .command) }
}
#endif
