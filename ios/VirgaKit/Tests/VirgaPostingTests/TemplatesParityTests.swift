// Parity for src/posting/templates/postTemplates.js (fixtures
// templates.postTemplates and templates.fill).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

/// An ISO time from a fixture as a Date.
func fixtureDate(_ value: JSONValue?) -> Date {
  let ms = JSDate.parse(value?.stringValue ?? "", timeZone: TimeZone(identifier: "UTC")!)
  return Date(timeIntervalSince1970: ms / 1000)
}

@Suite struct PostTemplatesParity {
  static let f = "templates.postTemplates"

  @Test func constants() throws {
    check(.string(PostTemplates.templateCollection), try cases(Self.f, "TEMPLATE_COLLECTION")[0])
    check(json(PostTemplates.templateLimits), try cases(Self.f, "TEMPLATE_LIMITS")[0])
    check(json(PostTemplates.templateUses), try cases(Self.f, "TEMPLATE_USES")[0])
    check(json(PostTemplates.templateRecordFields), try cases(Self.f, "TEMPLATE_RECORD_FIELDS")[0])
    check(json(PostTemplates.templateVariableFields), try cases(Self.f, "TEMPLATE_VARIABLE_FIELDS")[0])
    check(json(PostTemplates.contextKeys), try cases(Self.f, "CONTEXT_KEYS")[0])
    check(json(PostTemplates.contextLabels), try cases(Self.f, "CONTEXT_LABELS")[0])
  }

  @Test func isContextKey() throws {
    for c in try cases(Self.f, "isContextKey") {
      check(.bool(PostTemplates.isContextKey(c["key"])), c)
    }
  }

  @Test func placeholderKeys() throws {
    for c in try cases(Self.f, "placeholderKeys") {
      check(json(PostTemplates.placeholderKeys(c["text"])), c)
    }
  }

  @Test func splitTemplateText() throws {
    for c in try cases(Self.f, "splitTemplateText") {
      check(json(PostTemplates.splitTemplateText(c["text"])), c)
    }
  }

  @Test func buildTemplateContext() throws {
    for c in try cases(Self.f, "buildTemplateContext") {
      let context = PostTemplates.buildTemplateContext(
        replyTo: c["replyTo"], self: c["self"], now: fixtureDate(c["now"]), locale: c.string("locale"),
        timeZone: TimeZone(identifier: c.string("tz") ?? "UTC"))
      check(json(context), c, strictNulls: true)
    }
  }

  @Test func contextValue() throws {
    for c in try cases(Self.f, "contextValue") {
      check(json(PostTemplates.contextValue(c.string("key"), TemplateContext(json: c["context"]))), c)
    }
  }

  @Test func templateQuestions() throws {
    for c in try cases(Self.f, "templateQuestions") {
      check(json(PostTemplates.templateQuestions(c["template"], TemplateContext(json: c["context"]))), c, strictNulls: true)
    }
  }

  @Test func describeTemplate() throws {
    for c in try cases(Self.f, "describeTemplate") {
      check(json(PostTemplates.describeTemplate(c["template"], TemplateContext(json: c["context"]))), c)
    }
  }

  @Test func initialAnswers() throws {
    for c in try cases(Self.f, "initialAnswers") {
      let questions = try c["questions"].isNull ? nil : c["questions"].decode([TemplateQuestion].self)
      check(json(PostTemplates.initialAnswers(questions)), c)
    }
  }

  @Test func missingAnswers() throws {
    for c in try cases(Self.f, "missingAnswers") {
      let questions = try c["questions"].decode([TemplateQuestion].self)
      check(json(PostTemplates.missingAnswers(questions, c["answers"])), c)
    }
  }

