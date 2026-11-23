// The software keyboard, for the UI tests that press a hardware keyboard's
// keys. Ports nothing: the web has no software keyboard of its own.
//
// XCUITest's typeKey sends a hardware key. On CI's iPad simulator the
// software keyboard shows, and iPadOS hides it as each such key arrives and
// brings it back about two seconds later; keys can be lost in that move
// (developer forums thread 849249). CI run 100's typing probe showed it: a ↓
// reached the post editor, and a Return pressed seven seconds later reached
// it by no route at all (no press, no key command, no insertText). A test
// that presses those keys launches with -VirgaNoSoftwareKeyboard YES, and
// the app's UIKit text fields (the post editor, KeyTextField) then take an
// empty input view, so no software keyboard comes up, as when a hardware
// keyboard is attached; another project's iPad UI tests do the same. The
// app's SwiftUI fields keep the system's keyboard. Nothing outside UI tests
// sets it.

#if canImport(UIKit)
import UIKit

@MainActor
enum SoftwareKeyboard {
  /// The tests' -VirgaNoSoftwareKeyboard YES.
  static let isOff = UserDefaults.standard.bool(forKey: "VirgaNoSoftwareKeyboard")

  /// The input view a UIKit text field takes: an empty one while the
  /// software keyboard is off, otherwise nil (the system's keyboard).
  static func inputView() -> UIView? {
    isOff ? UIView(frame: .zero) : nil
  }
}
#endif
