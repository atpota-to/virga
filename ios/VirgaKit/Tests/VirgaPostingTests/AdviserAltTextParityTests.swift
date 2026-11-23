// adviser/altTextFollowUp.js and adviser/altTextModel.js held to adviser.altText.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct AdviserAltTextParity {
  static let f = "adviser.altText"

  @Test func constants() throws {
    for c in try cases(Self.f, "altTextConstants") {
      check(
        [
          "ALT_TEXT_QUICK_NOTES": json(AltTextFollowUp.altTextQuickNotes),
          "ALT_TEXT_IMAGE_KINDS": json(AltTextFollowUp.altTextImageKinds),
          "ITS_A": .string(AltTextFollowUp.itsA),
          "ALT_TEXT_NOTE_MAX": .number(Double(AltTextFollowUp.altTextNoteMax)),
          "ALT_TEXT_FOLLOW_UP_MAX": .number(Double(AltTextFollowUp.altTextFollowUpMax)),
          "CARD_QUICK_NOTES": .number(Double(AltTextFollowUp.cardQuickNotesCount)),
          "ALT_TEXT_MAX_GRAPHEMES": .number(Double(AltTextModel.altTextMaxGraphemes)),
          "GENERATED_ALT_MAX": .number(Double(AltTextModel.generatedAltMax)),
          "ALT_CONTEXT_MAX": .number(Double(AltTextModel.altContextMax)),
        ], c)
    }
  }

  @Test func quickNotes() throws {
    for c in try cases(Self.f, "toggleQuickNote") {
      check(json(AltTextFollowUp.toggleQuickNote(c.strings("selected"), c.string("id") ?? "")), c)
    }
    for c in try cases(Self.f, "tapsInOrder") {
      check(json(c.strings("taps").reduce([String]()) { AltTextFollowUp.toggleQuickNote($0, $1) }), c)
    }
    for c in try cases(Self.f, "quickNoteIds") {
      check(json(AltTextFollowUp.quickNoteIds(c.strings("selected"))), c)
    }
    for c in try cases(Self.f, "composeFollowUp") {
      check(.string(AltTextFollowUp.composeFollowUp(c.strings("selected"), c.string("note"))), c)
    }
    for c in try cases(Self.f, "hasFollowUpDraft") {
      check(.bool(AltTextFollowUp.hasFollowUpDraft(c.strings("selected"), c.string("note"))), c)
    }
    for c in try cases(Self.f, "describeRequest") {
      check(.string(AltTextFollowUp.describeRequest(c.strings("selected"), c.string("note"))), c)
    }
    for c in try cases(Self.f, "revisingLine") {
      check(.string(AltTextModel.revisingLine(c.strings("selected"), c.string("note"))), c)
    }
    for c in try cases(Self.f, "appendItsA") {
      check(.string(AltTextFollowUp.appendItsA(c.string("note"))), c)
    }
    for c in try cases(Self.f, "normalizeImageKind") {
      check(AltTextFollowUp.normalizeImageKind(c.input["kind"]).map(JSONValue.string) ?? .null, c)
    }
  }

  @Test func ranking() throws {
    for c in try cases(Self.f, "looksTranscribed") {
      check(.bool(AltTextFollowUp.looksTranscribed(c.string("text"))), c)
    }
    for c in try cases(Self.f, "rankQuickNotes") {
      let ranked = AltTextFollowUp.rankQuickNotes(text: c.string("text"), kind: c.string("kind"), lastAsked: c.strings("lastAsked"))
      check(["ranked": json(ranked), "card": json(AltTextFollowUp.cardQuickNotes(ranked))], c)
    }
    for c in try cases(Self.f, "rankQuickNotesDefaults") {
      check(json(AltTextFollowUp.rankQuickNotes()), c)
    }
  }

  @Test func model() throws {
    for c in try cases(Self.f, "altTextCount") {
      check(json(AltTextModel.altTextCount(c.input["text"], locale: c.string("locale"))), c)
    }
    for c in try cases(Self.f, "altGenerationRequest") {
      let request = AltTextModel.altGenerationRequest(
        mode: c.string("mode"), alt: c.input["alt"], selected: c.strings("selected"), note: c.string("note"),
        kind: c.input["kind"], context: c.input["context"])
      check(request.map(\.json) ?? .null, c)
    }
    for c in try cases(Self.f, "afterGeneration") {
      let result = AltTextModel.afterGeneration(
        before: c.string("before"), generated: c.input["generated"], mode: c.string("mode"),
        selected: c.strings("selected"))
      check(result.map(\.json) ?? .null, c)
    }
    for c in try cases(Self.f, "altTextUsageLine") {
      check(.string(AltTextModel.altTextUsageLine(c.input["usage"], now: c["now"].doubleValue!, locale: c.string("locale"))), c)
    }
  }
}
