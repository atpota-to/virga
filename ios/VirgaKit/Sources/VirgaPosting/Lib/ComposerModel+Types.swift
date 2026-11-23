// Ports src/posting/lib/composerModel.js
//
// The composer's state as the web holds it: plain objects a reducer moves.
// Every shape here is the web's object itself (`json`), every member kept,
// with typed accessors over the members the web names, so a spread
// (`{ ...p, text }`), a patch with members the code never names, or a value
// of the wrong type behaves exactly as it does in JavaScript, and the state
// encodes to the web's JSON.
//
//   ComposerState = {
//     posts: PostDraft[1..25], reply, tags, langs (≤3), labels, gates, asDid,
//     schedule, lifespan, source,
//   }
//   PostDraft = { id, text, images (≤4), video, record, card }
//
// A picked file (the web's File) is a ComposerFile: in the state it is the
// object `{ $file: true, name, type, size, lastModified, ref }`, so it reads
// as a File reads (`file.type`, `file.size`), and `ref` is the app's handle
// on the bytes (a temporary file or a media store's key; never sent).

import Foundation
import VirgaCore

// MARK: - The object every composer shape is

/// A JavaScript object as the composer keeps it: `json` is the object (every
/// member), and the typed accessors read and write its members.
public protocol ComposerObject: Codable, Hashable, Sendable {
  /// The object as the web holds it.
  var json: JSONValue { get set }
  init(json: JSONValue)
}

extension ComposerObject {
  public init(from decoder: Decoder) throws { self.init(json: try JSONValue(from: decoder)) }
  public func encode(to encoder: Encoder) throws { try json.encode(to: encoder) }

  /// A member, or nil when absent (`undefined`). Setting nil removes it.
  public subscript(member key: String) -> JSONValue? {
    get { json[key] }
    set { json[key] = newValue }
  }

  /// A string member, or nil when absent or of another type.
  func stringMember(_ key: String) -> String? { json[key]?.stringValue }

  /// A member that is an object, as a typed view, or nil.
  func objectMember<T: ComposerObject>(_ key: String, as type: T.Type = T.self) -> T? {
    guard case .object? = json[key] else { return nil }
    return T(json: json[key]!)
  }

  /// Sets a member to a view's object, or to null.
  mutating func setObjectMember<T: ComposerObject>(_ key: String, _ value: T?) {
    json[key] = value?.json ?? .null
  }
}

// MARK: - Files

/// A picked file or blob (the web's File): its name, type and size, and the
/// app's handle on its bytes. In a state it is `{ $file: true, … }`.
public struct ComposerFile: Codable, Hashable, Sendable {
  /// The file's name; nil for a blob that has none.
  public var name: String?
  /// Its MIME type (`file.type`), '' when unknown.
  public var type: String
  /// Its size in bytes (`file.size`).
  public var size: Double
  /// `file.lastModified` in epoch milliseconds, when known.
  public var lastModified: Double?
  /// Where the app keeps the bytes (a temporary file's path, a media store's
  /// key). Never serialized by autosave and never sent anywhere.
  public var ref: String?

  public init(name: String? = nil, type: String, size: Double, lastModified: Double? = nil, ref: String? = nil) {
    self.name = name
    self.type = type
    self.size = size
    self.lastModified = lastModified
    self.ref = ref
  }

  /// The file as a state holds it.
  public var json: JSONValue {
    var object: [String: JSONValue] = ["$file": true, "type": .string(type), "size": .number(size)]
    if let name { object["name"] = .string(name) }
    if let lastModified { object["lastModified"] = .number(lastModified) }
    if let ref { object["ref"] = .string(ref) }
    return .object(object)
  }

  /// A file as a state holds it, or nil for anything else.
  public init?(json: JSONValue?) {
    guard Self.isFile(json), let json else { return nil }
    name = json["name"]?.stringValue
    type = json["type"]?.stringValue ?? ""
    size = json["size"]?.doubleValue ?? 0
    lastModified = json["lastModified"]?.doubleValue
    ref = json["ref"]?.stringValue
  }

