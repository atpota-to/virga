// Strings compared by code units, as JavaScript compares them
// (Sources/VirgaInsights/JSStrings.swift). The parity fixtures hold each
// function that compares strings to the web over canonically equivalent
// ids, DIDs, groups and the Kelvin sign; these pin the helpers themselves.

import VirgaCore
import Foundation
import Testing
@testable import VirgaInsights

@Suite struct JSStringsTests {
  let composed = "caf\u{E9}"
  let decomposed = "cafe\u{301}"

  @Test func equalityIsByCodeUnit() {
    #expect(composed == decomposed, "Swift's == is canonical equivalence")
    #expect(!composed.jsEquals(decomposed))
    #expect(composed.jsEquals("caf\u{E9}"))
    #expect(!"\u{212A}".jsEquals("K"), "the Kelvin sign isn't K")
    #expect(!"\u{037E}".jsEquals(";"))
    #expect(!"\u{1FEF}".jsEquals("`"))
    #expect(Optional<String>.none.jsEquals(nil))
    #expect(!Optional<String>.none.jsEquals(""))
    #expect(!Optional(composed).jsEquals(decomposed))
    #expect(Optional(composed).jsEquals(composed))
  }

  @Test func keysAndSetsKeepBothSpellings() {
    var set = Set<JSKey>()
    #expect(set.insert(JSKey(composed)).inserted)
    #expect(set.insert(JSKey(decomposed)).inserted)
    #expect(!set.insert(JSKey(composed)).inserted)
    #expect(set.count == 2)
    #expect([composed].jsIncludes(composed))
    #expect(![composed].jsIncludes(decomposed))
  }

  @Test func lookupsFindOnlyTheirOwnKey() {
    let table = [composed: 1, "K": 2]
    #expect(table.jsValue(composed) == 1)
    #expect(table.jsValue(decomposed) == nil)
    #expect(table[decomposed] == 1, "where a plain subscript finds it")
    #expect(table.jsValue("\u{212A}") == nil)
    #expect(table.jsValue("K") == 2)
  }
}
