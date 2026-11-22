// Ports src/shell/Shell.jsx (useNewPostShortcut)
//
// N on a hardware keyboard opens a new post, as the web's keydown listener
// does (shortcuts.js isNewPostShortcut): not with ⌘, ⌃ or ⌥ held (the
// shortcut's modifiers are none, which matches none of them; Shift makes
// the key N, which isn't the shortcut either), not while the composer is
// open, and not while anything else is presented over the window, the
// web's `dialog[open]` (on iOS the palette, the composer and every
// virgaDialog are sheets). Typing is left alone: a bare letter goes to the
// field with the caret before the window's key commands, and should one
// still arrive here while a field has the caret, the letter goes into the
// field rather than being lost.

#if canImport(UIKit)
import SwiftUI
import UIKit

/// The shortcut's button, out of sight in the shell's background (as ⌘K's is).
struct NewPostShortcut: View {
  @Environment(ComposerHost.self) private var composer: ComposerHost?
  @Environment(\.navigate) private var navigate
  let paletteOpen: Bool

  var body: some View {
    Button("New post") { press() }
      .keyboardShortcut("n", modifiers: [])
      .disabled(composer?.isOpen == true || paletteOpen)
      .opacity(0)
      .frame(width: 0, height: 0)
      .accessibilityHidden(true)
  }

  private func press() {
    if let field = KeyTargets.typingTarget() {
      field.insertText("n")
      return
    }
    if KeyTargets.isPresenting() { return }
    // As New post does: in place, over the page (Shell.jsx's composer.open({})).
    if let composer { composer.open() } else { navigate("/posting/compose") }
  }
}

/// Where a key press is going, read as it comes in: the web's
/// `event.target` (isTypingTarget) and `document.querySelector('dialog[open]')`.
@MainActor
enum KeyTargets {
  /// Whether a sheet, a dialog or an alert is up over the key window.
  static func isPresenting() -> Bool {
    guard let root = keyWindow()?.rootViewController else { return false }
    return presents(root)
  }

  /// The text field or text view with the caret, if one has it.
  static func typingTarget() -> UIKeyInput? {
    noted = nil
    UIApplication.shared.sendAction(#selector(UIResponder.virgaNoteFirstResponder), to: nil, from: nil, for: nil)
    defer { noted = nil }
    guard let responder = noted, responder is UITextInput else { return nil }
    return responder as? UIKeyInput
  }

  /// The first responder, as `virgaNoteFirstResponder` reports it.
  fileprivate static weak var noted: UIResponder?

  private static func presents(_ controller: UIViewController) -> Bool {
    if controller.presentedViewController != nil { return true }
    return controller.children.contains(where: presents)
  }

  private static func keyWindow() -> UIWindow? {
    let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
    return windows.first(where: \.isKeyWindow) ?? windows.first
  }
}

extension UIResponder {
  /// Sent to nil, this reaches the first responder, which notes itself.
  @objc fileprivate func virgaNoteFirstResponder() {
    KeyTargets.noted = self
  }
}
#endif