  /// `value instanceof Blob`: a file as a state holds it (`$file: true`).
  /// A plain object with a size and a type isn't one.
  public static func isFile(_ value: JSONValue?) -> Bool {
    value?["$file"] == .bool(true)
  }

  public init(from decoder: Decoder) throws {
    let value = try JSONValue(from: decoder)
    guard let file = ComposerFile(json: value) else {
      throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not a composer file"))
    }
    self = file
  }

  public func encode(to encoder: Encoder) throws { try json.encode(to: encoder) }
}

// MARK: - Posts and their media

/// One post of the thread (the web's PostDraft).
public struct PostDraft: ComposerObject {
  public var json: JSONValue
  public init(json: JSONValue) { self.json = json }

  public var id: String {
    get { stringMember("id") ?? "" }
    set { json["id"] = .string(newValue) }
  }

  public var text: String {
    get { stringMember("text") ?? "" }
    set { json["text"] = .string(newValue) }
  }

  public var images: [ComposerImage] {
    get { (json["images"]?.arrayValue ?? []).map(ComposerImage.init(json:)) }
    set { json["images"] = .array(newValue.map(\.json)) }
  }

  public var video: ComposerVideo? {
    get { objectMember("video") }
    set { setObjectMember("video", newValue) }
  }

  /// A quoted post, feed, list or starter pack.
  public var record: ComposerRecord? {
    get { objectMember("record") }
    set { setObjectMember("record", newValue) }
  }

  /// A link card.
  public var card: ComposerCard? {
    get { objectMember("card") }
    set { setObjectMember("card", newValue) }
  }
}

/// An image of a post: the picked file and, once uploaded, its blob and the
/// account it was uploaded as.
public struct ComposerImage: ComposerObject {
  public var json: JSONValue
  public init(json: JSONValue) { self.json = json }

  public var id: String {
    get { stringMember("id") ?? "" }
    set { json["id"] = .string(newValue) }
  }

  public var alt: String {
    get { stringMember("alt") ?? "" }
    set { json["alt"] = .string(newValue) }
  }

  public var file: ComposerFile? {
    get { ComposerFile(json: json["file"]) }
    set { json["file"] = newValue?.json }
  }

  /// The uploaded blob, as a record carries it.
  public var blob: JSONValue? {
    get { json["blob"] }
    set { json["blob"] = newValue }
  }

  public var blobDid: String? {
    get { stringMember("blobDid") }
    set { json["blobDid"] = newValue.map(JSONValue.string) }
  }

  public var mime: String? { stringMember("mime") }
  public var size: Double? { json["size"]?.doubleValue }
  public var aspectRatio: JSONValue? { json["aspectRatio"] }
  /// A draft's file kept on this device, named by its key.
  public var localRef: String? { stringMember("localRef") }
  public var previewUrl: String? { stringMember("previewUrl") }
}

/// A post's video: the picked file, the upload's progress and the blob the
/// video service hands back.
public struct ComposerVideo: ComposerObject {
  public var json: JSONValue
  public init(json: JSONValue) { self.json = json }

  public var alt: String {
    get { stringMember("alt") ?? "" }
    set { json["alt"] = .string(newValue) }
  }

  /// 'idle' | 'uploading' | 'processing' | 'ready' | 'error'.
  public var status: String {
    get { stringMember("status") ?? "idle" }
    set { json["status"] = .string(newValue) }
  }

  public var file: ComposerFile? {
    get { ComposerFile(json: json["file"]) }
    set { json["file"] = newValue?.json }
  }

  public var blob: JSONValue? {
    get { json["blob"] }
    set { json["blob"] = newValue }
  }

  public var blobDid: String? { stringMember("blobDid") }
  public var jobId: String? { stringMember("jobId") }
  public var error: JSONValue? { json["error"] }
  public var mime: String? { stringMember("mime") }
  public var size: Double? { json["size"]?.doubleValue }
  public var aspectRatio: JSONValue? { json["aspectRatio"] }
  public var localRef: String? { stringMember("localRef") }
  public var previewUrl: String? { stringMember("previewUrl") }
}

