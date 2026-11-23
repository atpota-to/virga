// Ports src/posting/composer/LanguagePicker.jsx (the search field's keys)
//
// The language search is a combobox. While it shows suggestions, ↓ and ↑
// move the highlighted one round the list (from the last back to the
// first, and the other way), Enter adds the highlighted one, and Escape
// puts the list away without closing what the field is in. With no
// suggestions showing, every key is the field's own. The first suggestion
// is highlighted as the list opens and after every keystroke, which is the
// view's part (`active` goes back to 0).

/// What a key does to the language suggestions (LanguagePicker.jsx's onKeyDown).
public enum LanguagePickerKeys {
  public enum Key: Sendable {
    case down, up, enter, escape
  }

  public enum Outcome: Equatable, Sendable {
    /// Not the list's: the field, or what holds it, has the key.
    case ignored
    /// The highlight moves to this suggestion.
    case highlight(Int)
    /// This suggestion is added.
    case add(Int)
    /// The list closes; the field keeps its focus.
    case close
  }

  /// `key` pressed in the field with `count` suggestions showing and the
  /// one at `active` highlighted.
  public static func press(_ key: Key, active: Int, count: Int) -> Outcome {
    guard count > 0 else { return .ignored }
    switch key {
    case .down: return .highlight((active + 1) % count)
    case .up: return .highlight((active - 1 + count) % count)
    // `add(options[active]?.code)`: a highlight past the end adds nothing.
    case .enter: return active >= 0 && active < count ? .add(active) : .ignored
    case .escape: return .close
    }
  }
}
