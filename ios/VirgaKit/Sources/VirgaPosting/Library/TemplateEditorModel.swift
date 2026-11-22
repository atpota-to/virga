// Ports src/posting/library/templateEditorModel.js
//
// The template editor's form logic, outside the view: putting a blank in at
// the caret, naming a new blank from its question, telling whether the form
// has changes worth asking about, and which problems to show. Each function
// works on the web's objects (JSONValue), with a typed form over
// TemplateDraft beside it.
//
// One deliberate difference: editorHasChanges compares what saving would
// write by value, where the web compares its JSON text, so an attached
// record rebuilt with its keys in another order reads as no change here and
// as a change on the web.

import Foundation
import VirgaCore
import VirgaNetwork

/// A text selection in UTF-16 code units, `[start, end)`.
public struct TextSelection: Codable, Hashable, Sendable {
  public var start: Int
  public var end: Int

  public init(start: Int, end: Int) {
    self.start = start
    self.end = end
  }
}

/// insertAtSelection's result: the new text and the caret after the token.
public struct TextInsertion: Codable, Hashable, Sendable {
  public var text: String
  public var caret: Int
}

/// addBlank's result.
public struct AddedBlank: Hashable, Sendable {
  public var draft: TemplateDraft
  public var caret: Int
  public var key: String
}

/// blanksIn's result: the blanks the text asks, and the ones that fill
/// themselves.
public struct TemplateBlanks: Hashable, Sendable {
  public struct ContextBlank: Codable, Hashable, Sendable {
    public var key: String
    public var label: String
  }

  public var asked: [DraftVariable]
  public var context: [ContextBlank]
}

/// An option of the editor's choice: a value and its words.
public struct TemplateEditorOption: Codable, Hashable, Sendable {
  public var value: String
  public var label: String
}

/// A context blank the editor offers to put in, with its button's words.
public struct ContextInsert: Codable, Hashable, Sendable {
  public var key: String
  public var label: String
}

public enum TemplateEditorModel {
  /// Where a template is offered, as the editor's choice.
  public static let useOptions = [
    TemplateEditorOption(value: "reply", label: "Replying"),
    TemplateEditorOption(value: "post", label: "A new post"),
    TemplateEditorOption(value: "any", label: "Either"),
  ]

  /// The context blanks the editor offers to put in, with their buttons' words.
  public static let contextInserts = [
    ContextInsert(key: "their.firstName", label: "Their first name"),
    ContextInsert(key: "their.handle", label: "Their handle"),
    ContextInsert(key: "my.handle", label: "Your handle"),
    ContextInsert(key: "today", label: "Today’s date"),
  ]

  // MARK: Inserting

  /// `token` put in `text` over the selection `[start, end)` (the end of
  /// the text without one), with a space either side where it would
  /// otherwise run into a word. Positions may be any numbers, as the web's
  /// are: clamped to the text, and a fraction cut off.
  public static func insertAtSelection(_ text: String, _ token: String, start: Double?, end: Double?) -> TextInsertion {
    let units = Array(text.utf16)
    let len = Double(units.count)
    func finite(_ value: Double?) -> Double? { value.flatMap { $0.isFinite ? $0 : nil } }
    var from = finite(start).map { max(0, min($0, len)) } ?? len
    var to = finite(end).map { max(0, min($0, len)) } ?? from
    if to < from { swap(&from, &to) }
    let before = Array(units[0..<Int(from)])
    let after = Array(units[Int(to)...])
    let lead: [UInt16] = !before.isEmpty && !PostingJS.isSpace(before.last!) ? [0x20] : []
    let trail: [UInt16] = {
      guard let first = after.first else { return [] }
      let keeps = PostingJS.isSpace(first) || [0x2E, 0x2C, 0x3B, 0x3A, 0x21, 0x3F, 0x29].contains(first)
      return keeps ? [] : [0x20]
    }()
    let head = before + lead + Array(token.utf16)
    return TextInsertion(text: String(jsUnits: head + trail + after), caret: head.count)
  }

  /// insertAtSelection with a selection (nil for the end of the text).
  public static func insertAtSelection(_ text: String, _ token: String, _ selection: TextSelection? = nil) -> TextInsertion {
    insertAtSelection(text, token, start: selection.map { Double($0.start) }, end: selection.map { Double($0.end) })
  }

  /// insertAtSelection as the web takes it: `String(text ?? '')`, and a
  /// selection whose `start` and `end` count only when they are numbers.
  @_disfavoredOverload
  public static func insertAtSelection(_ text: JSONValue?, _ token: String, _ selection: JSONValue?) -> TextInsertion {
    insertAtSelection(
      text.nonNull?.jsString ?? "", token,
      start: selection?.templateField("start")?.doubleValue, end: selection?.templateField("end")?.doubleValue)
  }

  // MARK: Blanks

  /// A new blank asked with `label` ("Which app?"), put in at the
  /// selection: `{ draft, caret, key }`, or nil when the label gives no
  /// usable key. A key the template already uses gets a number, so two
  /// questions never share an answer by accident.
  @_disfavoredOverload
  public static func addBlank(_ draft: JSONValue?, _ label: JSONValue?, _ selection: JSONValue?) -> JSONValue? {
    let base = PostTemplates.blankKeyFromLabel(label)
    if base.isEmpty || PostTemplates.isContextKey(base) { return nil }
    var used = Set(PostTemplates.placeholderKeys(draft?.templateField("text")).map(JSKey.init))
    for v in TemplateJS.list(draft?.templateField("variables")) {
      if let key = v.templateField("key")?.stringValue { used.insert(JSKey(key)) }
    }
    var key = base
    var n = 2
    while used.contains(JSKey(key)) {
      key = String(base.prefix(30)) + String(n)
      n += 1
    }
    let inserted = insertAtSelection(draft?.templateField("text"), "{{\(key)}}", selection)
    var spread = TemplateJS.spread(draft)
    spread["text"] = .string(inserted.text)
    let synced = EditorDrafts.syncDraftVariables(.object(spread))
    let question = TemplateJS.string(label).jsTrimmed()
    let variables = TemplateJS.list(synced.templateField("variables")).map { v -> JSONValue in
      guard v.templateField("key")?.stringValue?.jsEquals(key) == true, case .object(var members) = v else { return v }
      members["label"] = .string(question)
      return .object(members)
    }
    var out = synced.objectValue ?? [:]
    out["variables"] = .array(variables)
    return ["draft": .object(out), "caret": .number(Double(inserted.caret)), "key": .string(key)]
  }