/// A record a post carries: `{ kind: 'post'|'feed'|'list'|'starterpack', uri, cid, view }`.
public struct ComposerRecord: ComposerObject {
  public var json: JSONValue
  public init(json: JSONValue) { self.json = json }

  public init(kind: String, uri: String, cid: String?, view: JSONValue? = nil) {
    var object: [String: JSONValue] = ["kind": .string(kind), "uri": .string(uri)]
    if let cid { object["cid"] = .string(cid) }
    if let view { object["view"] = view }
    json = .object(object)
  }

  public var kind: String { stringMember("kind") ?? "post" }
  public var uri: String { stringMember("uri") ?? "" }
  public var cid: String? { stringMember("cid") }
  public var view: JSONValue? { json["view"] }
}

/// A link card: `{ url, title, description, thumb, thumbBlob, thumbBlobDid, … }`.
public struct ComposerCard: ComposerObject {
  public var json: JSONValue
  public init(json: JSONValue) { self.json = json }

  public var url: String { stringMember("url") ?? "" }
  public var title: String { stringMember("title") ?? "" }
  public var description: String { stringMember("description") ?? "" }
  /// The thumbnail's address, or nil.
  public var thumb: String? { stringMember("thumb") }
  public var thumbBlob: JSONValue? { json["thumbBlob"] }
  public var thumbBlobDid: String? { stringMember("thumbBlobDid") }
  public var thumbFile: ComposerFile? { ComposerFile(json: json["thumbFile"]) }
  public var edited: Bool { json["edited"]?.isTruthy ?? false }
}

// MARK: - The composer-wide choices

/// Who may reply and quote: `{ custom, reply, quotes }`, where `reply` is
/// null (anyone), [] (nobody) or rules.
public struct ComposerGates: ComposerObject {
  public var json: JSONValue
  public init(json: JSONValue) { self.json = json }

  public init(custom: Bool = false, reply: [ReplyRule]? = nil, quotes: Bool = true) {
    json = [
      "custom": .bool(custom),
      "reply": reply.map { .array($0.map(\.json)) } ?? .null,
      "quotes": .bool(quotes),
    ]
  }

  /// Set by the writer for this post, rather than the account's default.
  public var custom: Bool { json["custom"]?.isTruthy ?? false }
  /// The rules as the state holds them: nil for anyone.
  public var reply: [JSONValue]? { json["reply"]?.arrayValue }
  /// The rules read as ReplyRules (unknown ones left out); nil for anyone.
  public var replyRules: [ReplyRule]? { reply?.compactMap(ReplyRule.init(json:)) }
  public var quotes: Bool { json["quotes"] != .bool(false) }
}

/// When the post goes out: `{ mode: 'queue' }` or `{ mode: 'at', at, repeat? }`.
public struct ComposerSchedule: ComposerObject {
  public var json: JSONValue
  public init(json: JSONValue) { self.json = json }

  public static let queue = ComposerSchedule(json: ["mode": "queue"])

  public static func at(_ iso: String, repeat rule: JSONValue? = nil) -> ComposerSchedule {
    var object: [String: JSONValue] = ["mode": "at", "at": .string(iso)]
    if let rule { object["repeat"] = rule }
    return ComposerSchedule(json: .object(object))
  }

  /// 'queue' or 'at'.
  public var mode: String { stringMember("mode") ?? "" }
  public var at: String? { stringMember("at") }
  /// The repeat rule (schedule/repeat.js), when there is one.
  public var `repeat`: JSONValue? { json["repeat"] }
}

/// What the composer was opened from: `{ kind: 'draft'|'scheduled', id, ownerDid, … }`.
public struct ComposerSource: ComposerObject {
  public var json: JSONValue
  public init(json: JSONValue) { self.json = json }

