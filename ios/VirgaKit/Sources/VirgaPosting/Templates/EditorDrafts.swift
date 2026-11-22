// Ports src/posting/templates/editorDrafts.js
//
// The template editor's drafts: a template as the form holds it (keywords
// and choices as text, the quote as a mode), and back; and a draft made from
// the reply being written ("Save this reply as a template").
//
// Pure. Each function works on the web's plain objects (JSONValue), exactly
// as the web spreads and reads them, with a typed form over TemplateDraft
// and PostTemplate beside it (EditorDrafts+Typed.swift). As in
// PostTemplates, a shape the web throws a TypeError on (keywords that are a
// string, a keyword or choice that isn't a string where the web calls a
// string method on it) is read as absent.

import Foundation
import VirgaCore
import VirgaNetwork

public enum EditorDrafts {
  static let postCollection = "app.bsky.feed.post"
  static let feedCollection = "app.bsky.feed.generator"
  static let listCollection = "app.bsky.graph.list"
  public static let recordEmbed = "app.bsky.embed.record"
  public static let externalEmbed = "app.bsky.embed.external"

  static let recordUri = JSRegex(#"^at://[^/]+/([^/]+)/[^/?#]+\z"#)

  static func collectionOf(_ uri: JSONValue?) -> String? {
    let text = TemplateJS.str(uri)
    guard let match = recordUri.firstMatch(in: text) else { return nil }
    return match.group(1, in: Array(text.utf16))
  }

  /// The kind of thing a template's embed attaches, as the composer sees
  /// it: 'post' | 'feed' | 'list' | 'link', 'unsupported' for an embed the
  /// composer can't attach from a record (images, a quote with media), or
  /// nil for none.
  public static func templateEmbedKind(_ embed: JSONValue?) -> String? {
    guard let embed, embed.isTruthy else { return nil }
    switch embed {
    case .object, .array: break
    default: return nil
    }
    let type = embed.templateField("$type")?.stringValue
    if type == recordEmbed {
      switch collectionOf(embed.templateField("record")?.templateField("uri")) {
      case postCollection?: return "post"
      case feedCollection?: return "feed"
      case listCollection?: return "list"
      default: return "unsupported"
      }
    }
    if type == externalEmbed && !TemplateJS.str(embed.templateField("external")?.templateField("uri")).isEmpty {
      return "link"
    }
    // Images and recordWithMedia round-trip in the record, but the composer
    // has no way to attach a stored blob, so they are not offered.
    return "unsupported"
  }

  /// A template with nothing in it, the editor's starting point.
  public static let blankTemplate = PostTemplate()

  /// BLANK_TEMPLATE as the web's object.
  public static var blankTemplateJSON: JSONValue { blankTemplate.json }

  // MARK: Variables

  /// The members of `{ ...v }`: an object's own members (anything else
  /// spreads nothing a draft keeps).
  static func members(_ value: JSONValue?) -> [String: JSONValue] {
    value?.objectValue ?? [:]
  }

  static func draftVariable(_ v: JSONValue?) -> JSONValue {
    let choices = (v?.templateField("choices")?.arrayValue ?? []).filter { $0.stringValue != nil }
    var out: [String: JSONValue] = ["label": "", "hint": "", "kind": "text", "default": "", "optional": false]
    for (key, value) in members(v) { out[key] = value }
    out["choices"] = .array(choices)
    let choicesText = v?.templateField("choicesText")?.stringValue
    out["choicesText"] = .string(choicesText ?? choices.compactMap(\.stringValue).joined(separator: "\n"))
    return .object(out)
  }

  /// A Map key as JavaScript compares it (SameValueZero): strings by code
  /// unit, numbers by value, and every object its own key.
  enum MapKey: Hashable {
    case string(JSKey)
    case number(Double)
    case bool(Bool)
    case object(Int)

    init(_ value: JSONValue, at index: Int) {
      switch value {
      case .string(let s): self = .string(JSKey(s))
      case .number(let n): self = .number(n == 0 ? 0 : n)
      case .bool(let b): self = .bool(b)
      default: self = .object(index)
      }
    }
  }

  /// The draft's variables brought in line with its text, in text order: an
  /// entry for every asked blank (kept, or made empty), a context key's
  /// entry where it has one, then any other entries the draft already had,
  /// so a blank deleted and retyped keeps its question until the draft is
  /// saved.
  @_disfavoredOverload
  public static func syncDraftVariables(_ draft: JSONValue?) -> JSONValue {
    var order: [MapKey] = []
    var existing: [MapKey: JSONValue] = [:]
    for (index, v) in TemplateJS.list(draft?.templateField("variables")).enumerated() {
      guard let key = v.templateField("key"), key.isTruthy else { continue }
      let mapKey = MapKey(key, at: index)
      if existing[mapKey] == nil { order.append(mapKey) }
      existing[mapKey] = v
    }
    var variables: [JSONValue] = []
    var placed = Set<JSKey>()
    for key in PostTemplates.placeholderKeys(draft?.templateField("text")) {
      let made: JSONValue? = PostTemplates.isContextKey(key) ? Optional<JSONValue>.none : .object(["key": .string(key)])
      guard let v = existing[.string(JSKey(key))] ?? made else { continue }
      variables.append(draftVariable(v))
      placed.insert(JSKey(key))
    }
    for mapKey in order {
      if case .string(let key) = mapKey, placed.contains(key) { continue }
      variables.append(draftVariable(existing[mapKey]))
    }
    var out = members(draft)
    out["variables"] = .array(variables)
    return .object(out)
  }

  // MARK: Drafts

  static func quoteFields(_ embed: JSONValue?) -> (mode: String, url: String) {
    switch templateEmbedKind(embed) {
    case nil: return ("none", "")
    case "post"?: return ("post", "")
    case "link"?: return ("link", TemplateJS.str(embed?.templateField("external")?.templateField("uri")))
    // A feed or list is attached by pasting its link.
    case "feed"?, "list"?: return ("link", "")
    // Images and the like, which the editor can't show but saving must keep.
    default: return ("other", "")
    }
  }

  /// `list.join(', ')`, as JavaScript joins an array (null and undefined as '').
  static func joined(_ items: [JSONValue], _ separator: String) -> String {
    items.map { $0.isNull ? "" : $0.jsString }.joined(separator: separator)
  }

  /// A template as the editor's draft: the template plus `keywordsText`
  /// (comma-separated), `choicesText` on each variable (one choice per
  /// line), `quoteMode` ('none' | 'post' | 'link', or 'other' for an embed
  /// the editor can't show), `quoteUrl` and `quoteView`. With no template, a
  /// blank draft.
  @_disfavoredOverload
  public static func draftFromTemplate(_ template: JSONValue?) -> JSONValue {
    var base = blankTemplateJSON.objectValue!
    if let template, template.isTruthy {
      for (key, value) in members(template) { base[key] = value }
    }
    let keywords = TemplateJS.list(base["keywords"])
    var draft = base
    draft["variables"] = .array(TemplateJS.list(base["variables"]).map(draftVariable))
    draft["keywords"] = .array(keywords)
    draft["langs"] = .array(TemplateJS.list(base["langs"]))
    draft["keywordsText"] = .string(joined(keywords, ", "))
    let quote = quoteFields(base["embed"])
    draft["quoteMode"] = .string(quote.mode)
    draft["quoteUrl"] = .string(quote.url)
    draft["quoteView"] = .null
    return syncDraftVariables(.object(draft))
  }

  static let escapeRegExpSet: Set<UInt16> = Set(".*+?^${}()|[]\\".utf16)

  // Text a first name inside must stay as written: links, email addresses,
  // handles and hashtags.
  static let nameProtected = JSRegex(
    #"[hH][tT][tT][pP][sSſ]?://[^\#(JSRegex.space)]+|[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}\-]+(?:\.[\p{L}\p{N}\-]+)+|@[\p{L}\p{N}._\-]+|#[\p{L}\p{N}_]+"#)

  /// What draftFromReply reads, as the web's one object of named arguments:
  /// `text`, `reply` (ComposerState.reply) or `replyTo` (a post view),
  /// `record` or `recordEmbed` (`{ uri, cid }`), `card` (`{ url }`) or
  /// `linkUrl`. An absent argument takes its default (`replyTo = reply`,
  /// `recordEmbed = record`, `linkUrl = card?.url`); a null one doesn't.
  @_disfavoredOverload
  public static func draftFromReply(_ args: JSONValue?) -> (draft: JSONValue, note: String?) {
    let a = args ?? .object([:])
    let replyTo = a.templateField("replyTo") ?? a.templateField("reply")
    let recordEmbedValue = a.templateField("recordEmbed") ?? a.templateField("record")
    let linkUrl = a.templateField("linkUrl") ?? a.templateField("card")?.templateField("url")

    var body = TemplateJS.str(a.templateField("text"))
    // `.replace(/\s+$/, '')`.
    var units = Array(body.utf16)
    while let last = units.last, PostingJS.isSpace(last) { units.removeLast() }
    body = String(jsUnits: units)

    var note: String?
    let name = TemplateJS.str(replyTo?.templateField("author")?.templateField("displayName")).jsTrimmed()
    let first = PostTemplates.firstWord.firstMatch(in: name).flatMap { $0.group(0, in: Array(name.utf16)) } ?? ""
    if !first.isEmpty {
      // Not part of a longer word, a path, a handle or a domain; a
      // sentence's full stop after the name is fine.
      let escaped = String(jsUnits: first.utf16.flatMap { escapeRegExpSet.contains($0) ? [0x5C, $0] : [$0] })
      let pattern = JSRegex(
        #"(?<![\p{L}\p{M}\p{N}_@#/\-])(?<![\p{L}\p{N}]\.)"# + escaped + #"(?![\p{L}\p{M}\p{N}_@/\-])(?!\.[\p{L}\p{N}])"#)
      let bodyUnits = Array(body.utf16)
      let spans = nameProtected.matches(in: body).map(\.range)
      let length = first.utf16.count
      func protectedAt(_ at: Int) -> Bool {
        spans.contains { at < $0.upperBound && at + length > $0.lowerBound }
      }
      var out: [UInt16] = []
      var last = 0
      var changed = false
      for match in pattern.matches(in: body) {
        out.append(contentsOf: bodyUnits[last..<match.range.lowerBound])
        if protectedAt(match.range.lowerBound) {
          out.append(contentsOf: bodyUnits[match.range])
        } else {
          out.append(contentsOf: "{{their.firstName}}".utf16)
          changed = true
        }
        last = match.range.upperBound
      }
      out.append(contentsOf: bodyUnits[last...])
      if changed {
        body = String(jsUnits: out)
        note = "“\(first)” became a blank that fills in with the first name of whoever you reply to."
      }
    }

    var embed: JSONValue = .null
    if let uri = recordEmbedValue?.templateField("uri"), uri.isTruthy,
      let cid = recordEmbedValue?.templateField("cid"), cid.isTruthy
    {
      embed = ["$type": .string(recordEmbed), "record": ["uri": uri, "cid": cid]]
    } else if !TemplateJS.str(linkUrl).isEmpty, let linkUrl {
      embed = ["$type": .string(externalEmbed), "external": ["uri": linkUrl, "title": "", "description": ""]]
    }

    var template = blankTemplateJSON.objectValue!
    template["text"] = .string(body)
    template["embed"] = embed
    template["use"] = "reply"
    return (draftFromTemplate(.object(template)), note)
  }

  static func splitList(_ value: JSONValue?, newlinesOnly: Bool) -> [String] {
    var pieces: [String] = []
    var current: [UInt16] = []
    for unit in TemplateJS.str(value).utf16 {
      if unit == 0x0A || (!newlinesOnly && unit == 0x2C) {
        pieces.append(String(jsUnits: current))
        current = []
      } else {
        current.append(unit)
      }
    }
    pieces.append(String(jsUnits: current))
    return pieces.map { $0.jsTrimmed() }.filter { !$0.isEmpty }
  }

  /// The template a draft describes: keywords and choices split from their
  /// text fields, the shortcut without its slash, and variables kept only
  /// for blanks the text still asks. A choice question with no choices
  /// stays a choice question, so validateTemplate can say so.
  @_disfavoredOverload
  public static func templateFromDraft(_ draft: JSONValue?) -> JSONValue {
    let d = draft?.truthy ?? .object([:])
    // A context key's entry is kept too: it labels the question asked when
    // the context is missing.
    let keys = Set(PostTemplates.placeholderKeys(d.templateField("text")).map(JSKey.init))

    var variables: [JSONValue] = []
    for v in TemplateJS.list(d.templateField("variables")) {
      guard let key = v.templateField("key")?.stringValue, !key.isEmpty, keys.contains(JSKey(key)) else { continue }
      var out: [String: JSONValue] = ["key": .string(key)]
      let label = TemplateJS.str(v.templateField("label")).jsTrimmed()
      if !label.isEmpty { out["label"] = .string(label) }
      let hint = TemplateJS.str(v.templateField("hint")).jsTrimmed()
      if !hint.isEmpty { out["hint"] = .string(hint) }
      if v.templateField("kind")?.stringValue == "choice" {
        out["kind"] = "choice"
        let choices: [String]
        if let text = v.templateField("choicesText"), text.stringValue != nil {
          choices = splitList(text, newlinesOnly: true)
        } else {
          choices = TemplateJS.list(v.templateField("choices")).map { TemplateJS.str($0).jsTrimmed() }.filter { !$0.isEmpty }
        }
        out["choices"] = .array(choices.map(JSONValue.string))
      }
      let defaultValue = TemplateJS.str(v.templateField("default")).jsTrimmed()
      if !defaultValue.isEmpty { out["default"] = .string(defaultValue) }
      if v.templateField("optional") == .bool(true) { out["optional"] = true }
      if out.count > 1 { variables.append(.object(out)) }
    }

    var seen = Set<JSKey>()
    var keywords: [JSONValue] = []
    let source: [String]
    if let text = d.templateField("keywordsText"), text.stringValue != nil {
      source = splitList(text, newlinesOnly: false)
    } else if let text = d.templateField("keywords")?.stringValue {
      // `for (const k of 'text')` walks its characters, by code point.
      source = text.unicodeScalars.map { String($0) }
    } else {
      source = TemplateJS.list(d.templateField("keywords")).compactMap(\.stringValue)
    }
    for k in source where seen.insert(JSKey(k.jsLowercased())).inserted {
      keywords.append(.string(k))
    }

    var embed = d.templateField("embed")?.truthy ?? .null
    if d.templateField("quoteMode")?.stringValue == "none" { embed = .null }

    return .object([
      "uri": d.templateField("uri")?.truthy ?? .null,
      "cid": d.templateField("cid")?.truthy ?? .null,
      "rkey": d.templateField("rkey")?.truthy ?? "",
      "name": .string(TemplateJS.str(d.templateField("name"))),
      "text": .string(TemplateJS.str(d.templateField("text"))),
      "variables": .array(variables),
      "embed": embed,
      "use": d.templateField("use")?.truthy ?? "any",
      "group": .string(TemplateJS.str(d.templateField("group"))),
      "shortcut": .string(PostTemplates.normalizeShortcut(d.templateField("shortcut"))),
      "keywords": .array(keywords),
      "langs": .array(d.templateField("langs")?.arrayValue ?? []),
      "createdAt": d.templateField("createdAt")?.truthy ?? .null,
      "updatedAt": d.templateField("updatedAt")?.truthy ?? .null,
    ])
  }
}
