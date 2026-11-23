// UI tests only. `-VirgaTypingProbe YES` (read from UserDefaults' argument
// domain, as `-VirgaDemo YES` is) records, for each text field that reports
// here, what reached it while typing and what the app wrote to it, and hands
// that to the UI tests as the value of a hidden element, "typing-probe".
// `-VirgaTypingBench YES` (implies the probe) adds what
// ComposerUITests.testTypingBench compares: a bare UITextView above the
// composer's scroll ("typing-probe-plain"), the second post without the "@"
// typeahead, and each of the three emptied as it loses focus. Without either
// argument nothing here records and nothing is drawn.
//
// A field's record, kept since it was last empty: `presses`, the characters
// of the key presses it saw; `keys`, what insertText was called with;
// `asked`, the plain insertions at the end its delegate approved; `gaps`, the
// milliseconds between keys; and `events`, each ending in "@" and the number
// of keys so far:
//   L+, L-        the "@" list appeared, disappeared
//   y<pt>         the field moved in the window (a scroll, an iPad's sheet)
//   U<branch>     an updateUIView ran while UIKit was part way through an
//                 edit: Uahead, Usame, or Ureset (the guard failed)
//   R<field>><model>  the app put the post's text back (lengths)
//   S<n>          the app set the selection
//   X<loc>,<len>="..."  the keyboard asked for a replacement (a correction)
//   D!<asked>><got>     after UIKit's edit the field isn't what it asked
//                       for (lengths)
// Its `totals` are kept since launch.
//
// Whether the keyboard's letters come in through insertText isn't known. If
// none does, the gaps and the count of keys are taken from the delegate's
// approved insertions instead, and `keys` and `totals.keys` stay empty.

#if canImport(UIKit)
import QuartzCore
import SwiftUI
import UIKit

@MainActor
enum TypingProbe {
  static let isBench = UserDefaults.standard.bool(forKey: "VirgaTypingBench")
  static let isOn = isBench || UserDefaults.standard.bool(forKey: "VirgaTypingProbe")

  /// The bench's second post: no "@" lookups and no list of accounts.
  static func quiet(_ index: Int) -> Bool { isBench && index == 1 }

  struct Field {
    // Since the field was last empty.
    var presses = ""
    var keys = ""
    var asked = ""
    var gaps: [Int] = []
    var events: [String] = []
    /// What the field should read once UIKit's edit is done.
    var pending: String?
    var lastKey: CFTimeInterval = 0
    var lastY: Int?
    // Since launch.
    var totals: [String: Int] = [:]

    /// The keys so far: insertText's, or the delegate's when insertText
    /// isn't on the keyboard's way in.
    var count: Int { max(keys.utf16.count, asked.utf16.count) }

    mutating func emptied() {
      presses = ""
      keys = ""
      asked = ""
      gaps = []
      events = []
      pending = nil
      lastKey = 0
      lastY = nil
    }

    mutating func bump(_ key: String, by n: Int = 1) { totals[key, default: 0] += n }

    mutating func note(_ event: String) {
      events.append("\(event)@\(count)")
      if events.count > 400 { events.removeFirst(events.count - 400) }
    }
  }

  static var fields: [String: Field] = [:]

  static func note(_ id: String, _ event: String) {
    guard isOn else { return }
    fields[id, default: Field()].note(event)
  }

  static func emptied(_ id: String) {
    guard isOn else { return }
    fields[id, default: Field()].emptied()
  }

  static func count(_ id: String, _ key: String) {
    guard isOn else { return }
    fields[id, default: Field()].bump(key)
  }

  static func press(_ id: String, _ characters: String) {
    guard isOn, !characters.isEmpty else { return }
    fields[id, default: Field()].presses += characters
  }

  /// UITextInput's insertText, the way typed letters come in.
  static func insert(_ id: String, _ text: String, in view: UIView) {
    guard isOn else { return }
    var field = fields[id, default: Field()]
    tick(&field, view)
    field.keys += text
    field.bump("keys")
    fields[id] = field
  }

  /// The delegate's shouldChangeTextIn, which approves every edit.
  static func shouldChange(_ id: String, in view: UITextView, range: NSRange, text: String) {
    guard isOn else { return }
    var field = fields[id, default: Field()]
    let current = (view.text ?? "") as NSString
    if range.length == 0, range.location == current.length {
      // No insertText seen since the field was empty: the key is timed here.
      if field.keys.isEmpty { tick(&field, view) }
      field.asked += text
    } else {
      field.note("X\(range.location),\(range.length)=\(text.debugDescription)")
      field.bump("replacements")
    }
    field.pending = current.replacingCharacters(in: range, with: text)
    fields[id] = field
  }