  @Test func tidyTemplateParts() throws {
    for c in try cases(Self.f, "tidyTemplateParts") {
      check(.array(PostTemplates.tidyTemplateParts(c["parts"])), c, strictNulls: true)
      // Where every part is a plain TemplatePart, the typed form agrees.
      guard let items = c["parts"].arrayValue else { continue }
      let plain = items.allSatisfy { item in
        guard let object = item.objectValue, object["text"]?.stringValue != nil, object["kind"]?.stringValue != nil else { return false }
        return Set(object.keys).isSubset(of: ["text", "kind", "key"]) && (object["key"].map { $0.stringValue != nil } ?? true)
      }
      if plain {
        let parts = try c["parts"].decode([TemplatePart].self)
        check(json(PostTemplates.tidyTemplateParts(parts)), c)
      }
    }
  }

  @Test func templateOffered() throws {
    for c in try cases(Self.f, "templateOffered") {
      check(.bool(PostTemplates.templateOffered(c["template"], replying: c["replying"].boolValue ?? false)), c)
    }
  }

  @Test func keywordMatches() throws {
    for c in try cases(Self.f, "keywordMatches") {
      check(json(PostTemplates.keywordMatches(c["template"], c.string("text"))), c)
    }
  }

  @Test func normalizeShortcut() throws {
    for c in try cases(Self.f, "normalizeShortcut") {
      check(.string(PostTemplates.normalizeShortcut(c["value"])), c)
    }
  }

  @Test func matchShortcut() throws {
    for c in try cases(Self.f, "matchShortcut") {
      let found = PostTemplates.matchShortcut(
        c["templates"].arrayValue, c.string("query"), replying: c["replying"].boolValue ?? false,
        limit: c["limit"].intValue ?? 5)
      check(.array(found), c, strictNulls: true)
    }
  }

  @Test func blankKeyFromLabel() throws {
    for c in try cases(Self.f, "blankKeyFromLabel") {
      check(.string(PostTemplates.blankKeyFromLabel(c["label"])), c)
    }
  }

  @Test func normalizeTemplateRecord() throws {
    for c in try cases(Self.f, "normalizeTemplateRecord") {
      let template = PostTemplates.normalizeTemplateRecord(c["entry"])
      check(json(template), c, strictNulls: true)
      // The typed template reads back the same, and answers the same members.
      check(json(PostTemplate(json: template.json)), c, strictNulls: true)
    }
  }

  @Test func templateToRecord() throws {
    for c in try cases(Self.f, "templateToRecord") {
      let record = PostTemplates.templateToRecord(
        c["template"], now: fixtureDate(c["now"]), isUpdate: c["isUpdate"].boolValue ?? false)
      check(record, c, strictNulls: true)
    }
  }

  @Test func validateTemplate() throws {
    for c in try cases(Self.f, "validateTemplate") {
      let errors = PostTemplates.validateTemplate(c["template"], c["others"].arrayValue ?? [])
      check(["errors": errors.json, "order": json(errors.fields)], c, strictNulls: true)
    }
  }
}

@Suite struct TemplateFillParity {
  static let f = "templates.fill"

  @Test func fillTemplate() throws {
    for c in try cases(Self.f, "fillTemplate") {
      check(.string(PostTemplates.fillTemplate(c["template"], c["answers"], TemplateContext(json: c["context"]))), c)
    }
  }

  @Test func templatePreviewParts() throws {
    for c in try cases(Self.f, "templatePreviewParts") {
      let parts = PostTemplates.templatePreviewParts(c["template"], c["answers"], TemplateContext(json: c["context"]))
      check(json(parts), c, strictNulls: true)
    }
  }

  /// Once every required blank is answered, the preview joins to the filled text.
  @Test func previewJoinsToTheFilledText() throws {
    for c in try cases(Self.f, "templatePreviewParts") {
      let context = TemplateContext(json: c["context"])
      let questions = PostTemplates.templateQuestions(c["template"], context)
      guard PostTemplates.missingAnswers(questions, c["answers"]).isEmpty else { continue }
      let joined = PostTemplates.templatePreviewParts(c["template"], c["answers"], context).map(\.text).joined()
      let filled = PostTemplates.fillTemplate(c["template"], c["answers"], context)
      #expect(joined.jsEquals(filled), "\(c)")
    }
  }
}
