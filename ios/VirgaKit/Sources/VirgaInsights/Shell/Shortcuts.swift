// Ports src/shell/shortcuts.js
//
// The keyboard shortcuts. "n" opens the composer: it must never fire while
// someone is typing, holding a modifier, or inside a dialog (the composer is
// one, and a letter typed into its search fields isn't a request for
// another post). ⌘K, or Ctrl K off a Mac, opens the command palette: a chord
// is never typing, so it works from inside a field, but not while another
// dialog is open.
//
// The web reads a DOM keydown event, its target element and the browser's
// navigator. Here those are values the view fills in: a `KeyEvent` from a
// hardware keyboard's key press, its `KeyTarget` from where focus is (a
// text field is an "input" of type "text", a text editor a "textarea"), and
// a `Navigator` for the platform. ios/parity/cases/insights-early.shortcuts
// .js holds each function to the web's over every modifier combination.

import Foundation
import VirgaCore

/// What has focus when a key is pressed: the web's event target, as far as
/// the shortcuts read it.
public struct KeyTarget: Codable, Hashable, Sendable {
  /// The element's tag ("INPUT", "TEXTAREA", "SELECT", "BUTTON", ...).
  public var tagName: String?
  /// An input's type ("text", "search", "checkbox", ...).
  public var type: String?
  public var isContentEditable: Bool?

  public init(tagName: String? = nil, type: String? = nil, isContentEditable: Bool? = nil) {
    self.tagName = tagName
    self.type = type
    self.isContentEditable = isContentEditable
  }

  /// Focus in a one-line text field.
  public static let textField = KeyTarget(tagName: "INPUT", type: "text")
  /// Focus in a search field.
  public static let searchField = KeyTarget(tagName: "INPUT", type: "search")
  /// Focus in a text editor.
  public static let textEditor = KeyTarget(tagName: "TEXTAREA")
  /// Focus on a control that takes no text (a button, a toggle).
  public static let control = KeyTarget(tagName: "BUTTON")
  /// Nothing in particular has focus.
  public static let page = KeyTarget(tagName: "BODY")
}

/// A key press, as the web's keydown event carries it.
public struct KeyEvent: Codable, Hashable, Sendable {
  /// The key's value ("n", "K", "Enter", "ArrowDown").
  public var key: String
  public var metaKey: Bool?
  public var ctrlKey: Bool?
  public var altKey: Bool?
  public var shiftKey: Bool?
  /// Held down, repeating.
  public var `repeat`: Bool?
  /// Part of an input method's composition.
  public var isComposing: Bool?
  /// Already handled by something else.
  public var defaultPrevented: Bool?
  public var target: KeyTarget?

  public init(
    key: String, metaKey: Bool = false, ctrlKey: Bool = false, altKey: Bool = false, shiftKey: Bool = false,
    repeat: Bool = false, isComposing: Bool = false, defaultPrevented: Bool = false, target: KeyTarget? = .page
  ) {
    self.key = key
    self.metaKey = metaKey
    self.ctrlKey = ctrlKey
    self.altKey = altKey
    self.shiftKey = shiftKey
    self.repeat = `repeat`
    self.isComposing = isComposing
    self.defaultPrevented = defaultPrevented
    self.target = target
  }
}

/// The browser's navigator, as far as `isMacPlatform` reads it.
public struct Navigator: Codable, Hashable, Sendable {
  public struct UserAgentData: Codable, Hashable, Sendable {
    public var platform: String?
    public init(platform: String? = nil) { self.platform = platform }
  }

  public var platform: String?
  public var userAgentData: UserAgentData?

  public init(platform: String? = nil, userAgentData: UserAgentData? = nil) {
    self.platform = platform
    self.userAgentData = userAgentData
  }