  public var kind: String? { stringMember("kind") }
  public var id: JSONValue? { json["id"] }
  public var ownerDid: String? { stringMember("ownerDid") }
}

/// The post a reply answers: `{ uri, cid, root: { uri, cid }, author, text, view }`.
public struct ComposerReply: ComposerObject {
  public var json: JSONValue
  public init(json: JSONValue) { self.json = json }

  public var uri: String { stringMember("uri") ?? "" }
  public var cid: String? { stringMember("cid") }
  public var root: JSONValue? { json["root"] }
  public var author: JSONValue? { json["author"] }
  public var text: String? { stringMember("text") }
  public var view: JSONValue? { json["view"] }
}

/// The composer's whole state (the web's ComposerState).
public struct ComposerState: ComposerObject {
  public var json: JSONValue
  public init(json: JSONValue) { self.json = json }

  public var posts: [PostDraft] {
    get { (json["posts"]?.arrayValue ?? []).map(PostDraft.init(json:)) }
    set { json["posts"] = .array(newValue.map(\.json)) }
  }

  public var reply: ComposerReply? {
    get { objectMember("reply") }
    set { setObjectMember("reply", newValue) }
  }

  public var tags: [String] { json["tags"]?.arrayValue?.compactMap(\.stringValue) ?? [] }
  public var langs: [String] { json["langs"]?.arrayValue?.compactMap(\.stringValue) ?? [] }
  public var labels: [String] { json["labels"]?.arrayValue?.compactMap(\.stringValue) ?? [] }

  public var gates: ComposerGates {
    get { objectMember("gates") ?? ComposerGates() }
    set { json["gates"] = newValue.json }
  }

  public var asDid: String { stringMember("asDid") ?? "" }

  public var schedule: ComposerSchedule? {
    get { objectMember("schedule") }
    set { setObjectMember("schedule", newValue) }
  }

  /// The post's timer rule (timers/selfDestruct.js), `{ enabled: false }` for none.
  public var lifespan: JSONValue {
    get { json["lifespan"] ?? ["enabled": false] }
    set { json["lifespan"] = newValue }
  }

  public var source: ComposerSource? {
    get { objectMember("source") }
    set { setObjectMember("source", newValue) }
  }
}

// MARK: - Actions

/// One of the reducer's actions, as the web dispatches it: `{ type, … }`.
public struct ComposerAction: ComposerObject {
  public var json: JSONValue
  public init(json: JSONValue) { self.json = json }

  public var type: String? { stringMember("type") }

  private static func make(_ type: String, _ members: [String: JSONValue?]) -> ComposerAction {
    var object: [String: JSONValue] = ["type": .string(type)]
    for (key, value) in members { if let value { object[key] = value } }
    return ComposerAction(json: .object(object))
  }

