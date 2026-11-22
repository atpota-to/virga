// Ports src/posting/library/model.js
//
// The library model's shapes: an item on a shelf (LibraryItem), what using
// one would do to the post (LibraryPreview) and what the composer then does
// (LibraryPlan), and the clock the shelves' dates are read on.
//
// Each encodes to the web's object, member for member, so the parity
// fixtures compare them directly. The web builds these as plain objects and
// spreads them; LibraryItem keeps any member it doesn't model in `extra`, so
// a spread item keeps what it carried.

import Foundation
import VirgaCore

/// A shelf the library lists: `{ id, label }`.
public struct LibraryShelf: Codable, Hashable, Sendable {
  public var id: String
  public var label: String

  public init(id: String, label: String) {
    self.id = id
    self.label = label
  }
}

/// When "now" is, and the locale and zone a date is written in. The web
/// reads `new Date()`, `activeLocale()` and the runtime's zone; nil locale
/// and zone are the active ones (AppLocale).
public struct LibraryClock: Hashable, Sendable {
  public var now: Date
  public var locale: String?
  public var timeZone: TimeZone?

  public init(now: Date = Date(), locale: String? = nil, timeZone: TimeZone? = nil) {
    self.now = now
    self.locale = locale
    self.timeZone = timeZone
  }

  var zone: TimeZone { timeZone ?? AppLocale.activeTimeZone() }
  var nowMs: Double { now.timeIntervalSince1970 * 1000 }
}

/// A post's pictures: the first one's thumbnail and every alt text.
public struct LibraryMedia: Codable, Hashable, Sendable {
  public var thumb: String?
  public var alt: String

  public init(thumb: String?, alt: String) {
    self.thumb = thumb
    self.alt = alt
  }

  enum CodingKeys: String, CodingKey { case thumb, alt }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(thumb, forKey: .thumb)
    try c.encode(alt, forKey: .alt)
  }

  /// `{ thumb, alt }` read leniently; nil for a falsy value.
  init?(json: JSONValue?) {
    guard let json, json.isTruthy else { return nil }
    thumb = TemplateJS.text(json["thumb"])
    alt = json["alt"]?.stringValue ?? TemplateJS.text(json["alt"]) ?? ""
  }
}

/// One item on a shelf (the web's LibraryItem). `id` and `key` are one
/// value, `label` and `subtitle` another. `source` is what it was made from
/// (a template, a post or feed or list view, a link); `embedView` is a
/// template's hydrated quote, `.string("missing")` when it is gone, nil
/// when unknown.
public struct LibraryItem: Hashable, Sendable {
  public var id: String
  public var kind: String
  public var shelf: String
  public var title: String
  public var excerpt: String
  public var label: String
  public var shortcut: String
  public var reason: String
  /// nil is the web's undefined (left out of the JSON), `.null` its null.
  public var source: JSONValue?
  public var embedView: JSONValue?
  public var media: LibraryMedia?
  public var uri: String?
  public var cid: String?
  public var url: String?
  public var view: JSONValue?
  public var template: JSONValue?
  public var at: String?
  public var score: Double?
  public var key: String
  public var subtitle: String
  /// A feed's group: 'yours' | 'saved' | 'search'.
  public var group: String?
  /// Set (true) on a post its author doesn't allow quotes of.
  public var quotesOff: Bool?
  /// Members the item picked up that aren't modelled here.
  public var extra: [String: JSONValue]

  public init(
    id: String = "", kind: String = "", shelf: String = "", title: String = "", excerpt: String = "",
    label: String = "", shortcut: String = "", reason: String = "", source: JSONValue? = .null,
    embedView: JSONValue? = nil, media: LibraryMedia? = nil, uri: String? = nil, cid: String? = nil,
    url: String? = nil, view: JSONValue? = .null, template: JSONValue? = .null, at: String? = nil,
    score: Double? = nil, group: String? = nil, quotesOff: Bool? = nil, extra: [String: JSONValue] = [:]
  ) {
    self.id = id
    self.kind = kind
    self.shelf = shelf
    self.title = title
    self.excerpt = excerpt
    self.label = label
    self.shortcut = shortcut
    self.reason = reason
    self.source = source
    self.embedView = embedView
    self.media = media
    self.uri = uri
    self.cid = cid
    self.url = url
    self.view = view
    self.template = template
    self.at = at
    self.score = score
    key = id
    subtitle = label
    self.group = group
    self.quotesOff = quotesOff
    self.extra = extra
  }

