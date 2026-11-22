// Ports src/posting/templates/postTemplates.js
//
// The shapes postTemplates.js works with, as Swift values that encode to the
// web's JSON: a template as the app holds it (normalizeTemplateRecord's
// result), the context its blanks fill from, the questions it asks, the
// parts of its preview, and the problems validateTemplate finds.
//
// The web's functions take loose objects (a template may be a record read
// back, a draft, or anything a caller built), so the ports take
// `some TemplateFields`: JSONValue is read member by member exactly as the
// web reads it, and PostTemplate (or a TemplateDraft) answers the same
// members without a round trip through JSON.

import Foundation
import VirgaCore

// MARK: - Reading a template loosely

/// Something a template function can read the way the web reads a plain
/// object: `template.<name>`, nil where the web reads `undefined`.
public protocol TemplateFields {
  func templateField(_ name: String) -> JSONValue?
  /// Whether the web reads the value as truthy (a list's `.filter(Boolean)`).
  var templateIsPresent: Bool { get }
  /// The members `{ ...template }` spreads, or nil when `typeof template`
  /// isn't 'object'.
  var templateObject: [String: JSONValue]? { get }
}

extension TemplateFields {
  public var templateIsPresent: Bool { true }
}

extension JSONValue: TemplateFields {
  /// The member of an object; nil for any other value (a string's or a
  /// number's member is `undefined` on the web too, and null is no template).
  public func templateField(_ name: String) -> JSONValue? {
    guard case .object(let members) = self else { return nil }
    return members.jsValue(name)
  }

  public var templateIsPresent: Bool { isTruthy }

  public var templateObject: [String: JSONValue]? {
    switch self {
    case .object(let members): return members
    // An array spreads its elements under their indexes, none of which a
    // template function reads.
    case .array: return [:]
    default: return nil
    }
  }
}

// MARK: - A template

/// A template as the app works with it: normalizeTemplateRecord's result
/// (and templateFromDraft's). Encodes to the web's object, nulls included.
public struct PostTemplate: Codable, Hashable, Sendable, TemplateFields {
  public var uri: String?
  public var cid: String?
  public var rkey: String
  public var name: String
  public var text: String
  public var variables: [TemplateVariable]
  /// The record's embed as stored: any object (or array) the record held.
  public var embed: JSONValue?
  /// 'any' | 'reply' | 'post' once normalized; templateFromDraft passes the
  /// draft's own value through.
  public var use: String
  public var group: String
  public var shortcut: String
  public var keywords: [String]
  public var langs: [String]
  public var createdAt: String?
  public var updatedAt: String?

  public init(
    uri: String? = nil,
    cid: String? = nil,
    rkey: String = "",
    name: String = "",
    text: String = "",
    variables: [TemplateVariable] = [],
    embed: JSONValue? = nil,
    use: String = "any",
    group: String = "",
    shortcut: String = "",
    keywords: [String] = [],
    langs: [String] = [],
    createdAt: String? = nil,
    updatedAt: String? = nil
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
  }

  enum CodingKeys: String, CodingKey {
    case uri, cid, rkey, name, text, variables, embed, use, group, shortcut, keywords, langs, createdAt, updatedAt
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    uri = try c.decodeIfPresent(String.self, forKey: .uri)
    cid = try c.decodeIfPresent(String.self, forKey: .cid)
    rkey = try c.decodeIfPresent(String.self, forKey: .rkey) ?? ""
    name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
    text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
    variables = try c.decodeIfPresent([TemplateVariable].self, forKey: .variables) ?? []
    let embed = try c.decodeIfPresent(JSONValue.self, forKey: .embed)
    self.embed = embed?.isNull == true ? nil : embed
    use = try c.decodeIfPresent(String.self, forKey: .use) ?? "any"
    group = try c.decodeIfPresent(String.self, forKey: .group) ?? ""
    shortcut = try c.decodeIfPresent(String.self, forKey: .shortcut) ?? ""
    keywords = try c.decodeIfPresent([String].self, forKey: .keywords) ?? []
    langs = try c.decodeIfPresent([String].self, forKey: .langs) ?? []
    createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
    updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
  }

