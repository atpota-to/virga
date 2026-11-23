// PostEditor.jsx's onKeyDown, as SuggestionKeys reads it: which keys the
// "@" and "/" lists take, and which go on to the field.

import Testing
@testable import VirgaPosting

struct SuggestionKeysBehaviour {
  typealias Lists = SuggestionKeys.Lists

  static let mentionRows = Lists(mentionOpen: true, mentionRows: 3, mentionIndex: 0)
  static let slashRows = Lists(slashOpen: true, slashRows: 2, slashIndex: 0)

  @Test func theArrowsMoveTheMarkRoundTheEnds() {
    #expect(SuggestionKeys.action(.down, lists: Self.mentionRows) == .markMention(1))
    #expect(SuggestionKeys.action(.up, lists: Self.mentionRows) == .markMention(2))
    var last = Self.mentionRows
    last.mentionIndex = 2
    #expect(SuggestionKeys.action(.down, lists: last) == .markMention(0))
    #expect(SuggestionKeys.action(.up, lists: last) == .markMention(1))
    #expect(SuggestionKeys.action(.down, lists: Self.slashRows) == .markSlash(1))
    #expect(SuggestionKeys.action(.up, lists: Self.slashRows) == .markSlash(1))
  }

  @Test func theArrowsIgnoreWhatElseIsHeld() {
    // The web reads no modifier for ↑ and ↓.
    #expect(SuggestionKeys.action(.down, lists: Self.mentionRows, command: true) == .markMention(1))
    #expect(SuggestionKeys.action(.up, lists: Self.slashRows, control: true) == .markSlash(1))
  }

  @Test func returnAndTabTakeTheMarkedRow() {
    var marked = Self.mentionRows
    marked.mentionIndex = 1
    #expect(SuggestionKeys.action(.enter, lists: marked) == .pickMention(1))
    #expect(SuggestionKeys.action(.tab, lists: marked) == .pickMention(1))
    #expect(SuggestionKeys.action(.enter, lists: Self.slashRows) == .pickSlash(0))
    #expect(SuggestionKeys.action(.tab, lists: Self.slashRows) == .pickSlash(0))
  }

  @Test func commandOrControlReturnIsTheComposers() {
    #expect(SuggestionKeys.action(.enter, lists: Self.mentionRows, command: true) == SuggestionKeys.Action.field)
    #expect(SuggestionKeys.action(.enter, lists: Self.mentionRows, control: true) == SuggestionKeys.Action.field)
    #expect(SuggestionKeys.action(.tab, lists: Self.slashRows, command: true) == SuggestionKeys.Action.field)
  }

  @Test func aListWithNoRowsTakesOnlyEscape() {
    // "Looking…" or "No one found": Return is a new line, the arrows move the caret.
    let looking = Lists(mentionOpen: true, mentionRows: 0)
    #expect(SuggestionKeys.action(.enter, lists: looking) == SuggestionKeys.Action.field)
    #expect(SuggestionKeys.action(.tab, lists: looking) == SuggestionKeys.Action.field)
    #expect(SuggestionKeys.action(.down, lists: looking) == SuggestionKeys.Action.field)
    #expect(SuggestionKeys.action(.escape, lists: looking) == .close(mention: true, slash: false))
    let noTemplate = Lists(slashOpen: true, slashRows: 0)
    #expect(SuggestionKeys.action(.enter, lists: noTemplate) == SuggestionKeys.Action.field)
    #expect(SuggestionKeys.action(.escape, lists: noTemplate) == .close(mention: false, slash: true))
    #expect(!looking.takesArrows)
    #expect(looking.takesEscape)
  }

  @Test func escapeClosesTheListsThatAreUp() {
    #expect(SuggestionKeys.action(.escape, lists: Self.mentionRows) == .close(mention: true, slash: false))
    #expect(SuggestionKeys.action(.escape, lists: Self.slashRows) == .close(mention: false, slash: true))
  }

  @Test func noListTakesNoKey() {
    let none = Lists()
    for key in [SuggestionKeys.Key.up, .down, .enter, .tab, .escape] {
      #expect(SuggestionKeys.action(key, lists: none) == SuggestionKeys.Action.field)
    }
    #expect(!none.takesArrows)
    #expect(!none.takesEscape)
  }

  @Test func anInputMethodComposingHasEveryKey() {
    for key in [SuggestionKeys.Key.up, .down, .enter, .tab, .escape] {
      #expect(SuggestionKeys.action(key, lists: Self.mentionRows, composing: true) == SuggestionKeys.Action.field)
      #expect(SuggestionKeys.action(key, lists: Self.slashRows, composing: true) == SuggestionKeys.Action.field)
    }
  }

  @Test func theMentionListComesFirst() {
    let both = Lists(mentionOpen: true, mentionRows: 2, mentionIndex: 1, slashOpen: true, slashRows: 3, slashIndex: 2)
    #expect(SuggestionKeys.action(.down, lists: both) == .markMention(0))
    #expect(SuggestionKeys.action(.enter, lists: both) == .pickMention(1))
    #expect(SuggestionKeys.action(.escape, lists: both) == .close(mention: true, slash: true))
  }

  @Test func stepIsTheWebsModulo() {
    #expect(SuggestionKeys.step(0, by: -1, count: 5) == 4)
    #expect(SuggestionKeys.step(4, by: 1, count: 5) == 0)
    #expect(SuggestionKeys.step(7, by: 1, count: 2) == 0)
    #expect(SuggestionKeys.step(0, by: 1, count: 1) == 0)
    #expect(SuggestionKeys.step(0, by: 1, count: 0) == 0)
  }
}