  /// This device's: an Apple platform says it is one, as Safari does
  /// ("iPhone", "iPad", "MacIntel"); anything else says nothing.
  public static var current: Navigator {
    #if os(iOS) || os(visionOS)
      return Navigator(platform: "iPhone")
    #elseif os(macOS)
      return Navigator(platform: "MacIntel")
    #else
      return Navigator()
    #endif
  }
}

public enum Shortcuts {
  static let textInputTypes: Set<String> = [
    "", "text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "month",
    "time", "week",
  ]

  /// Whether `el` takes typed text: a field, a text area, a select, or
  /// anything editable.
  public static func isTypingTarget(_ el: KeyTarget?) -> Bool {
    guard let el else { return false }
    if el.isContentEditable == true { return true }
    let tag = (el.tagName ?? "").jsLowercased()
    if tag == "textarea" || tag == "select" { return true }
    if tag == "input" { return textInputTypes.contains((el.type ?? "").jsLowercased()) }
    return false
  }

  /// Whether a key press is the new-post shortcut. `inDialog` says focus
  /// (or an open modal) is in a dialog; the shell works that out.
  public static func isNewPostShortcut(_ event: KeyEvent?, inDialog: Bool = false) -> Bool {
    guard let event, !(event.defaultPrevented ?? false), !(event.repeat ?? false),
      !(event.isComposing ?? false)
    else { return false }
    if event.metaKey == true || event.ctrlKey == true || event.altKey == true { return false }
    // By code units: Swift's == would take the Kelvin sign for "K" (see
    // JSStrings.swift), so every key is compared that way.
    if !event.key.jsEquals("n") && !event.key.jsEquals("N") { return false }
    if event.shiftKey == true && event.key.jsEquals("N") { return false }
    if inDialog { return false }
    return !isTypingTarget(event.target)
  }

  /// Whether this is a Mac (or an iPad with a keyboard), where ⌘ is the
  /// chord key.
  public static func isMacPlatform(_ nav: Navigator? = Navigator.current) -> Bool {
    let fromData = nav?.userAgentData?.platform ?? ""
    let platform = fromData.isEmpty ? (nav?.platform ?? "") : fromData
    // /mac|iphone|ipad|ipod/i: without the u flag, only ASCII letters fold.
    let units = platform.utf16.map { $0 >= 0x41 && $0 <= 0x5A ? $0 + 0x20 : $0 }
    let lower = String(jsUnits: units)
    return ["mac", "iphone", "ipad", "ipod"].contains { lower.jsIndexOf($0) != -1 }
  }

  /// The palette's shortcut as it is shown: "⌘K" on a Mac, "Ctrl K" elsewhere.
  public static func paletteShortcutLabel(_ mac: Bool = isMacPlatform()) -> String {
    mac ? "⌘K" : "Ctrl K"
  }

  /// The same, as an accessibility shortcut is written ("Meta+K").
  public static func paletteShortcutAria(_ mac: Bool = isMacPlatform()) -> String {
    mac ? "Meta+K" : "Control+K"
  }

  /// Whether a key press is the command palette's shortcut: K with ⌘ on a
  /// Mac, with Ctrl elsewhere, and no other modifier. On a Mac, Ctrl K is
  /// left alone: in a text field it deletes to the end of the line. Focus
  /// in a field doesn't matter. `inDialog` says a dialog other than the
  /// palette is open (the composer, a confirmation): the palette stays out
  /// of its way.
  public static func isPaletteShortcut(_ event: KeyEvent?, inDialog: Bool = false, mac: Bool = isMacPlatform())
    -> Bool
  {
    guard let event, !(event.defaultPrevented ?? false), !(event.repeat ?? false),
      !(event.isComposing ?? false)
    else { return false }
    if !event.key.jsEquals("k") && !event.key.jsEquals("K") { return false }
    if event.altKey == true || event.shiftKey == true { return false }
    let meta = event.metaKey == true
    let ctrl = event.ctrlKey == true
    let chord = mac ? meta && !ctrl : ctrl && !meta
    if !chord { return false }
    return !inDialog
  }
}