  public static func setText(index: Int, text: String) -> Self {
    make("setText", ["index": .number(Double(index)), "text": .string(text)])
  }
  public static func addPost(after: Int? = nil, post: PostDraft? = nil) -> Self {
    make("addPost", ["after": after.map { .number(Double($0)) }, "post": post?.json])
  }
  public static func removePost(index: Int) -> Self { make("removePost", ["index": .number(Double(index))]) }
  public static func movePost(from: Int, to: Int) -> Self {
    make("movePost", ["from": .number(Double(from)), "to": .number(Double(to))])
  }
  public static func splitPost(id: String, text: String, rest: [PostDraft]) -> Self {
    make("splitPost", ["id": .string(id), "text": .string(text), "rest": .array(rest.map(\.json))])
  }
  public static func unsplitPost(id: String, remove: [String], text: String) -> Self {
    make("unsplitPost", ["id": .string(id), "remove": .array(remove.map(JSONValue.string)), "text": .string(text)])
  }
  public static func setTexts(_ texts: [String: String]) -> Self {
    make("setTexts", ["texts": .object(texts.mapValues(JSONValue.string))])
  }
  public static func addImages(index: Int, images: [ComposerImage]) -> Self {
    make("addImages", ["index": .number(Double(index)), "images": .array(images.map(\.json))])
  }
  public static func updateImage(index: Int, id: String, patch: [String: JSONValue]) -> Self {
    make("updateImage", ["index": .number(Double(index)), "id": .string(id), "patch": .object(patch)])
  }
  public static func removeImage(index: Int, id: String) -> Self {
    make("removeImage", ["index": .number(Double(index)), "id": .string(id)])
  }
  public static func moveImage(index: Int, from: Int, to: Int) -> Self {
    make("moveImage", ["index": .number(Double(index)), "from": .number(Double(from)), "to": .number(Double(to))])
  }
  public static func setVideo(index: Int, video: ComposerVideo?) -> Self {
    make("setVideo", ["index": .number(Double(index)), "video": video?.json ?? .null])
  }
  public static func setRecord(index: Int, record: ComposerRecord?) -> Self {
    make("setRecord", ["index": .number(Double(index)), "record": record?.json ?? .null])
  }
  public static func setCard(index: Int, card: ComposerCard?) -> Self {
    make("setCard", ["index": .number(Double(index)), "card": card?.json ?? .null])
  }
  public static func setReply(_ reply: ComposerReply?) -> Self { make("setReply", ["reply": reply?.json ?? .null]) }
  public static func setTags(_ tags: [String]) -> Self { make("setTags", ["tags": .array(tags.map(JSONValue.string))]) }
  /// Tags as typed in a field: "#a, b".
  public static func setTags(text: String) -> Self { make("setTags", ["tags": .string(text)]) }
  public static func setLangs(_ langs: [String]) -> Self {
    make("setLangs", ["langs": .array(langs.map(JSONValue.string))])
  }
  public static func setLabels(_ labels: [String]) -> Self {
    make("setLabels", ["labels": .array(labels.map(JSONValue.string))])
  }
  public static func setGates(reply: [ReplyRule]?, quotes: Bool) -> Self {
    make("setGates", ["gates": ["reply": reply.map { .array($0.map(\.json)) } ?? .null, "quotes": .bool(quotes)]])
  }
  public static func setGates(_ gates: JSONValue) -> Self { make("setGates", ["gates": gates]) }
  public static func setDefaultGates(_ gates: JSONValue) -> Self { make("setDefaultGates", ["gates": gates]) }
  public static func setAsDid(_ did: String) -> Self { make("setAsDid", ["did": .string(did)]) }
  public static func setSchedule(_ schedule: ComposerSchedule?) -> Self {
    make("setSchedule", ["schedule": schedule?.json ?? .null])
  }
  public static func setLifespan(_ lifespan: JSONValue?) -> Self { make("setLifespan", ["lifespan": lifespan ?? .null]) }
  public static func setSource(_ source: ComposerSource?) -> Self { make("setSource", ["source": source?.json ?? .null]) }
  public static func load(_ state: ComposerState) -> Self { make("load", ["state": state.json]) }
  public static func reset(_ state: ComposerState) -> Self { make("reset", ["state": state.json]) }
}

// MARK: - Problems

/// What stops the composer from publishing: `{ postIndex, code, message }`,
/// `postIndex` null for a problem that isn't one post's.
public struct ComposerProblem: Codable, Hashable, Sendable {
  public var postIndex: Int?
  public var code: String
  public var message: String

  public init(postIndex: Int?, code: String, message: String) {
    self.postIndex = postIndex
    self.code = code
    self.message = message
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(postIndex, forKey: .postIndex)  // null, as the web writes it
    try container.encode(code, forKey: .code)
    try container.encode(message, forKey: .message)
  }
}

/// `resolvePostTexts` was called off: the web's AbortError.
public struct ComposerCancelledError: Error, LocalizedError, Hashable, Sendable {
  public let name = "AbortError"
  public let canceled = true
  public var message = "Cancelled."
  public init() {}
  public var errorDescription: String? { message }
}