  public func encode(to encoder: Encoder) throws {
    try json.encode(to: encoder)
  }

  /// The template as the web's object (`uri`, `cid`, `embed`, `createdAt`
  /// and `updatedAt` null when absent).
  public var json: JSONValue {
    .object([
      "uri": uri.map(JSONValue.string) ?? .null,
      "cid": cid.map(JSONValue.string) ?? .null,
      "rkey": .string(rkey),
      "name": .string(name),
      "text": .string(text),
      "variables": .array(variables.map(\.templateJSON)),
      "embed": embed ?? .null,
      "use": .string(use),
      "group": .string(group),
      "shortcut": .string(shortcut),
      "keywords": .array(keywords.map(JSONValue.string)),
      "langs": .array(langs.map(JSONValue.string)),
      "createdAt": createdAt.map(JSONValue.string) ?? .null,
      "updatedAt": updatedAt.map(JSONValue.string) ?? .null,
    ])
  }

  public var templateObject: [String: JSONValue]? { json.objectValue }

  public func templateField(_ name: String) -> JSONValue? {
    switch name {
    case "uri": return uri.map(JSONValue.string) ?? .null
    case "cid": return cid.map(JSONValue.string) ?? .null
    case "rkey": return .string(rkey)
    case "name": return .string(self.name)
    case "text": return .string(text)
    case "variables": return .array(variables.map(\.templateJSON))
    case "embed": return embed ?? .null
    case "use": return .string(use)
    case "group": return .string(group)
    case "shortcut": return .string(shortcut)
    case "keywords": return .array(keywords.map(JSONValue.string))
    case "langs": return .array(langs.map(JSONValue.string))
    case "createdAt": return createdAt.map(JSONValue.string) ?? .null
    case "updatedAt": return updatedAt.map(JSONValue.string) ?? .null
    default: return nil
    }
  }

  /// A template read from its JSON as normalizeTemplateRecord's result
  /// holds it. Members of another type read as absent.
  public init(json: JSONValue) {
    func string(_ key: String) -> String? { json.templateField(key)?.stringValue }
    func strings(_ key: String) -> [String] { json.templateField(key)?.arrayValue?.compactMap(\.stringValue) ?? [] }
    let embed = json.templateField("embed")
    self.init(
      uri: string("uri"),
      cid: string("cid"),
      rkey: string("rkey") ?? "",
      name: string("name") ?? "",
      text: string("text") ?? "",
      variables: (json.templateField("variables")?.arrayValue ?? []).compactMap(TemplateVariable.init(templateJSON:)),
      embed: embed?.isNull == false ? embed : nil,
      use: string("use") ?? "any",
      group: string("group") ?? "",
      shortcut: string("shortcut") ?? "",
      keywords: strings("keywords"),
      langs: strings("langs"),
      createdAt: string("createdAt"),
      updatedAt: string("updatedAt")
    )
  }
}

extension TemplateVariable {
  /// The blank as the web's object: `key`, then whichever of `label`,
  /// `hint`, `kind`, `choices`, `default` and `optional` it has (and any
  /// fields kept from elsewhere).
  public var templateJSON: JSONValue {
    var out = extra
    out["key"] = .string(key)
    if let label { out["label"] = .string(label) }
    if let hint { out["hint"] = .string(hint) }
    if let kind { out["kind"] = .string(kind) }
    if let choices { out["choices"] = .array(choices.map(JSONValue.string)) }
    if let `default` { out["default"] = .string(`default`) }
    if let optional { out["optional"] = .bool(optional) }
    return .object(out)
  }

  /// A blank read from JSON: nil without a string key. Members of another
  /// type read as absent.
  public init?(templateJSON json: JSONValue) {
    guard case .object(let members) = json, let key = members["key"]?.stringValue else { return nil }
    var extra = members
    for name in ["key", "label", "hint", "kind", "choices", "default", "optional"] { extra[name] = nil }
    self.init(
      key: key,
      label: members["label"]?.stringValue,
      hint: members["hint"]?.stringValue,
      kind: members["kind"]?.stringValue,
      choices: members["choices"]?.arrayValue?.compactMap(\.stringValue),
      default: members["default"]?.stringValue,
      optional: members["optional"]?.boolValue,
      extra: extra
    )
  }
}