  /// addBlank over a typed draft.
  public static func addBlank(_ draft: TemplateDraft, _ label: String, _ selection: TextSelection? = nil) -> AddedBlank? {
    let selectionJSON: JSONValue? = selection.map { ["start": .number(Double($0.start)), "end": .number(Double($0.end))] }
    guard let out = addBlank(draft.json, .string(label), selectionJSON),
      let caret = out["caret"]?.intValue, let key = out["key"]?.stringValue, let next = out["draft"]
    else { return nil }
    return AddedBlank(draft: TemplateDraft(json: next), caret: caret, key: key)
  }

  /// The draft with `key`'s question changed by `patch`.
  @_disfavoredOverload
  public static func patchVariable(_ draft: JSONValue?, _ key: String, _ patch: JSONValue?) -> JSONValue {
    let variables = TemplateJS.list(draft?.templateField("variables")).map { v -> JSONValue in
      guard v.templateField("key")?.stringValue?.jsEquals(key) == true, case .object(var members) = v else { return v }
      for (name, value) in TemplateJS.spread(patch) { members[name] = value }
      return .object(members)
    }
    var out = TemplateJS.spread(draft)
    out["variables"] = .array(variables)
    return .object(out)
  }

  /// patchVariable over a typed draft: `patch` is the members to set.
  public static func patchVariable(_ draft: TemplateDraft, _ key: String, _ patch: [String: JSONValue]) -> TemplateDraft {
    TemplateDraft(json: patchVariable(draft.json, key, .object(patch)))
  }

  /// The blanks the text asks, in order, split into asked questions and
  /// the ones that fill themselves.
  @_disfavoredOverload
  public static func blanksIn(_ draft: JSONValue?) -> JSONValue {
    let keys = PostTemplates.placeholderKeys(draft?.templateField("text"))
    var byKey: [JSKey: JSONValue] = [:]
    for v in TemplateJS.list(draft?.templateField("variables")) {
      if let key = v.templateField("key")?.stringValue { byKey[JSKey(key)] = v }
    }
    let asked = keys.filter { !PostTemplates.isContextKey($0) }.map { byKey[JSKey($0)] ?? ["key": .string($0)] }
    let context = keys.filter { PostTemplates.isContextKey($0) }.map { key -> JSONValue in
      ["key": .string(key), "label": .string(PostTemplates.contextLabel(key) ?? key)]
    }
    return ["asked": .array(asked), "context": .array(context)]
  }

  /// blanksIn over a typed draft.
  public static func blanksIn(_ draft: TemplateDraft) -> TemplateBlanks {
    let out = blanksIn(draft.json)
    return TemplateBlanks(
      asked: (out["asked"]?.arrayValue ?? []).map(DraftVariable.init(json:)),
      context: (out["context"]?.arrayValue ?? []).map {
        TemplateBlanks.ContextBlank(key: $0["key"]?.stringValue ?? "", label: $0["label"]?.stringValue ?? "")
      })
  }

  // MARK: Changes and problems

  // What saving would write, for comparing two states of the form.
  static func signature(_ draft: JSONValue?) -> String {
    let t = EditorDrafts.templateFromDraft(draft?.truthy ?? .object([:]))
    let fields = ["name", "text", "variables", "embed", "use", "group", "shortcut", "keywords"]
    return JSONStringify.stringify(.array(fields.map { t[$0] ?? .null }))
  }

  /// Whether the form would save something other than what it started from.
  @_disfavoredOverload
  public static func editorHasChanges(_ initial: JSONValue?, _ draft: JSONValue?) -> Bool {
    !signature(initial).jsEquals(signature(draft))
  }

  public static func editorHasChanges(_ initial: TemplateDraft, _ draft: TemplateDraft) -> Bool {
    editorHasChanges(initial.json, draft.json)
  }

  /// The problems to show beside the form, `{ field: message }`: the
  /// template's own (validateTemplate, against the account's other
  /// templates), plus one for a link pasted to attach that hasn't been read
  /// yet.
  @_disfavoredOverload
  public static func editorProblems<O: TemplateFields>(_ draft: JSONValue?, _ others: [O]) -> TemplateFieldErrors {
    let template = EditorDrafts.templateFromDraft(draft?.truthy ?? .object([:]))
    var problems = PostTemplates.validateTemplate(template, others)
    if draft?.templateField("quoteMode")?.stringValue == "link",
      !TemplateJS.orEmpty(draft?.templateField("quoteUrl")).jsTrimmed().isEmpty,
      !(draft?.templateField("embed")?.isTruthy ?? false)
    {
      problems["quote"] = "Read the link first, or clear it."
    }
    return problems
  }

  public static func editorProblems(_ draft: TemplateDraft, _ others: [PostTemplate] = []) -> TemplateFieldErrors {
    editorProblems(draft.json, others)
  }
}
