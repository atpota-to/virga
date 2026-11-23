// UI tests only. `-VirgaTypingProbe YES` (read from UserDefaults' argument
// domain, as `-VirgaDemo YES` is) records, for each text field that reports
// here, what reached it while typing and what the app wrote to it, and hands
// that to the UI tests as the value of a hidden element, "typing-probe".
// Without it nothing here records and nothing is drawn. (Runs 88 to 92 also
// had a bench, -VirgaTypingBench, comparing the composer with a bare text
// view; notes/ui.md has what it found.)
//
// A field's record, kept since it was last empty: `presses`, the characters
// of the key presses it saw; `keys`, what insertText was called with;
// `asked`, the plain insertions at the end its delegate approved; `gaps`, the
// milliseconds between keys; and `events`, each ending in "@" and the number
// of keys so far:
//   L+, L-        the "@" list appeared, disappeared
//   y<pt>         the field moved in the window (a scroll, an iPad's sheet)
//   h<pt>         the field's height changed (it grew a line at a wrap)
//   o<pt>         the scroll it sits in moved (that scroll's content offset)
//   U<branch>     an updateUIView ran while UIKit was part way through an
//                 edit: Uahead, Usame, or Ureset (the guard failed)
//   R<field>><model>  the app put the post's text back (lengths)
//   B<binding>><post>  an update's binding disagreed with the post itself
//                      (lengths); after run 88 the field follows the post
//   K<field>><post>  after run 90: an update found the field ahead of the
//                    post outside UIKit's edit and kept the field's text
//   H<n>          the field's text handed to the post as it lost focus
//   S<n>          the app set the selection
//   X<loc>,<len>="..."  the keyboard asked for a replacement (a correction)
//   D!<asked>><got>     after UIKit's edit the field isn't what it asked
//                       for (lengths)
//   Q<way>-<key>=<what>  a key of the "@" and "/" lists (ret, tab, btab
//                 for ⇧⇥, esc, up, down) as it came in: c by its key
//                 command, p by its press (pressesBegan), u its press's
//                 end, i by insertText, d at the delegate (via-insert, or
//                 bypassed when insertText never saw it). <what> is the
//                 lists' action (pickMention1, markMention1, closeM, ...),
//                 field-listup or field-nolist when the field kept it,
//                 composing<n> while an input method held n letters
//                 marked, dup when another way had taken that press,
//                 passed or after-command for an arrow's press, and held
//                 or passed for a press's end (cancel-held, cancel-passed
//                 for one cancelled). Qp-keyless<type>=held or passed: a
//                 press with no key (UIPress.PressType's number), held
//                 when it came in a set with a list key taken
//   C<offered>    the list key commands the field offered as UIKit asked
//                 for its key commands, noted as it changes: rows (the
//                 arrows, Return, Tab and Escape), escape (Escape alone),
//                 composing (none, an input method composing over a list),
//                 none (no list)
// Its `totals` are kept since launch. The y, h and o events are looked for
// as each key comes in: h@12 is a height the field took after its 12th key
// and before its 13th.
//
// Reading a record: a letter in `keys` (or `presses`) but not in `asked`
// was lost between insertText and the delegate; one in `asked` but not in
// the field was lost after the delegate approved it (R, Ureset and D! say
// how). A letter lost next to an h event was lost at a line wrap, as the
// post editor grew and the composer laid out again. A y with an o beside it is the
// scroll moving; a y alone is the sheet moving or resizing.
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
  static let isOn = UserDefaults.standard.bool(forKey: "VirgaTypingProbe")

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
    var lastH: Int?
    var lastO: Int?
    /// The list key commands last offered (C events).
    var commands: String?
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
      lastH = nil
      lastO = nil
      commands = nil
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

  static func count(_ id: String, _ key: String) {
    guard isOn else { return }
    fields[id, default: Field()].bump(key)
  }

  static func press(_ id: String, _ characters: String) {
    guard isOn, !characters.isEmpty else { return }
    fields[id, default: Field()].presses += characters
  }

  /// A key of the "@" and "/" lists: `route` the way it came in, `key`
  /// which, `result` what came of it (the Q events above).
  static func listKey(_ id: String, route: String, key: String, result: String) {
    guard isOn else { return }
    var field = fields[id, default: Field()]
    field.note("Q\(route)-\(key)=\(result)")
    field.bump("listKeys-\(route)")
    fields[id] = field
  }

  /// The list key commands the field offered as UIKit asked (C events).
  static func commands(_ id: String, _ offered: String) {
    guard isOn else { return }
    var field = fields[id, default: Field()]
    field.bump("commandsAsked")
    if field.commands != offered {
      field.commands = offered
      field.note("C\(offered)")
    }
    fields[id] = field
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
      // The post cleared.
      field.emptied()
    } else if branch == "reset" {
      field.bump(editing ? "midEditResets" : "resets")
      field.note("R\(length)>\(model)")
    }
    fields[id] = field
  }

  /// A key's gap since the one before, the field's place in the window (an
  /// iPad's fitted sheet moves it as the composer grows), its height (a
  /// line wrap) and the offset of the scroll it sits in.
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
    let h = Int(view.bounds.height.rounded())
    if field.lastH != h {
      if field.lastH != nil { field.note("h\(h)") }
      field.lastH = h
    }
    if let o = scrollOffset(of: view), field.lastO != o {
      if field.lastO != nil { field.note("o\(o)") }
      field.lastO = o
    }
  }

  /// The vertical content offset of the nearest scroll the view sits in
  /// (the composer's, for a post), or nil when it sits in none.
  private static func scrollOffset(of view: UIView) -> Int? {
    var next = view.superview
    while let ancestor = next {
      if let scroll = ancestor as? UIScrollView { return Int(scroll.contentOffset.y.rounded()) }
      next = ancestor.superview
    }
    return nil
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
    guard let data = try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .withoutEscapingSlashes])
    else { return "{}" }
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

#endif