// MARK: - Limits

/// TEMPLATE_LIMITS.
public struct TemplateLimits: Codable, Hashable, Sendable {
  public var nameGraphemes = 64
  public var textGraphemes = 300
  public var groupGraphemes = 64
  public var shortcutLength = 32
  public var keyLength = 32
  public var labelGraphemes = 64
  public var hintGraphemes = 200
  public var choiceGraphemes = 300
  public var variables = 12
  public var choices = 12
  public var keywords = 20
  public var keywordLength = 64
  public var langs = 3
}

// MARK: - Context

/// buildTemplateContext's result: what the context keys fill from.
public struct TemplateContext: Codable, Hashable, Sendable {
  /// The author of the post being replied to.
  public struct Their: Codable, Hashable, Sendable {
    public var name: String?
    public var firstName: String?
    public var handle: String?

    public init(name: String? = nil, firstName: String? = nil, handle: String? = nil) {
      self.name = name
      self.firstName = firstName
      self.handle = handle
    }

    public func encode(to encoder: Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(name, forKey: .name)
      try c.encode(firstName, forKey: .firstName)
      try c.encode(handle, forKey: .handle)
    }
  }

  /// The signed-in account.
  public struct My: Codable, Hashable, Sendable {
    public var handle: String?

    public init(handle: String? = nil) { self.handle = handle }

    public func encode(to encoder: Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(handle, forKey: .handle)
    }
  }

  /// nil without a post being replied to (the web's `their: null`).
  public var their: Their?
  public var my: My?
  public var today: String?

  public init(their: Their? = nil, my: My? = My(), today: String? = nil) {
    self.their = their
    self.my = my
    self.today = today
  }

  enum CodingKeys: String, CodingKey { case their, my, today }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(their, forKey: .their)
    try c.encodeIfPresent(my, forKey: .my)
    try c.encodeIfPresent(today, forKey: .today)
  }

  /// A context object as a caller built it, read the way contextValue and
  /// templateQuestions read it: a falsy member is absent, and a member that
  /// isn't a string is its String form (the web passes it through, and
  /// writes it into the text the same way).
  public init?(json: JSONValue?) {
    guard let json, json.isTruthy else { return nil }
    func text(_ value: JSONValue?) -> String? {
      guard let value, value.isTruthy else { return nil }
      return value.stringValue ?? value.jsString
    }
    let their = json.templateField("their")
    self.their = their?.isTruthy == true
      ? Their(
        name: text(their?.templateField("name")),
        firstName: text(their?.templateField("firstName")),
        handle: text(their?.templateField("handle")))
      : nil
    let my = json.templateField("my")
    self.my = my?.isTruthy == true ? My(handle: text(my?.templateField("handle"))) : nil
    self.today = text(json.templateField("today"))
  }
}

// MARK: - Questions, segments, parts

/// One question a template asks (templateQuestions).
public struct TemplateQuestion: Codable, Hashable, Sendable {
  public var key: String
  public var label: String
  public var hint: String
  /// 'text' | 'choice'
  public var kind: String
  public var choices: [String]
  public var optional: Bool
  public var defaultValue: String
  public var note: String
  public var isContext: Bool

  public init(
    key: String, label: String, hint: String = "", kind: String = "text", choices: [String] = [],
    optional: Bool = false, defaultValue: String = "", note: String = "", isContext: Bool = false
  ) {
    self.key = key
    self.label = label
    self.hint = hint
    self.kind = kind
    self.choices = choices
    self.optional = optional
    self.defaultValue = defaultValue
    self.note = note
    self.isContext = isContext
  }
}

/// A piece of a template's text: its own words, or a blank.
public enum TemplateSegment: Hashable, Sendable, Codable {
  case text(String)
  case blank(key: String)

