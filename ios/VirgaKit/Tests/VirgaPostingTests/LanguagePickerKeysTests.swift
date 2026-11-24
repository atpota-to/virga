// LanguagePicker.jsx's keys on its search field, as the web's onKeyDown
// handles them: ↓ and ↑ round the list, Enter adds the highlighted one,
// Escape closes the list, and nothing is the list's while it is empty.

import Testing
@testable import VirgaPosting

struct LanguagePickerKeysBehaviour {
  @Test func downAndUpGoRoundTheList() {
    #expect(LanguagePickerKeys.press(.down, active: 0, count: 6) == .highlight(1))
    #expect(LanguagePickerKeys.press(.down, active: 5, count: 6) == .highlight(0))
    #expect(LanguagePickerKeys.press(.up, active: 0, count: 6) == .highlight(5))
    #expect(LanguagePickerKeys.press(.up, active: 3, count: 6) == .highlight(2))
    #expect(LanguagePickerKeys.press(.down, active: 0, count: 1) == .highlight(0))
  }

  /// The web's walk in the harness (Chromium, Settings › Posting, nothing
  /// typed, six suggestions): ↓ ↓ highlights the third, then ↑ ↑ ↑ the last.
  @Test func theHarnessWalk() {
    var active = 0
    var walk: [Int] = []
    for key in [LanguagePickerKeys.Key.down, .down, .up, .up, .up] {
      guard case .highlight(let next) = LanguagePickerKeys.press(key, active: active, count: 6) else {
        Issue.record("\(key) didn't move the highlight")
        return
      }
      active = next
      walk.append(next)
    }
    #expect(walk == [1, 2, 1, 0, 5])
  }

  @Test func enterAddsTheHighlightedOne() {
    #expect(LanguagePickerKeys.press(.enter, active: 0, count: 6) == .add(0))
    #expect(LanguagePickerKeys.press(.enter, active: 4, count: 6) == .add(4))
    // `options[active]?.code` is undefined past the end: nothing is added.
    #expect(LanguagePickerKeys.press(.enter, active: 6, count: 6) == .ignored)
  }

  @Test func escapeClosesTheList() {
    #expect(LanguagePickerKeys.press(.escape, active: 2, count: 3) == .close)
  }

  /// `if (!options.length) return`: with the list closed or empty, every
  /// key is the field's, and Escape reaches what holds it.
  @Test func nothingIsTheListsWhileItIsEmpty() {
    for key in [LanguagePickerKeys.Key.down, .up, .enter, .escape] {
      #expect(LanguagePickerKeys.press(key, active: 0, count: 0) == .ignored)
    }
  }
}
