// The software keyboard, for the UI tests that press a hardware keyboard's
// keys. Ports nothing: the web has no software keyboard of its own.
//
// XCUITest's typeKey sends a hardware key. On CI's iPad simulator the
// software keyboard shows, and iPadOS hides it as each such key arrives and
// brings it back about two seconds later. In CI run 100 a Return in the post
// editor and an Escape in the language search reached their fields by no
// route at all (the post editor's typing probe saw no press, key command or
// insertText for the Return), while letters, an "n" and a ↓ pressed the same
// way arrived. Why isn't known; the likeliest suspect is that input
// switching, since keys typed while the software keyboard moves away are
// reported lost on devices (developer forums thread 849249). So a test that
// presses those keys launches with -VirgaNoSoftwareKeyboard YES, and the
// app's UIKit text fields (the post editor, KeyTextField) then take an empty
// input view, no shortcuts or suggestions in the bar above it, and no
// autocorrection or spell checking, so the input UI has nothing to show or
// switch. The app's SwiftUI fields keep the system's keyboard. Nothing
// outside UI tests sets the flag.

#if canImport(UIKit)
import UIKit

@MainActor
enum SoftwareKeyboard {
  /// The tests' -VirgaNoSoftwareKeyboard YES.
  static let isOff = UserDefaults.standard.bool(forKey: "VirgaNoSoftwareKeyboard")

  /// With the flag, the post editor takes no keyboard and no bar; without
  /// it, nothing changes.
  static func apply(to view: UITextView) {
    guard isOff else { return }
    view.inputView = UIView(frame: .zero)
    view.inputAssistantItem.leadingBarButtonGroups = []
    view.inputAssistantItem.trailingBarButtonGroups = []
    view.autocorrectionType = .no
    view.spellCheckingType = .no
  }

  /// With the flag, a UIKit text field (KeyTextField) takes no keyboard and
  /// no bar; without it, nothing changes.
  static func apply(to field: UITextField) {
    guard isOff else { return }
    field.inputView = UIView(frame: .zero)
    field.inputAssistantItem.leadingBarButtonGroups = []
    field.inputAssistantItem.trailingBarButtonGroups = []
    field.autocorrectionType = .no
    field.spellCheckingType = .no
  }
}
#endif