  enum CodingKeys: String, CodingKey { case type, value, key }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    if try c.decode(String.self, forKey: .type) == "blank" {
      self = .blank(key: try c.decode(String.self, forKey: .key))
    } else {
      self = .text(try c.decode(String.self, forKey: .value))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .text(let value):
      try c.encode("text", forKey: .type)
      try c.encode(value, forKey: .value)
    case .blank(let key):
      try c.encode("blank", forKey: .type)
      try c.encode(key, forKey: .key)
    }
  }
}

/// A part of a filled or previewed template: `text` and where it came from.
/// `kind` is 'text' (the template's own words), 'value' (fillTemplate's
/// filled blank), 'context', 'answer', 'blank' (still to answer; `text` is
/// what to show) or 'empty' (a blank that fills with nothing, which
/// tidyTemplateParts closes and drops).
public struct TemplatePart: Codable, Hashable, Sendable {
  public var text: String
  public var kind: String
  public var key: String?

  public init(text: String, kind: String, key: String? = nil) {
    self.text = text
    self.kind = kind
    self.key = key
  }
}

/// describeTemplate's result.
public struct TemplateDescription: Codable, Hashable, Sendable {
  public var questions: Int
  public var quotes: Bool
  public var fillsContext: Bool

  public init(questions: Int, quotes: Bool, fillsContext: Bool) {
    self.questions = questions
    self.quotes = quotes
    self.fillsContext = fillsContext
  }
}

// MARK: - Field errors

/// `{ field: message }`, in the order the web adds them (the first is the
/// message a refused save shows).
public struct TemplateFieldErrors: Hashable, Sendable, Codable, ExpressibleByDictionaryLiteral {
  public struct Entry: Hashable, Sendable {
    public var field: String
    public var message: String
  }

  public private(set) var entries: [Entry] = []

  public init() {}

  public init(dictionaryLiteral elements: (String, String)...) {
    for (field, message) in elements { self[field] = message }
  }

  public var isEmpty: Bool { entries.isEmpty }
  public var count: Int { entries.count }
  public var fields: [String] { entries.map(\.field) }

  /// `Object.values(errors)[0]`.
  public var firstMessage: String? { entries.first?.message }

  /// `errors[field]`; setting an existing field keeps its place.
  public subscript(field: String) -> String? {
    get { entries.first { $0.field.jsEquals(field) }?.message }
    set {
      if let index = entries.firstIndex(where: { $0.field.jsEquals(field) }) {
        if let newValue { entries[index].message = newValue } else { entries.remove(at: index) }
      } else if let newValue {
        entries.append(Entry(field: field, message: newValue))
      }
    }
  }

  public var json: JSONValue {
    var out: [String: JSONValue] = [:]
    for entry in entries { out[entry.field] = .string(entry.message) }
    return .object(out)
  }

  public init(from decoder: Decoder) throws {
    let object = try [String: String](from: decoder)
    for key in object.keys.sorted() { self[key] = object[key] }
  }

  public func encode(to encoder: Encoder) throws {
    try json.encode(to: encoder)
  }
}

// MARK: - Answers

/// What a template's blanks were answered with, read as answerFor reads
/// the web's answers object: own members only, as their trimmed String
/// form, '' for none.
public protocol TemplateAnswers {
  func templateAnswer(_ key: String) -> String
}

extension JSONValue: TemplateAnswers {
  public func templateAnswer(_ key: String) -> String {
    let value: JSONValue
    switch self {
    case .object(let members):
      guard let member = members.jsValue(key) else { return "" }
      value = member
    case .array(let items):
      // An array's one own named member a blank key can name.
      guard key == "length" else { return "" }
      value = .number(Double(items.count))
    default:
      return ""
    }
    return value.isNull ? "" : value.jsString.jsTrimmed()
  }
}

extension Dictionary: TemplateAnswers where Key == String, Value == String {
  public func templateAnswer(_ key: String) -> String {
    (jsValue(key) ?? "").jsTrimmed()
  }
}
