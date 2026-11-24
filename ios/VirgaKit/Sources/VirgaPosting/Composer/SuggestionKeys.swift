// Ports src/posting/composer/PostEditor.jsx (onKeyDown, the keys of the "@" and "/" lists)
//
// What a key does in a post's field while one of its suggestion lists is
// up, as PostEditor.jsx's onKeyDown decides it. ↑ and ↓ move the mark
// through the rows, round at the ends, whatever else is held; Return and
// Tab take the marked row, except with ⌘ or ⌃ held (the composer sends on
// those); Escape closes the list, not the composer. A list with no rows
// (still looking, no one found, no template) takes only Escape, so Return
// makes a new line. While an input method is composing (the web's
// isComposing) every key is the field's. Home and End are always the
// field's. The "@" list comes first: the "/" list is never up beside it.

import Foundation

public enum SuggestionKeys {
  /// The keys the lists take.
  public enum Key: Sendable {
    case up, down, enter, tab, escape
  }

  /// The lists as the field has them when the key comes in.
  public struct Lists: Equatable, Sendable {
    /// The "@" list is up, whether with rows or a status line.
    public var mentionOpen: Bool
    public var mentionRows: Int
    /// The row the arrows have marked (the web's `mention.index`).
    public var mentionIndex: Int
    /// The "/" list is up.
    public var slashOpen: Bool
    public var slashRows: Int
    public var slashIndex: Int

    public init(
      mentionOpen: Bool = false, mentionRows: Int = 0, mentionIndex: Int = 0,
      slashOpen: Bool = false, slashRows: Int = 0, slashIndex: Int = 0
    ) {
      self.mentionOpen = mentionOpen
      self.mentionRows = mentionRows
      self.mentionIndex = mentionIndex
      self.slashOpen = slashOpen
      self.slashRows = slashRows
      self.slashIndex = slashIndex
    }

    /// Whether ↑ and ↓ are the lists' (a list with rows is up).
    public var takesArrows: Bool { mentionRows > 0 || (slashOpen && slashRows > 0) }

    /// Whether Escape is the lists' (a list is up).
    public var takesEscape: Bool { mentionOpen || slashOpen }
  }

  public enum Action: Equatable, Sendable {
    /// Not the lists' key: it goes on to the field as it would anyway.
    case field
    /// The "@" list's mark moves to this row.
    case markMention(Int)
    /// The "@" list's row is taken (the web takes its marked row).
    case pickMention(Int)
    case markSlash(Int)
    case pickSlash(Int)
    /// Escape: the lists that close.
    case close(mention: Bool, slash: Bool)
  }

  /// `onKeyDown`: what `key` does to `lists`. `composing` is an input
  /// method's unfinished text in the field; `command` and `control` are
  /// the web's metaKey and ctrlKey.
  public static func action(
    _ key: Key, lists: Lists, composing: Bool = false, command: Bool = false, control: Bool = false
  ) -> Action {
    if composing { return .field }
    let held = command || control
    if lists.mentionRows > 0 {
      switch key {
      case .up: return .markMention(step(lists.mentionIndex, by: -1, count: lists.mentionRows))
      case .down: return .markMention(step(lists.mentionIndex, by: 1, count: lists.mentionRows))
      case .enter, .tab: return held ? .field : .pickMention(lists.mentionIndex)
      case .escape: break
      }
    }
    if lists.slashOpen && lists.slashRows > 0 {
      switch key {
      case .up: return .markSlash(step(lists.slashIndex, by: -1, count: lists.slashRows))
      case .down: return .markSlash(step(lists.slashIndex, by: 1, count: lists.slashRows))
      case .enter, .tab: if !held { return .pickSlash(lists.slashIndex) }
      case .escape: break
      }
    }
    if key == .escape && lists.takesEscape {
      return .close(mention: lists.mentionOpen, slash: lists.slashOpen)
    }
    return .field
  }

  /// `(index + step + count) % count`: the row `step` away, round at the
  /// ends. An empty list gives 0, and the result is never below 0 (the
  /// web's index never is).
  public static func step(_ index: Int, by step: Int, count: Int) -> Int {
    guard count > 0 else { return 0 }
    let moved = (index + step + count) % count
    return moved < 0 ? moved + count : moved
  }
}
