// Parity for src/posting/templates/editorDrafts.js and
// src/posting/library/templateEditorModel.js (fixtures
// templates.editorDrafts and templates.editorModel), with the typed forms
// held to the same cases.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct EditorDraftsParity {
  static let f = "templates.editorDrafts"

  @Test func blankTemplate() throws {
    let c = try cases(Self.f, "BLANK_TEMPLATE")[0]
    check(EditorDrafts.blankTemplateJSON, c, strictNulls: true)
    check(json(EditorDrafts.blankTemplate), c, strictNulls: true)
  }

  @Test func templateEmbedKind() throws {
    for c in try cases(Self.f, "templateEmbedKind") {
      check(json(EditorDrafts.templateEmbedKind(c["embed"])), c)
    }
  }

  @Test func syncDraftVariables() throws {
    for c in try cases(Self.f, "syncDraftVariables") {
      check(EditorDrafts.syncDraftVariables(c["draft"]), c, strictNulls: true)
    }
  }

  @Test func draftFromTemplate() throws {
    for c in try cases(Self.f, "draftFromTemplate") {
      check(EditorDrafts.draftFromTemplate(c["template"]), c, strictNulls: true)
      // A template read back from a record makes the same draft typed.
      if c.id.hasPrefix("record-") {
        let typed = EditorDrafts.draftFromTemplate(PostTemplate(json: c["template"]))
        check(typed.json, c, strictNulls: true)
      }
    }
  }

  @Test func roundTrip() throws {
    for c in try cases(Self.f, "roundTrip") {
      check(EditorDrafts.templateFromDraft(EditorDrafts.draftFromTemplate(c["template"])), c, strictNulls: true)
      if c.id.hasPrefix("record-") || c.id == "roundTrip" {
        let typed = EditorDrafts.templateFromDraft(EditorDrafts.draftFromTemplate(PostTemplate(json: c["template"])))
        check(typed.json, c, strictNulls: true)
      }
    }
  }

  @Test func draftFromReply() throws {
    for c in try cases(Self.f, "draftFromReply") {
      let (draft, note) = EditorDrafts.draftFromReply(c.input)
      check(["draft": draft, "note": json(note)], c, strictNulls: true)
    }
  }

  @Test func templateFromDraft() throws {
    for c in try cases(Self.f, "templateFromDraft") {
      check(EditorDrafts.templateFromDraft(c["draft"]), c, strictNulls: true)
      if ["fromTest", "emptyChoices", "quoteNone", "extra"].contains(c.id) {
        check(EditorDrafts.templateFromDraft(TemplateDraft(json: c["draft"])).json, c, strictNulls: true)
      }
    }
  }
}

@Suite struct TemplateEditorModelParity {
  static let f = "templates.editorModel"

  @Test func options() throws {
    check(json(TemplateEditorModel.useOptions), try cases(Self.f, "USE_OPTIONS")[0])
    check(json(TemplateEditorModel.contextInserts), try cases(Self.f, "CONTEXT_INSERTS")[0])
  }

  @Test func insertAtSelection() throws {
    for c in try cases(Self.f, "insertAtSelection") {
      let out = TemplateEditorModel.insertAtSelection(c["text"], c.string("token") ?? "", c["selection"])
      check(json(out), c)
      // A whole-number selection on a string gives the same typed.
      if let text = c.string("text"), let start = c["selection"]["start"]?.intValue, let end = c["selection"]["end"]?.intValue {
        let typed = TemplateEditorModel.insertAtSelection(text, c.string("token") ?? "", TextSelection(start: start, end: end))
        check(json(typed), c)
      }
    }
  }

  @Test func addBlank() throws {
    for c in try cases(Self.f, "addBlank") {
      check(json(TemplateEditorModel.addBlank(c["draft"], c["label"], c["selection"])), c, strictNulls: true)
      // From a draft the editor made, the typed form agrees.
      if c["draft"]["quoteMode"] != nil, let label = c.string("label") {
        let selection = c["selection"]["start"]?.intValue.map { TextSelection(start: $0, end: c["selection"]["end"]?.intValue ?? $0) }
        let typed = TemplateEditorModel.addBlank(TemplateDraft(json: c["draft"]), label, selection)
        let typedJSON: JSONValue = typed.map { ["draft": $0.draft.json, "caret": .number(Double($0.caret)), "key": .string($0.key)] } ?? .null
        check(typedJSON, c, strictNulls: true)
      }
    }
  }

  @Test func patchVariable() throws {
    for c in try cases(Self.f, "patchVariable") {
      check(TemplateEditorModel.patchVariable(c["draft"], c.string("key") ?? "", c["patch"]), c, strictNulls: true)
    }
  }

  @Test func blanksIn() throws {
    for c in try cases(Self.f, "blanksIn") {
      check(TemplateEditorModel.blanksIn(c["draft"]), c, strictNulls: true)
      if c.id == "fromTest" || c.id == "allContext" {
        let typed = TemplateEditorModel.blanksIn(TemplateDraft(json: c["draft"]))
        check(["asked": .array(typed.asked.map(\.json)), "context": json(typed.context)], c, strictNulls: true)
      }
    }
  }

  @Test func editorHasChanges() throws {
    for c in try cases(Self.f, "editorHasChanges") {
      check(.bool(TemplateEditorModel.editorHasChanges(c["initial"], c["draft"])), c)
    }
  }

  @Test func editorProblems() throws {
    for c in try cases(Self.f, "editorProblems") {
      let problems = TemplateEditorModel.editorProblems(c["draft"], c["others"].arrayValue ?? [])
      check(["problems": problems.json, "order": json(problems.fields)], c, strictNulls: true)
    }
  }
}

@Suite struct TemplateEditorBehaviour {
  /// The web compares what saving would write as JSON text, so a record
  /// rebuilt with its keys in another order counts as a change there; the
  /// port compares by value (a deliberate difference).
  @Test func anEmbedRebuiltInAnotherOrderIsNoChange() {
    let embed: JSONValue = ["$type": "app.bsky.embed.record", "record": ["uri": "at://x/app.bsky.feed.post/1", "cid": "c"]]
    let initial = EditorDrafts.draftFromTemplate(PostTemplate(name: "T", text: "x", embed: embed))
    var rebuilt = initial
    rebuilt.embed = ["record": ["cid": "c", "uri": "at://x/app.bsky.feed.post/1"], "$type": "app.bsky.embed.record"]
    #expect(!TemplateEditorModel.editorHasChanges(initial, rebuilt))
  }

  @Test func theTypedDraftKeepsWhatTheFormDoesntKnow() {
    var draft = EditorDrafts.draftFromTemplate(PostTemplate(name: "N", text: "{{a}}"))
    draft.extra["somethingElse"] = 1
    draft.variables[0].extra["note"] = "kept"
    let synced = EditorDrafts.syncDraftVariables(draft)
    #expect(synced.extra["somethingElse"] == 1)
    #expect(synced.variables[0].extra["note"] == "kept")
    #expect(synced.variables[0].key == "a")
  }

  @Test func aReplyBecomesADraftTyped() {
    let (draft, note) = EditorDrafts.draftFromReply(
      text: "Thanks Moss! Moss, have a look.", replyTo: ["author": ["displayName": "Moss Green"]],
      recordEmbed: ["uri": "at://did:plc:me/app.bsky.feed.post/3kq", "cid": "c"])
    #expect(draft.text == "Thanks {{their.firstName}}! {{their.firstName}}, have a look.")
    #expect(note == "“Moss” became a blank that fills in with the first name of whoever you reply to.")
    #expect(draft.quoteMode == "post")
    #expect(draft.use == "reply")
  }
}
