// What a key press means, against the web code
// (ios/parity/cases/insights-early.shortcuts.js): every modifier
// combination against each kind of focus, in and out of a dialog, on a Mac
// and off one.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

@Suite struct ShortcutsParity {
  let fixture = "insights-early.shortcuts"

  func event(_ value: JSONValue, _ c: ParityCase) -> KeyEvent? {
    value.isNull ? nil : decoded(value, as: KeyEvent.self, c)
  }

  @Test func isTypingTarget() throws {
    for c in try Parity.cases(fixture, fn: "isTypingTarget") {
      let el = c["el"].isNull ? nil : decoded(c["el"], as: KeyTarget.self, c)
      expectOutput(.bool(Shortcuts.isTypingTarget(el)), c)
    }
  }

  @Test func isNewPostShortcut() throws {
    for c in try Parity.cases(fixture, fn: "isNewPostShortcut") {
      let actual = Shortcuts.isNewPostShortcut(event(c["event"], c), inDialog: c["inDialog"].boolValue ?? false)
      expectOutput(.bool(actual), c)
    }
  }

  @Test func isPaletteShortcut() throws {
    for c in try Parity.cases(fixture, fn: "isPaletteShortcut") {
      let actual = Shortcuts.isPaletteShortcut(
        event(c["event"], c), inDialog: c["inDialog"].boolValue ?? false, mac: c["mac"].boolValue!)
      expectOutput(.bool(actual), c)
    }
  }

  @Test func isMacPlatform() throws {
    for c in try Parity.cases(fixture, fn: "isMacPlatform") {
      let nav = c["nav"].isNull ? nil : decoded(c["nav"], as: Navigator.self, c)
      expectOutput(.bool(Shortcuts.isMacPlatform(nav)), c)
    }
  }

  @Test func labels() throws {
    for c in try Parity.cases(fixture, fn: "paletteShortcutLabel") {
      expectOutput(.string(Shortcuts.paletteShortcutLabel(c["mac"].boolValue!)), c)
    }
    for c in try Parity.cases(fixture, fn: "paletteShortcutAria") {
      expectOutput(.string(Shortcuts.paletteShortcutAria(c["mac"].boolValue!)), c)
    }
  }
}

@Suite struct ShortcutsBehaviour {
  @Test func theViewsTargetsMeanWhatTheySay() {
    #expect(Shortcuts.isTypingTarget(.textField))
    #expect(Shortcuts.isTypingTarget(.searchField))
    #expect(Shortcuts.isTypingTarget(.textEditor))
    #expect(!Shortcuts.isTypingTarget(.control))
    #expect(!Shortcuts.isTypingTarget(.page))
    #expect(Shortcuts.isNewPostShortcut(KeyEvent(key: "n")))
    #expect(!Shortcuts.isNewPostShortcut(KeyEvent(key: "n", target: .textField)))
    #expect(Shortcuts.isPaletteShortcut(KeyEvent(key: "k", metaKey: true, target: .textField), mac: true))
  }

  @Test func applePlatformsUseCommand() {
    #if os(macOS) || os(iOS) || os(visionOS)
      #expect(Shortcuts.isMacPlatform())
      #expect(Shortcuts.paletteShortcutLabel() == "⌘K")
    #else
      #expect(!Shortcuts.isMacPlatform())
      #expect(Shortcuts.paletteShortcutLabel() == "Ctrl K")
    #endif
  }
}