  /// The delegate's textViewDidChange, once UIKit's edit is done.
  static func didChange(_ id: String, in view: UITextView) {
    guard isOn else { return }
    var field = fields[id, default: Field()]
    let now = view.text ?? ""
    if let pending = field.pending, pending != now {
      field.note("D!\(pending.utf16.count)>\(now.utf16.count)")
      field.bump("diverged")
    }
    field.pending = nil
    if now.isEmpty { field.emptied() }
    fields[id] = field
  }

  /// One updateUIView: `editing` is true between shouldChangeTextIn and
  /// textViewDidChange; `branch` is "same", "reset" or "ahead".
  static func update(_ id: String, editing: Bool, branch: String, field length: Int, model: Int) {
    guard isOn else { return }
    var field = fields[id, default: Field()]
    field.bump("updates")
    if editing {
      field.bump("midEditUpdates")
      field.note("U\(branch)")
    }
    if branch == "reset", model == 0 {
      // The bench emptying a field it left, or the post cleared.
      field.emptied()
    } else if branch == "reset" {
      field.bump(editing ? "midEditResets" : "resets")
      field.note("R\(length)>\(model)")
    }
    fields[id] = field
  }

  /// A key's gap since the one before, and the field's place in the window
  /// (an iPad's fitted sheet moves it as the composer grows).
  private static func tick(_ field: inout Field, _ view: UIView) {
    let now = CACurrentMediaTime()
    if field.lastKey > 0 {
      let gap = Int(((now - field.lastKey) * 1000).rounded())
      field.gaps.append(gap)
      if gap > 100 { field.bump("longGaps") }
      field.totals["maxGapMs"] = max(field.totals["maxGapMs"] ?? 0, gap)
    }
    field.lastKey = now
    // The top of its frame, not of its scrolled content.
    let y = Int(view.convert(view.bounds.origin, to: nil).y.rounded())
    if field.lastY != y {
      if field.lastY != nil { field.note("y\(y)") }
      field.lastY = y
    }
  }

  /// Every field's record, as JSON.
  static func report() -> String {
    var out: [String: Any] = [:]
    for (id, field) in fields {
      out[id] = [
        "presses": field.presses, "keys": field.keys, "asked": field.asked, "gaps": field.gaps,
        "events": field.events, "totals": field.totals,
      ]
    }
    guard let data = try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]) else { return "{}" }
    return String(decoding: data, as: UTF8.self)
  }
}

/// The hidden element the UI tests read the record from, worked out as it
/// is read, so a key costs no redraw.
struct TypingProbeElement: UIViewRepresentable {
  func makeUIView(context: Context) -> TypingProbeReportView {
    TypingProbeReportView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
  }

  func updateUIView(_ view: TypingProbeReportView, context: Context) {}
}

final class TypingProbeReportView: UIView {
  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    isAccessibilityElement = true
    accessibilityIdentifier = "typing-probe"
    accessibilityLabel = "Typing probe"
  }

  required init?(coder: NSCoder) {
    return nil
  }

  override var accessibilityValue: String? {
    // Read by the accessibility system, on the main thread.
    get {
      guard Thread.isMainThread else { return nil }
      return MainActor.assumeIsolated { TypingProbe.report() }
    }
    set {}
  }
}

/// The bench's plain field: a UITextView with the post editor's keyboard
/// (sentences, spell checking, the default autocorrection) and nothing of
/// the composer's: no binding, no redraws, no attributes, no typeahead.
struct TypingProbePlainField: UIViewRepresentable {
  static let identifier = "typing-probe-plain"

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIView(context: Context) -> TypingProbeTextView {
    let view = TypingProbeTextView()
    view.delegate = context.coordinator
    view.accessibilityIdentifier = Self.identifier
    view.autocapitalizationType = .sentences
    view.spellCheckingType = .yes
    view.font = UIFont.systemFont(ofSize: 17, weight: .medium)
    view.backgroundColor = .secondarySystemBackground
    return view
  }

  func updateUIView(_ view: TypingProbeTextView, context: Context) {}

  final class Coordinator: NSObject, UITextViewDelegate {
    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
      TypingProbe.shouldChange(TypingProbePlainField.identifier, in: textView, range: range, text: text)
      return true
    }

    func textViewDidChange(_ textView: UITextView) {
      TypingProbe.didChange(TypingProbePlainField.identifier, in: textView)
    }

    func textViewDidEndEditing(_ textView: UITextView) {
      textView.text = ""
      TypingProbe.emptied(TypingProbePlainField.identifier)
    }
  }
}

final class TypingProbeTextView: UITextView {
  override func insertText(_ text: String) {
    if let id = accessibilityIdentifier { TypingProbe.insert(id, text, in: self) }
    super.insertText(text)
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    if let id = accessibilityIdentifier { TypingProbe.press(id, presses.compactMap { $0.key?.characters }.joined()) }
    super.pressesBegan(presses, with: event)
  }
}
#endif
