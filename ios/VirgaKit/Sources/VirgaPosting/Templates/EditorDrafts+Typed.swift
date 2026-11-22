// Ports src/posting/templates/editorDrafts.js
//
// The editor's draft as a Swift value, for the form to bind to, and the
// draft functions over it. Each goes through the web's object form
// (EditorDrafts.swift), so the typed and the loose forms can't drift apart.

import Foundation
import VirgaCore

/// One blank as the editor holds it: the record's fields with their
/// defaults filled in, and `choicesText` (one choice per line).
public struct DraftVariable: Codable, Hashable, Sendable {
  public var key: String
  public var label: String
  public var hint: String
  /// 'text' | 'choice'
  public var kind: String
  public var `default`: String
  public var optional: Bool
  public var choices: [String]
  public var choicesText: String
  /// Fields a record held that the editor doesn't, kept for the save.
  public var extra: [String: JSONValue]

  public init(
    key: String, label: String = "", hint: String = "", kind: String = "text", default: String = "",
    optional: Bool = false, choices: [String] = [], choicesText: String = "", extra: [String: JSONValue] = [:]
  ) {
    self.key = key
    self.label = label
    self.hint = hint
    self.kind = kind
    self.default = `default`
    self.optional = optional
    self.choices = choices
    self.choicesText = choicesText
    self.extra = extra
  }

  static let fields = ["key", "label", "hint", "kind", "default", "optional", "choices", "choicesText"]

  public init(json: JSONValue) {
    let m = json.objectValue ?? [:]
    var extra = m
    for name in Self.fields { extra[name] = nil }
    self.init(
      key: m["key"]?.stringValue ?? "",
      label: m["label"]?.stringValue ?? "",
      hint: m["hint"]?.stringValue ?? "",
      kind: m["kind"]?.stringValue ?? "text",
      default: m["default"]?.stringValue ?? "",
      optional: m["optional"]?.boolValue ?? false,
      choices: m["choices"]?.arrayValue?.compactMap(\.stringValue) ?? [],
      choicesText: m["choicesText"]?.stringValue ?? "",
      extra: extra)
  }

  public var json: JSONValue {
    var out = extra
    out["key"] = .string(key)
    out["label"] = .string(label)
    out["hint"] = .string(hint)
    out["kind"] = .string(kind)
    out["default"] = .string(`default`)
    out["optional"] = .bool(optional)
    out["choices"] = .array(choices.map(JSONValue.string))
    out["choicesText"] = .string(choicesText)
    return .object(out)
  }

  public init(from decoder: Decoder) throws { self.init(json: try JSONValue(from: decoder)) }
  public func encode(to encoder: Encoder) throws { try json.encode(to: encoder) }
}

/// A template as the editor's form holds it (draftFromTemplate's result):
/// the template's fields, plus `keywordsText`, `quoteMode` ('none' | 'post'
/// | 'link' | 'other'), `quoteUrl` and `quoteView` (the attached record's
/// view, once read).
public struct TemplateDraft: Codable, Hashable, Sendable, TemplateFields {
  public var uri: String?
  public var cid: String?
  public var rkey: String
  public var name: String
  public var text: String
  public var variables: [DraftVariable]
  public var embed: JSONValue?
  public var use: String
  public var group: String
  public var shortcut: String
  public var keywords: [String]
  public var langs: [String]
  public var createdAt: String?
  public var updatedAt: String?
  public var keywordsText: String
  public var quoteMode: String
  public var quoteUrl: String
  public var quoteView: JSONValue?
  /// Members the form doesn't know, kept as the web's spreads keep them.
  public var extra: [String: JSONValue]

  public init(
    uri: String? = nil, cid: String? = nil, rkey: String = "", name: String = "", text: String = "",
    variables: [DraftVariable] = [], embed: JSONValue? = nil, use: String = "any", group: String = "",
    shortcut: String = "", keywords: [String] = [], langs: [String] = [], createdAt: String? = nil,
    updatedAt: String? = nil, keywordsText: String = "", quoteMode: String = "none", quoteUrl: String = "",
    quoteView: JSONValue? = nil, extra: [String: JSONValue] = [:]
  ) {
    self.uri = uri
    self.cid = cid
    self.rkey = rkey
    self.name = name
    self.text = text
    self.variables = variables
    self.embed = embed
    self.use = use
    self.group = group
    self.shortcut = shortcut
    self.keywords = keywords
    self.langs = langs
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.keywordsText = keywordsText
    self.quoteMode = quoteMode
    self.quoteUrl = quoteUrl
    self.quoteView = quoteView
    self.extra = extra
  }

