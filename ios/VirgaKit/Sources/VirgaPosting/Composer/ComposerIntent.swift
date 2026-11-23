// Ports src/posting/composer/intent.js
//
// What a call to the composer's open(intent) asks for, read into one plain
// shape the composer acts on (DESIGN.md §6.3). Nothing here touches the
// network: the composer loads what the plan names (a reply, a quote, a
// draft, a scheduled post, a template) itself. Intents are taken as the web
// takes them (JSONValue); a picked file is a ComposerFile marker.

import Foundation
import VirgaCore

/// A reply or quote target: `{ kind, uri, did, collection, rkey }` for an
/// at:// URI with a DID, or `{ kind, collection, rkey, url, did?, uri? |
/// handle? }` for a link that may still have a handle to resolve.
public struct ComposerTargetRef: ComposerObject {
  public var json: JSONValue
  public init(json: JSONValue) { self.json = json }

  /// 'post' | 'feed' | 'list' | 'starterpack'.
  public var kind: String { stringMember("kind") ?? "" }
  public var uri: String? { stringMember("uri") }
  public var did: String? { stringMember("did") }
  public var handle: String? { stringMember("handle") }
  public var collection: String { stringMember("collection") ?? "" }
  public var rkey: String { stringMember("rkey") ?? "" }
  public var url: String? { stringMember("url") }
}

/// The intent as the composer acts on it (normalizeIntent's plan).
public struct ComposerIntentPlan: ComposerObject {
  public var json: JSONValue
  public init(json: JSONValue) { self.json = json }

  /// Who the post goes out as.
  public var asDid: String { stringMember("asDid") ?? "" }
  /// Each post's starting text ([] when the intent has none).
  public var texts: [String] { json["texts"]?.arrayValue?.compactMap(\.stringValue) ?? [] }
  public var reply: ComposerTargetRef? { objectMember("reply") }
  public var quote: ComposerTargetRef? { objectMember("quote") }
  /// A LibraryPlan to apply once the composer is up.
  public var attach: JSONValue? {
    guard let attach = json["attach"], !attach.isNull else { return nil }
    return attach
  }
  /// Pictures for the first post: `{ file, alt }`.
  public var images: [JSONValue] { json["images"]?.arrayValue ?? [] }
  public var tags: [String] { json["tags"]?.arrayValue?.compactMap(\.stringValue) ?? [] }
  /// nil when the intent didn't say.
  public var langs: [String]? { json["langs"]?.arrayValue?.compactMap(\.stringValue) }
  public var draftId: String? { stringMember("draftId") }
  public var draftOwnerDid: String? { stringMember("draftOwnerDid") }
  public var scheduledId: String? { stringMember("scheduledId") }
  public var templateId: String? { stringMember("templateId") }
  /// 'post' | 'schedule' | 'queue'.
  public var mode: String { stringMember("mode") ?? "post" }
  public var fromLink: Bool { json["fromLink"]?.isTruthy ?? false }
  public var url: String? { stringMember("url") }
  public var notes: [String] { json["notes"]?.arrayValue?.compactMap(\.stringValue) ?? [] }
  /// Whether it brings anything, so a saved post isn't restored over it.
  public var hasContent: Bool { json["hasContent"]?.isTruthy ?? false }
}

public enum ComposerIntent {
  /// A reply or quote target as the intent gave it (`{ uri }`, `{ url }`, or
  /// a bare string). Nil when it names no post, feed, list or starter pack.
  public static func readTargetRef(_ input: JSONValue?) -> ComposerTargetRef? {
    let raw: String
    if ComposerJS.isObject(input) {
      let uri = ComposerJS.str(input?["uri"])
      raw = uri.isEmpty ? ComposerJS.str(input?["url"]) : uri
    } else {
      raw = ComposerJS.str(input)
    }
    let text = raw.jsTrimmed()
    if text.isEmpty { return nil }
    if let parsed = PostLink.parseRecordUri(text) {
      return ComposerTargetRef(json: [
        "kind": .string(parsed.kind), "uri": .string(text), "did": .string(parsed.did),
        "collection": .string(parsed.collection), "rkey": .string(parsed.rkey),
      ])
    }
    guard let link = PostLink.parseRecordLink(text) else { return nil }
    var out: [String: JSONValue] = [
      "kind": .string(link.kind), "collection": .string(link.collection), "rkey": .string(link.rkey),
      "url": .string(link.url.isEmpty ? text : link.url),
    ]
    if let did = link.did, !did.isEmpty {
      out["did"] = .string(did)
      out["uri"] = .string("at://\(did)/\(link.collection)/\(link.rkey)")
    } else if let handle = link.handle {
      out["handle"] = .string(handle)
    }
    return ComposerTargetRef(json: .object(out))
  }

  public static func readTargetRef(_ input: String?) -> ComposerTargetRef? {
    readTargetRef(input.map(JSONValue.string))
  }

  /// `a || b` for strings: the first unless empty.
  static func either(_ a: String, _ b: @autoclosure () -> String) -> String { a.isEmpty ? b() : a }