  static let modelled: Set<String> = [
    "id", "kind", "shelf", "title", "excerpt", "label", "shortcut", "reason", "source", "embedView", "media",
    "uri", "cid", "url", "view", "template", "at", "score", "key", "subtitle", "group", "quotesOff",
  ]

  /// An item as the web holds one (read leniently: a missing string member
  /// is '', a non-string scalar its String form).
  public init(json: JSONValue) {
    func string(_ name: String) -> String {
      guard let value = json[name] else { return "" }
      return value.stringValue ?? (value.isTruthy ? value.jsString : "")
    }
    func text(_ name: String) -> String? {
      guard let value = json[name] else { return nil }
      if let s = value.stringValue { return s }
      return value.isTruthy ? value.jsString : nil
    }
    id = string("id")
    kind = string("kind")
    shelf = string("shelf")
    title = string("title")
    excerpt = string("excerpt")
    label = string("label")
    shortcut = string("shortcut")
    reason = string("reason")
    source = json["source"]
    embedView = json["embedView"]
    media = LibraryMedia(json: json["media"])
    uri = text("uri")
    cid = text("cid")
    url = text("url")
    view = json["view"]
    template = json["template"]
    at = text("at")
    score = json["score"]?.doubleValue
    key = json["key"].map { $0.stringValue ?? $0.jsString } ?? id
    subtitle = json["subtitle"].map { $0.stringValue ?? $0.jsString } ?? label
    group = json["group"]?.stringValue
    quotesOff = json["quotesOff"]?.boolValue
    var extra: [String: JSONValue] = [:]
    for (name, value) in json.objectValue ?? [:] where !Self.modelled.contains(name) { extra[name] = value }
    self.extra = extra
  }

  /// The web's object.
  public var json: JSONValue {
    var out = extra
    out["id"] = .string(id)
    out["kind"] = .string(kind)
    out["shelf"] = .string(shelf)
    out["title"] = .string(title)
    out["excerpt"] = .string(excerpt)
    out["label"] = .string(label)
    out["shortcut"] = .string(shortcut)
    out["reason"] = .string(reason)
    if let source { out["source"] = source }
    if let embedView { out["embedView"] = embedView }
    out["media"] = media.map { ["thumb": $0.thumb.map(JSONValue.string) ?? .null, "alt": .string($0.alt)] } ?? .null
    out["uri"] = uri.map(JSONValue.string) ?? .null
    out["cid"] = cid.map(JSONValue.string) ?? .null
    out["url"] = url.map(JSONValue.string) ?? .null
    if let view { out["view"] = view }
    if let template { out["template"] = template }
    out["at"] = at.map(JSONValue.string) ?? .null
    out["score"] = score.map(JSONValue.number) ?? .null
    out["key"] = .string(key)
    out["subtitle"] = .string(subtitle)
    if let group { out["group"] = .string(group) }
    if let quotesOff { out["quotesOff"] = .bool(quotesOff) }
    return .object(out)
  }

  /// The item with `label` (and `subtitle`, the same value) set.
  func labelled(_ text: String) -> LibraryItem {
    var copy = self
    copy.label = text
    copy.subtitle = text
    return copy
  }
}

extension LibraryItem: Codable {
  public init(from decoder: Decoder) throws {
    self.init(json: try JSONValue(from: decoder))
  }

  public func encode(to encoder: Encoder) throws {
    try json.encode(to: encoder)
  }
}

/// A mini card: who or what an attachment is by, and its title.
public struct LibraryCard: Codable, Hashable, Sendable {
  public var by: String
  public var title: String

  public init(by: String, title: String) {
    self.by = by
    self.title = title
  }

  init?(json: JSONValue?) {
    guard let json, json.isTruthy else { return nil }
    by = TemplateJS.str(json["by"])
    title = TemplateJS.str(json["title"])
  }
}

/// A link card a post already carries: `{ url, title }`.
public struct LibraryLinkSummary: Codable, Hashable, Sendable {
  public var url: String
  public var title: String

  public init(url: String, title: String) {
    self.url = url
    self.title = title
  }
}