  static let fields = [
    "uri", "cid", "rkey", "name", "text", "variables", "embed", "use", "group", "shortcut", "keywords", "langs",
    "createdAt", "updatedAt", "keywordsText", "quoteMode", "quoteUrl", "quoteView",
  ]

  /// A draft read from the web's object. Members of another type read as
  /// their defaults.
  public init(json: JSONValue) {
    let m = json.objectValue ?? [:]
    func present(_ value: JSONValue?) -> JSONValue? { value?.isNull == false ? value : nil }
    var extra = m
    for name in Self.fields { extra[name] = nil }
    self.init(
      uri: m["uri"]?.stringValue,
      cid: m["cid"]?.stringValue,
      rkey: m["rkey"]?.stringValue ?? "",
      name: m["name"]?.stringValue ?? "",
      text: m["text"]?.stringValue ?? "",
      variables: (m["variables"]?.arrayValue ?? []).map(DraftVariable.init(json:)),
      embed: present(m["embed"]),
      use: m["use"]?.stringValue ?? "any",
      group: m["group"]?.stringValue ?? "",
      shortcut: m["shortcut"]?.stringValue ?? "",
      keywords: m["keywords"]?.arrayValue?.compactMap(\.stringValue) ?? [],
      langs: m["langs"]?.arrayValue?.compactMap(\.stringValue) ?? [],
      createdAt: m["createdAt"]?.stringValue,
      updatedAt: m["updatedAt"]?.stringValue,
      keywordsText: m["keywordsText"]?.stringValue ?? "",
      quoteMode: m["quoteMode"]?.stringValue ?? "none",
      quoteUrl: m["quoteUrl"]?.stringValue ?? "",
      quoteView: present(m["quoteView"]),
      extra: extra)
  }

  public var json: JSONValue {
    var out = extra
    out["uri"] = uri.map(JSONValue.string) ?? .null
    out["cid"] = cid.map(JSONValue.string) ?? .null
    out["rkey"] = .string(rkey)
    out["name"] = .string(name)
    out["text"] = .string(text)
    out["variables"] = .array(variables.map(\.json))
    out["embed"] = embed ?? .null
    out["use"] = .string(use)
    out["group"] = .string(group)
    out["shortcut"] = .string(shortcut)
    out["keywords"] = .array(keywords.map(JSONValue.string))
    out["langs"] = .array(langs.map(JSONValue.string))
    out["createdAt"] = createdAt.map(JSONValue.string) ?? .null
    out["updatedAt"] = updatedAt.map(JSONValue.string) ?? .null
    out["keywordsText"] = .string(keywordsText)
    out["quoteMode"] = .string(quoteMode)
    out["quoteUrl"] = .string(quoteUrl)
    out["quoteView"] = quoteView ?? .null
    return .object(out)
  }

  public func templateField(_ name: String) -> JSONValue? { json.templateField(name) }
  public var templateObject: [String: JSONValue]? { json.objectValue }

  public init(from decoder: Decoder) throws { self.init(json: try JSONValue(from: decoder)) }
  public func encode(to encoder: Encoder) throws { try json.encode(to: encoder) }
}

extension EditorDrafts {
  /// syncDraftVariables over a typed draft.
  public static func syncDraftVariables(_ draft: TemplateDraft) -> TemplateDraft {
    TemplateDraft(json: syncDraftVariables(draft.json))
  }

  /// draftFromTemplate over a template (nil for a blank draft).
  public static func draftFromTemplate(_ template: PostTemplate?) -> TemplateDraft {
    TemplateDraft(json: draftFromTemplate(template?.json))
  }

  /// draftFromTemplate over a draft (the editor's seed from draftFromReply).
  public static func draftFromTemplate(_ draft: TemplateDraft) -> TemplateDraft {
    TemplateDraft(json: draftFromTemplate(draft.json))
  }

  /// draftFromReply with its arguments named: the composer's text, the post
  /// being replied to (a post view), the attached record (`{ uri, cid }`)
  /// and the link card's URL.
  public static func draftFromReply(
    text: String, replyTo: JSONValue? = nil, recordEmbed: JSONValue? = nil, linkUrl: String? = nil
  ) -> (draft: TemplateDraft, note: String?) {
    var args: [String: JSONValue] = ["text": .string(text)]
    if let replyTo { args["replyTo"] = replyTo }
    if let recordEmbed { args["recordEmbed"] = recordEmbed }
    if let linkUrl { args["linkUrl"] = .string(linkUrl) }
    let (draft, note) = draftFromReply(.object(args))
    return (TemplateDraft(json: draft), note)
  }

  /// templateFromDraft over a typed draft.
  public static func templateFromDraft(_ draft: TemplateDraft) -> PostTemplate {
    PostTemplate(json: templateFromDraft(draft.json))
  }
}
