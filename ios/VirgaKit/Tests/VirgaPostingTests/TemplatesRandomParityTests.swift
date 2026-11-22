// Parity for the template modules over seeded random inputs (fixture
// templates.random): src/posting/templates/postTemplates.js,
// editorDrafts.js, templateUsage.js and
// src/posting/library/templateEditorModel.js, on combinations the
// hand-picked fixtures don't reach.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct TemplatesRandomParity {
  static let f = "templates.random"

  static func context(_ c: ParityCase) -> TemplateContext? { TemplateContext(json: c["context"]) }

  @Test func blanks() throws {
    for c in try cases(Self.f, "placeholderKeys") { check(json(PostTemplates.placeholderKeys(c["text"])), c) }
    for c in try cases(Self.f, "splitTemplateText") { check(json(PostTemplates.splitTemplateText(c["text"])), c) }
  }

  @Test func buildTemplateContext() throws {
    for c in try cases(Self.f, "buildTemplateContext") {
      let context = PostTemplates.buildTemplateContext(
        replyTo: c["replyTo"], self: c["self"], now: fixtureDate(c["now"]), locale: c.string("locale"),
        timeZone: TimeZone(identifier: c.string("tz") ?? "UTC"))
      check(json(context), c, strictNulls: true)
    }
  }

  @Test func questionsAndFilling() throws {
    for c in try cases(Self.f, "templateQuestions") {
      check(json(PostTemplates.templateQuestions(c["template"], Self.context(c))), c, strictNulls: true)
    }
    for c in try cases(Self.f, "describeTemplate") {
      check(json(PostTemplates.describeTemplate(c["template"], Self.context(c))), c)
    }
    for c in try cases(Self.f, "missingAnswers") {
      let questions = PostTemplates.templateQuestions(c["template"], Self.context(c))
      check(json(PostTemplates.missingAnswers(questions, c["answers"])), c)
    }
    for c in try cases(Self.f, "fillTemplate") {
      check(.string(PostTemplates.fillTemplate(c["template"], c["answers"], Self.context(c))), c)
    }
    for c in try cases(Self.f, "templatePreviewParts") {
      check(json(PostTemplates.templatePreviewParts(c["template"], c["answers"], Self.context(c))), c, strictNulls: true)
    }
  }

  @Test func tidyTemplateParts() throws {
    for c in try cases(Self.f, "tidyTemplateParts") {
      check(.array(PostTemplates.tidyTemplateParts(c["parts"])), c, strictNulls: true)
      let parts = try c["parts"].decode([TemplatePart].self)
      check(json(PostTemplates.tidyTemplateParts(parts)), c)
    }
  }

  @Test func matching() throws {
    for c in try cases(Self.f, "keywordMatches") {
      check(json(PostTemplates.keywordMatches(c["template"], c.string("text"))), c)
    }
    for c in try cases(Self.f, "normalizeShortcut") {
      check(.string(PostTemplates.normalizeShortcut(c["value"])), c)
    }
    for c in try cases(Self.f, "matchShortcut") {
      let found = PostTemplates.matchShortcut(
        c["templates"].arrayValue, c.string("query"), replying: c["replying"].boolValue ?? false,
        limit: c["limit"].intValue ?? 5)
      check(.array(found), c, strictNulls: true)
    }
    for c in try cases(Self.f, "blankKeyFromLabel") {
      check(.string(PostTemplates.blankKeyFromLabel(c["label"])), c)
    }
  }

  @Test func records() throws {
    for c in try cases(Self.f, "normalizeTemplateRecord") {
      check(json(PostTemplates.normalizeTemplateRecord(c["entry"])), c, strictNulls: true)
    }
    for c in try cases(Self.f, "templateToRecord") {
      let record = PostTemplates.templateToRecord(
        c["template"], now: fixtureDate(c["now"]), isUpdate: c["isUpdate"].boolValue ?? false)
      check(record, c, strictNulls: true)
    }
    for c in try cases(Self.f, "validateTemplate") {
      let errors = PostTemplates.validateTemplate(c["template"], c["others"].arrayValue ?? [])
      check(["errors": errors.json, "order": json(errors.fields)], c, strictNulls: true)
    }
  }

  @Test func drafts() throws {
    for c in try cases(Self.f, "draftFromReply") {
      let (draft, note) = EditorDrafts.draftFromReply(c.input)
      check(["draft": draft, "note": json(note)], c, strictNulls: true)
    }
    for c in try cases(Self.f, "draftFromTemplate") {
      check(EditorDrafts.draftFromTemplate(c["template"]), c, strictNulls: true)
    }
    for c in try cases(Self.f, "roundTrip") {
      check(EditorDrafts.templateFromDraft(EditorDrafts.draftFromTemplate(c["template"])), c, strictNulls: true)
    }
    for c in try cases(Self.f, "templateFromDraft") {
      check(EditorDrafts.templateFromDraft(c["draft"]), c, strictNulls: true)
    }
    for c in try cases(Self.f, "syncDraftVariables") {
      check(EditorDrafts.syncDraftVariables(c["draft"]), c, strictNulls: true)
    }
  }

  @Test func editor() throws {
    for c in try cases(Self.f, "blanksIn") {
      check(TemplateEditorModel.blanksIn(c["draft"]), c, strictNulls: true)
    }
    for c in try cases(Self.f, "editorProblems") {
      let problems = TemplateEditorModel.editorProblems(c["draft"], c["others"].arrayValue ?? [])
      check(["problems": problems.json, "order": json(problems.fields)], c, strictNulls: true)
    }
    for c in try cases(Self.f, "editorHasChanges") {
      check(.bool(TemplateEditorModel.editorHasChanges(c["initial"], c["draft"])), c)
    }
    for c in try cases(Self.f, "insertAtSelection") {
      check(json(TemplateEditorModel.insertAtSelection(c["text"], c.string("token") ?? "", c["selection"])), c)
    }
    for c in try cases(Self.f, "addBlank") {
      check(json(TemplateEditorModel.addBlank(c["draft"], c["label"], c["selection"])), c, strictNulls: true)
    }
  }

  @Test func shelf() throws {
    for c in try cases(Self.f, "sortTemplatesForShelf") {
      check(.array(TemplateUsage.sortTemplatesForShelf(c["templates"].arrayValue, c["usage"], locale: "en-US")), c, strictNulls: true)
    }
  }
}