  /// The intent as the composer acts on it. `activeDid` is the active account.
  public static func normalizeIntent(_ intent: JSONValue?, activeDid: String = "") -> ComposerIntentPlan {
    let i: JSONValue = ComposerJS.isObject(intent) ? intent! : [:]
    let draftIdText = ComposerJS.str(i["draftId"])
    let draftId: String? = draftIdText.isEmpty ? nil : draftIdText
    let draftOwnerDid: String? =
      draftId == nil
      ? nil : either(ComposerJS.str(i["draftOwnerDid"]), either(ComposerJS.str(i["asDid"]), activeDid))
    let asDid =
      (draftId != nil && !(draftOwnerDid ?? "").isEmpty)
      ? draftOwnerDid! : either(ComposerJS.str(i["asDid"]), activeDid)

    let texts: [String]
    if let posts = i["posts"]?.arrayValue, !posts.isEmpty {
      texts = ComposerJS.slice(posts, 0, ComposerModel.maxPosts).map { p in
        p.stringValue ?? ComposerJS.str(p["text"])
      }
    } else if let text = i["text"]?.stringValue {
      texts = [text]
    } else {
      texts = []
    }

    var reply = readTargetRef(i["reply"])
    if let ref = reply, ref.json["kind"] != "post" { reply = nil }
    let quote = readTargetRef(i["quote"])

    var notes: [String] = []
    var mode = ComposerJS.includes(["post", "schedule", "queue"], i["mode"]) ? i["mode"]!.stringValue! : "post"
    if reply != nil && mode == "queue" {
      mode = "post"
      notes.append(PublishActions.queueReplyHint)
    }

    let tags = Tags.normalizeTags(i["tags"])
    let langs: JSONValue
    if let list = i["langs"]?.arrayValue {
      let kept = ComposerJS.unique(list.compactMap { $0.stringValue.flatMap { $0.isEmpty ? nil : $0 } })
      langs = .array(ComposerJS.slice(kept, 0, ComposerModel.maxLangs).map(JSONValue.string))
    } else {
      langs = .null
    }

    let images: [JSONValue] = ComposerJS.slice(
      ComposerJS.list(i["images"]).filter { ComposerJS.isObject($0) && ComposerFile.isFile($0["file"]) },
      0, ComposerModel.maxImages
    ).map { ["file": $0["file"]!, "alt": .string(ComposerJS.str($0["alt"]))] }

    func nullable(_ text: String?) -> JSONValue { text.map(JSONValue.string) ?? .null }
    func orNull(_ value: JSONValue?) -> JSONValue {
      let text = ComposerJS.str(value)
      return text.isEmpty ? .null : .string(text)
    }
    var plan: [String: JSONValue] = [
      "asDid": .string(asDid),
      "texts": .array(texts.map(JSONValue.string)),
      "reply": reply?.json ?? .null,
      "quote": quote?.json ?? .null,
      "attach": ComposerJS.isObject(i["attach"]) ? i["attach"]! : .null,
      "images": .array(images),
      "tags": .array(tags.map(JSONValue.string)),
      "langs": langs,
      "draftId": nullable(draftId),
      "draftOwnerDid": nullable(draftOwnerDid),
      "scheduledId": orNull(i["scheduledId"]),
      "templateId": orNull(i["templateId"]),
      "mode": .string(mode),
      "fromLink": .bool(ComposerJS.truthy(i["fromLink"])),
      "url": orNull(i["url"]),
      "notes": .array(notes.map(JSONValue.string)),
    ]
    let hasContent =
      texts.contains { !$0.jsTrimmed().isEmpty } || reply != nil || quote != nil || ComposerJS.isObject(i["attach"])
      || !images.isEmpty || draftId != nil || plan["scheduledId"] != .null || plan["templateId"] != .null
      || !tags.isEmpty
    plan["hasContent"] = .bool(hasContent)
    return ComposerIntentPlan(json: .object(plan))
  }

  /// What has to be read before the composer can show the intent, in order.
  public static func intentLoads(_ plan: ComposerIntentPlan?) -> [String] {
    guard let plan else { return [] }
    // Each member as the web tests it: truthy.
    func has(_ key: String) -> Bool { ComposerJS.truthy(plan.json[key]) }
    if has("scheduledId") { return ["scheduled"] }
    if has("draftId") { return ["draft"] }
    var out: [String] = []
    if has("reply") { out.append("reply") }
    if has("quote") { out.append("quote") }
    if has("templateId") { out.append("template") }
    if has("attach") { out.append("attach") }
    return out
  }

  /// `base` (a fresh ComposerState) with the intent's own words in it: each
  /// text in its post, tags, and languages when the intent named them.
  public static func seedFromIntent(
    _ base: ComposerState, _ plan: ComposerIntentPlan?, emptyPost: () -> PostDraft = ComposerModel.emptyPost
  ) -> ComposerState {
    guard let plan else { return base }
    var next = base
    if !plan.texts.isEmpty {
      let first = base.json["posts"]?[0]
      next.json["posts"] = .array(
        plan.texts.enumerated().map { index, text in
          var post = ComposerJS.spread(index == 0 ? first : emptyPost().json)
          post["text"] = .string(text)
          return .object(post)
        })
    }
    if !plan.tags.isEmpty { next.json["tags"] = .array(plan.tags.map(JSONValue.string)) }
    if let langs = plan.langs, !langs.isEmpty { next.json["langs"] = .array(langs.map(JSONValue.string)) }
    if plan.mode == "queue" { next.json["schedule"] = ["mode": "queue"] }
    return next
  }
}