/// What a post in the composer already carries (attachmentsFromState):
/// `{ record: { by, title } | null, link: { url, title } | null, media: 'images' | 'video' | null }`.
public struct LibraryCarried: Hashable, Sendable {
  public var record: LibraryCard?
  public var link: LibraryLinkSummary?
  public var media: String?

  public init(record: LibraryCard? = nil, link: LibraryLinkSummary? = nil, media: String? = nil) {
    self.record = record
    self.link = link
    self.media = media
  }

  /// The web's object, read leniently: a truthy record or link is there.
  public init(json: JSONValue?) {
    let record = json?["record"]
    self.record = record?.isTruthy == true ? LibraryCard(json: record) : nil
    let link = json?["link"]
    self.link = link?.isTruthy == true
      ? LibraryLinkSummary(url: TemplateJS.orEmpty(link?["url"]), title: TemplateJS.str(link?["title"])) : nil
    media = json?["media"].flatMap { $0.isTruthy ? ($0.stringValue ?? $0.jsString) : nil }
  }
}

extension LibraryCarried: Codable {
  enum CodingKeys: String, CodingKey { case record, link, media }

  public init(from decoder: Decoder) throws {
    self.init(json: try JSONValue(from: decoder))
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(record, forKey: .record)
    try c.encode(link, forKey: .link)
    try c.encode(media, forKey: .media)
  }
}

/// A piece of the preview's text: 'existing', 'added', 'context',
/// 'answer' or 'blank' (a blank still to be answered, by its label).
public struct LibraryPreviewPart: Codable, Hashable, Sendable {
  public var text: String
  public var kind: String

  public init(text: String, kind: String) {
    self.text = text
    self.kind = kind
  }
}

/// What the post would look like with an item used (previewFor).
public struct LibraryPreview: Hashable, Sendable {
  public var parts: [LibraryPreviewPart]
  public var count: Int
  public var overLimit: Bool
  public var attachment: LibraryCard?
  public var replacesAttachment: Bool
  public var notes: [String]
  public var blocked: String?
  /// False when using the item would change nothing.
  public var usable: Bool
}

extension LibraryPreview: Codable {
  enum CodingKeys: String, CodingKey { case parts, count, overLimit, attachment, replacesAttachment, notes, blocked, usable }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(parts, forKey: .parts)
    try c.encode(count, forKey: .count)
    try c.encode(overLimit, forKey: .overLimit)
    try c.encode(attachment, forKey: .attachment)
    try c.encode(replacesAttachment, forKey: .replacesAttachment)
    try c.encode(notes, forKey: .notes)
    try c.encode(blocked, forKey: .blocked)
    try c.encode(usable, forKey: .usable)
  }
}

/// What a plan attaches: a record `{ kind: 'post' | 'feed' | 'list', uri,
/// cid, view? }` or a link `{ kind: 'link', url, title?, description? }`.
/// A post read from the archive has no cid until it is hydrated.
public struct LibraryAttachment: Hashable, Sendable {
  public var kind: String
  public var uri: String?
  public var cid: String?
  public var view: JSONValue?
  public var url: String?
  public var title: String?
  public var description: String?
  /// Members it carries that aren't modelled here.
  public var extra: [String: JSONValue]

  public init(
    kind: String, uri: String? = nil, cid: String? = nil, view: JSONValue? = nil, url: String? = nil,
    title: String? = nil, description: String? = nil, extra: [String: JSONValue] = [:]
  ) {
    self.kind = kind
    self.uri = uri
    self.cid = cid
    self.view = view
    self.url = url
    self.title = title
    self.description = description
    self.extra = extra
  }

  public var isLink: Bool { kind == "link" }

  /// The web's object, read leniently.
  public init(json: JSONValue) {
    func text(_ name: String) -> String? {
      guard let value = json[name] else { return nil }
      if let s = value.stringValue { return s }
      return value.isTruthy ? value.jsString : nil
    }
    kind = TemplateJS.orEmpty(json["kind"])
    uri = text("uri")
    cid = text("cid")
    view = json["view"].flatMap { $0.isNull ? nil : $0 }
    url = text("url")
    title = json["title"]?.stringValue
    description = json["description"]?.stringValue
    var extra: [String: JSONValue] = [:]
    let modelled: Set<String> = ["kind", "uri", "cid", "view", "url", "title", "description"]
    for (name, value) in json.objectValue ?? [:] where !modelled.contains(name) { extra[name] = value }
    self.extra = extra
  }

