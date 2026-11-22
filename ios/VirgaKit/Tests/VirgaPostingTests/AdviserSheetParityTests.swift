// adviser/sheet.js and adviser/sheetView.js held to adviser.sheet.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct AdviserSheetParity {
  static let f = "adviser.sheet"

  static func spans(_ value: JSONValue?) -> [AdviserMarkSpan] {
    (value?.arrayValue ?? []).map { AdviserMarkSpan(key: $0["key"]?.stringValue ?? "", excerpt: $0["excerpt"]) }
  }

  static func fixes(_ value: JSONValue?) -> [AdviserMarkFix] {
    (value?.arrayValue ?? []).map { AdviserMarkFix(key: $0["key"]?.stringValue ?? "", found: $0["found"]) }
  }

  @Test func constants() throws {
    for c in try cases(Self.f, "sheetViewConstants") {
      check(
        [
          "VERDICT_COPY": json(AdviserSheetView.verdictCopy), "STATUS_WORDS": json(AdviserSheetView.statusWords),
          "WRITING_TYPE_LABELS": json(AdviserSheetView.writingTypeLabels),
        ], c)
    }
  }

  @Test func marks() throws {
    for c in try cases(Self.f, "placeAdviserMarks") {
      let out = AdviserSheet.placeAdviserMarks(
        c.input["posts"], spans: Self.spans(c.input["spans"]), fixes: Self.fixes(c.input["fixes"]))
      check(["posts": json(out.posts), "placed": json(out.placed)], c)
    }
    for c in try cases(Self.f, "adviserVerdict") {
      check(AdviserSheet.adviserVerdict(c.input["result"]).map(JSONValue.string) ?? .null, c)
    }
  }

  @Test func model() throws {
    for c in try cases(Self.f, "adviserSheetModel") {
      check(AdviserSheet.adviserSheetModel(c.input["result"], c.input["posts"]).json, c)
    }
    for c in try cases(Self.f, "adviserWritingTally") {
      let model = AdviserSheet.adviserSheetModel(c.input["result"], c.input["posts"])
      let taken = c.strings("taken")
      check(
        [
          "tally": AdviserSheet.adviserWritingTally(model, taken: taken).map(JSONValue.string) ?? .null,
          "found": .bool(AdviserSheetView.readFoundSomething(model, taken)),
        ], c)
    }
    for c in try cases(Self.f, "adviserWritingTallyNone") {
      // No model, or one without a proofread.
      check(AdviserSheet.adviserWritingTally(nil).map(JSONValue.string) ?? .null, c)
    }
    for c in try cases(Self.f, "adviserDraftLabel") {
      check(.string(AdviserSheet.adviserDraftLabel(c.string("scenario"), c["withContext"].boolValue ?? false)), c)
    }
  }

  @Test func view() throws {
    for c in try cases(Self.f, "sheetTitle") {
      check(.string(AdviserSheetView.sheetTitle(c.input["read"])), c)
    }
    for c in try cases(Self.f, "sheetActions") {
      let actions = AdviserSheetView.sheetActions(
        c.input["read"], canPublish: c.input["canPublish"]?.boolValue ?? true,
        canSaveDraft: c.input["canSaveDraft"]?.boolValue ?? true)
      check(actions.json, c)
    }
    for c in try cases(Self.f, "sheetContextLine") {
      check(.string(AdviserSheetView.sheetContextLine(c.input["read"])), c)
    }
    for c in try cases(Self.f, "postIndexLabel") {
      check(.string(AdviserSheetView.postIndexLabel(c["index"].doubleValue!, c["total"].doubleValue!)), c)
    }
    for c in try cases(Self.f, "fixAllLabel") {
      check(.string(AdviserSheetView.fixAllLabel(c["remaining"].doubleValue!)), c)
    }
  }
}