  /// The web's object: a record's uri and cid (null when unknown) and its
  /// view when it has one; a link's url, and the title and description a
  /// template's card carries.
  public var json: JSONValue {
    var out = extra
    out["kind"] = .string(kind)
    if isLink {
      out["url"] = url.map(JSONValue.string) ?? .null
      if let title { out["title"] = .string(title) }
      if let description { out["description"] = .string(description) }
    } else {
      out["uri"] = uri.map(JSONValue.string) ?? .null
      out["cid"] = cid.map(JSONValue.string) ?? .null
      if let view { out["view"] = view }
      if let url { out["url"] = .string(url) }
    }
    return .object(out)
  }
}

extension LibraryAttachment: Codable {
  public init(from decoder: Decoder) throws {
    self.init(json: try JSONValue(from: decoder))
  }

  public func encode(to encoder: Encoder) throws {
    try json.encode(to: encoder)
  }
}

/// What the composer does with a pick (the web's LibraryPlan): insert
/// `insertText` at the caret (Library.insertText), then attach `attach`.
/// `template` and `answers` are there for a template only.
public struct LibraryPlan: Hashable, Sendable {
  public var insertText: String?
  public var attach: LibraryAttachment?
  /// The template used (`.null` when the item had none); nil for other kinds.
  public var template: JSONValue?
  public var answers: JSONValue?
  public var title: String
  public var templateRkey: String?

  public init(
    insertText: String? = nil, attach: LibraryAttachment? = nil, template: JSONValue? = nil,
    answers: JSONValue? = nil, title: String = "", templateRkey: String? = nil
  ) {
    self.insertText = insertText
    self.attach = attach
    self.template = template
    self.answers = answers
    self.title = title
    self.templateRkey = templateRkey
  }

  /// The template as a PostTemplate, for the composer.
  public var postTemplate: PostTemplate? {
    guard let template, template.isTruthy else { return nil }
    return PostTemplates.normalizeTemplateRecord(template)
  }

  public var json: JSONValue {
    var out: [String: JSONValue] = [:]
    if let insertText { out["insertText"] = .string(insertText) }
    if let attach { out["attach"] = attach.json }
    if let template { out["template"] = template }
    if let answers { out["answers"] = answers }
    out["title"] = .string(title)
    out["templateRkey"] = templateRkey.map(JSONValue.string) ?? .null
    return .object(out)
  }
}

extension LibraryPlan: Codable {
  public init(from decoder: Decoder) throws {
    let json = try JSONValue(from: decoder)
    self.init(
      insertText: json["insertText"]?.stringValue, attach: json["attach"].flatMap { $0.isTruthy ? LibraryAttachment(json: $0) : nil },
      template: json["template"], answers: json["answers"], title: TemplateJS.str(json["title"]),
      templateRkey: json["templateRkey"]?.stringValue)
  }

  public func encode(to encoder: Encoder) throws {
    try json.encode(to: encoder)
  }
}

/// A "/shortcut" being typed (detectSlashCommand): the slash at `start`,
/// the caret at `end`, and the lower-cased `query` between.
public struct SlashCommand: Codable, Hashable, Sendable {
  public var start: Int
  public var end: Int
  public var query: String

  public init(start: Int, end: Int, query: String) {
    self.start = start
    self.end = end
    self.query = query
  }
}

/// The template context a library call is handed: a template context, or
/// the dialog's `{ state, reply, selfHandle }` to make one from
/// (asTemplateContext).
public enum LibraryContextInput: Hashable, Sendable {
  case template(TemplateContext)
  /// `reply` nil is the web's undefined (state.reply stands in); `.null` none.
  case dialog(state: JSONValue?, reply: JSONValue?, selfHandle: String?)

  /// A value as the web passes it: an object with a string `today` is a
  /// template context; anything else is read as the dialog's.
  public init(json: JSONValue?) {
    if let json, case .string = json["today"], let context = TemplateContext(json: json) {
      self = .template(context)
    } else {
      self = .dialog(state: json?["state"], reply: json?["reply"], selfHandle: TemplateJS.text(json?["selfHandle"]))
    }
  }
}
