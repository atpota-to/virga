// Ports src/posting/pages/postedModel.js
//
// The Posted page's logic outside the view: which rows a filter and a
// search keep, reading a post again before acting on it (every row action
// works from the post as it is now, not from the archive's copy), reading
// its reply and quote settings, deleting it, and posting it again.
//
// The account's agent is its XRPCAgent; the public AppView and the PDS are
// read through `transport` (the web's fetch). Files are ComposerFiles'.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

/// A refusal of the Posted page's reads and writes: GONE, or a URI that
/// isn't a post's (no code).
public struct PostedModelError: Error, LocalizedError, ScheduleErrorObject, Hashable, Sendable {
  public var code: String?
  public var message: String

  public init(code: String? = nil, _ message: String) {
    self.code = code
    self.message = message
  }

  public var errorDescription: String? { message }
  public var errorObject: JSONValue {
    var out: JSONValue = ["name": "Error", "message": .string(message)]
    if let code { out["code"] = .string(code) }
    return out
  }
}

/// A filter of the Posted page.
public struct PostedFilter: Codable, Hashable, Sendable {
  public var value: String
  public var label: String
}

/// The post at a URI as it is now.
public struct PostNow: Hashable, Sendable {
  public var uri: String
  public var cid: JSONValue
  public var record: JSONValue
  /// The AppView's view, or nil when it came from the repo.
  public var view: JSONValue?

  public var json: JSONValue { ["uri": .string(uri), "cid": cid, "record": record, "view": view ?? .null] }
}

/// What "Post again" takes from a post: see postAgainSeed.
public struct PostAgainSeed: Hashable, Sendable {
  public struct Link: Codable, Hashable, Sendable {
    public var url: JSONValue
    public var title: String
    public var description: String
  }

  public struct Image: Hashable, Sendable {
    public var cid: JSONValue
    public var mime: String
    public var alt: String

    public var json: JSONValue { ["cid": cid, "mime": .string(mime), "alt": .string(alt)] }
  }

  public var text: String
  public var tags: [String]
  public var langs: [String]
  public var quote: String?
  public var link: Link?
  public var images: [Image]
  public var video: Bool
  public var labelled: Bool

  public init(
    text: String, tags: [String], langs: [String], quote: String?, link: Link?, images: [Image], video: Bool,
    labelled: Bool
  ) {
    self.text = text
    self.tags = tags
    self.langs = langs
    self.quote = quote
    self.link = link
    self.images = images
    self.video = video
    self.labelled = labelled
  }

  /// A seed as the web's object holds it (postAgainSeed's shape).
  public init(json: JSONValue) {
    text = json["text"]?.stringValue ?? ""
    tags = json["tags"]?.arrayValue?.compactMap(\.stringValue) ?? []
    langs = json["langs"]?.arrayValue?.compactMap(\.stringValue) ?? []
    quote = json["quote"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
    if let link = json["link"], link.isTruthy {
      self.link = Link(
        url: link["url"] ?? .null, title: link["title"]?.stringValue ?? "",
        description: link["description"]?.stringValue ?? "")
    } else {
      link = nil
    }
    images = (json["images"]?.arrayValue ?? []).map {
      Image(cid: $0["cid"] ?? .null, mime: $0["mime"]?.stringValue ?? "", alt: $0["alt"]?.stringValue ?? "")
    }
    video = json["video"]?.isTruthy ?? false
    labelled = json["labelled"]?.isTruthy ?? false
  }

  public var json: JSONValue {
    [
      "text": .string(text), "tags": .array(tags.map(JSONValue.string)), "langs": .array(langs.map(JSONValue.string)),
      "quote": quote.map(JSONValue.string) ?? .null,
      "link": link.map { ["url": $0.url, "title": .string($0.title), "description": .string($0.description)] } ?? .null,
      "images": .array(images.map(\.json)), "video": .bool(video), "labelled": .bool(labelled),
    ]
  }
}

/// A picture read back for "Post again".
public struct PostedImageFile: Hashable, Sendable {
  public var file: ComposerFile
  public var alt: String

  public var json: JSONValue { ["file": file.json, "alt": .string(alt)] }
}

/// fetchPostImages' answer.
public struct PostedImages: Hashable, Sendable {
  public var files: [PostedImageFile]
  public var missing: Int

  public var json: JSONValue { ["files": .array(files.map(\.json)), "missing": .number(Double(missing))] }
}

/// postAgainIntent's answer: the composer intent (nil when there is nothing
/// to open with) and what to say about what didn't come along.
public struct PostAgainIntent: Hashable, Sendable {
  public var intent: JSONValue?
  public var notes: [String]

  public var json: JSONValue { ["intent": intent ?? .null, "notes": .array(notes.map(JSONValue.string))] }
}

/// What a post row offers.
public struct PostRowActions: Codable, Hashable, Sendable {
  public var reply: Bool
  public var quote: Bool
  public var again: Bool
  public var gates: Bool
  public var gatesQuotesOnly: Bool
  public var timer: Bool
  public var template: Bool
  public var delete: Bool
}

public enum PostedModel {
  public static let postedFilters = [
    PostedFilter(value: "all", label: "All"),
    PostedFilter(value: "posts", label: "Posts"),
    PostedFilter(value: "replies", label: "Replies"),
    PostedFilter(value: "media", label: "With media"),
  ]

  static let post = "app.bsky.feed.post"
  static let threadgate = "app.bsky.feed.threadgate"
  static let postgate = "app.bsky.feed.postgate"

  /// Whether an archive row answers somebody else (not a post of its own
  /// thread).
  public static func isReplyRow(_ row: JSONValue?, _ did: String?) -> Bool {
    guard let replyTo = row?["replyTo"], replyTo.isTruthy else { return false }
    return !ComposerJS.strictEquals(replyTo, did.map(JSONValue.string))
  }

  /// The rows a filter and a search keep, in the order given. The search
  /// reads the words the row keeps (the archive holds the first 200
  /// characters).
  public static func filterPostRows(_ rows: [JSONValue]?, did: String?, filter: String = "all", query: String? = "")
    -> [JSONValue]
  {
    let needle = (query ?? "").jsTrimmed().jsLowercased()
    return (rows ?? []).filter { row in
      guard ComposerJS.truthy(row["uri"]) else { return false }
      if filter == "posts" && isReplyRow(row, did) { return false }
      if filter == "replies" && !isReplyRow(row, did) { return false }
      if filter == "media" && !ComposerJS.truthy(row["hasMedia"]) { return false }
      if !needle.isEmpty && ScheduledPostError.text(row["text"]).jsLowercased().jsIndexOf(needle) < 0 { return false }
      return true
    }
  }

  /// `/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/` on `String(uri || '')`.
  static func rkeyOf(_ uri: JSONValue?) -> (repo: String, rkey: String)? {
    let units = Array(ScheduledPostError.text(uri).utf16)
    let scheme = Array("at://".utf16)
    guard units.count > scheme.count, Array(units[0..<scheme.count]) == scheme else { return nil }
    let rest = units[scheme.count...]
    guard let slash = rest.firstIndex(of: 0x2F), slash > rest.startIndex else { return nil }
    let middle = Array("/app.bsky.feed.post/".utf16)
    let afterRepo = units[slash...]
    guard afterRepo.count > middle.count, Array(afterRepo.prefix(middle.count)) == middle else { return nil }
    let rkey = afterRepo.dropFirst(middle.count)
    guard !rkey.isEmpty, !rkey.contains(where: { $0 == 0x2F || $0 == 0x3F || $0 == 0x23 }) else { return nil }
    return (String(decoding: units[rest.startIndex..<slash], as: UTF16.self), String(decoding: rkey, as: UTF16.self))
  }

  static func gone() -> PostedModelError {
    PostedModelError(code: "GONE", "This post isn’t there any more. It may have been deleted somewhere else.")
  }

  /// `RecordNotFound`, a 404, or a message saying the record isn't there
  /// (`/RecordNotFound|could not locate record|not found/i`).
  static func isNotFound(_ error: any Error) -> Bool {
    let object = ScheduledPostError.errorObject(error)
    if object["error"] == "RecordNotFound" || ComposerJS.strictEquals(object["status"], .number(404)) { return true }
    let message = String(
      decoding: ScheduledPostError.text(object["message"]).utf16.map { $0 >= 0x41 && $0 <= 0x5A ? $0 + 0x20 : $0 },
      as: UTF16.self)
    return ["recordnotfound", "could not locate record", "not found"].contains { message.jsIndexOf($0) >= 0 }
  }

  static func getRecord(_ agent: XRPCAgent, _ repo: String, _ collection: String, _ rkey: String) async throws
    -> JSONValue
  {
    let params: XRPCParams = ["repo": .string(repo), "collection": .string(collection), "rkey": .string(rkey)]
    return try await agent.query("com.atproto.repo.getRecord", params).data
  }

  static func deleteRecord(_ agent: XRPCAgent, _ repo: String, _ collection: String, _ rkey: String) async throws {
    let input: JSONValue = ["repo": .string(repo), "collection": .string(collection), "rkey": .string(rkey)]
    _ = try await agent.procedure("com.atproto.repo.deleteRecord", input: .json(input))
  }

  /// The post at `uri` as it is now, from the public AppView, else from the
  /// account's repo (`view` is then nil). A post that is in neither throws
  /// GONE; one that couldn't be read throws the read's error.
  public static func readPostNow(_ uri: String, agent: XRPCAgent?, transport: any HTTPTransport = HTTP.transport)
    async throws -> PostNow
  {
    var firstError: (any Error)?
    let read = await PublicAppView.getPosts([uri], transport: transport)
    if let view = read.views.first(where: { ComposerJS.strictEquals($0["uri"], .string(uri)) }),
      let cid = view["cid"], cid.isTruthy
    {
      return PostNow(uri: uri, cid: cid, record: ComposerJS.or(view["record"], [:]) ?? [:], view: view)
    }
    if read.failed != 0 { firstError = read.error }
    guard let at = rkeyOf(.string(uri)), let agent else { throw firstError ?? gone() }
    do {
      let data = ComposerJS.or(try await getRecord(agent, at.repo, post, at.rkey), [:]) ?? [:]
      guard let cid = data["cid"], cid.isTruthy else { throw gone() }
      return PostNow(uri: uri, cid: cid, record: ComposerJS.or(data["value"], [:]) ?? [:], view: nil)
    } catch {
      if (error as? PostedModelError)?.code == "GONE" || isNotFound(error) { throw gone() }
      throw firstError ?? error
    }
  }

  /// Who may reply to and quote the post now, from its threadgate and
  /// postgate records (read side by side): `{ reply, quotes }` (reply nil
  /// is everyone).
  public static func readPostGates(_ uri: String, agent: XRPCAgent) async throws -> PostGates {
    guard let at = rkeyOf(.string(uri)) else { throw PostedModelError("Not a post.") }
    @Sendable func read(_ collection: String) async throws -> JSONValue? {
      do {
        let value = try await getRecord(agent, at.repo, collection, at.rkey)["value"]
        return value?.isTruthy == true ? value : nil
      } catch {
        if isNotFound(error) { return nil }
        throw error
      }
    }
    async let thread = read(threadgate)
    async let quote = read(postgate)
    let (threadRecord, postRecord) = try await (thread, quote)
    var rules: [String: JSONValue] = [:]
    if let threadRecord, let allow = threadRecord["allow"]?.arrayValue { rules["allow"] = .array(allow) }
    rules["embeddingRules"] = postRecord?["embeddingRules"]
    return Gates.gatesFromRules(.object(rules))
  }

  /// Delete the post, then its reply and quote settings (best effort: a
  /// gate left behind gates nothing). A post that's already gone counts as
  /// deleted.
  public static func deletePost(_ uri: String, agent: XRPCAgent) async throws {
    guard let at = rkeyOf(.string(uri)) else { throw PostedModelError("Not a post.") }
    do {
      try await deleteRecord(agent, at.repo, post, at.rkey)
    } catch {
      if !isNotFound(error) { throw error }
    }
    async let a: Void? = try? deleteRecord(agent, at.repo, threadgate, at.rkey)
    async let b: Void? = try? deleteRecord(agent, at.repo, postgate, at.rkey)
    _ = await (a, b)
  }

  /// The post's text as the composer writes it, with its links put back.
  public static func textForComposer(_ record: JSONValue?) -> String {
    InlineLinks.composerTextFromRecord(
      ScheduledPostError.text(record?["text"]), (ComposerJS.or(record?["facets"], []))?.arrayValue)
  }

  /// What "Save as a template" starts the editor with: the post's text, and
  /// what it quotes or links to when that's something a template can carry
  /// (a record or a link card; pictures can't be kept in a template).
  public static func templateSeedFrom(_ record: JSONValue?) -> JSONValue {
    let embed = ComposerJS.or(record?["embed"], nil)
    var seedEmbed: JSONValue = .null
    let type = embed?["$type"]?.stringValue
    func ref(_ value: JSONValue?) -> JSONValue {
      var out: [String: JSONValue] = [:]
      out["uri"] = value?["uri"]
      out["cid"] = value?["cid"]
      return .object(out)
    }
    if type == "app.bsky.embed.record", ComposerJS.truthy(embed?["record"]?["uri"]),
      ComposerJS.truthy(embed?["record"]?["cid"])
    {
      seedEmbed = ["$type": "app.bsky.embed.record", "record": ref(embed?["record"])]
    } else if type == "app.bsky.embed.recordWithMedia", ComposerJS.truthy(embed?["record"]?["record"]?["uri"]) {
      seedEmbed = ["$type": "app.bsky.embed.record", "record": ref(embed?["record"]?["record"])]
    } else if type == "app.bsky.embed.external", ComposerJS.truthy(embed?["external"]?["uri"]) {
      let external = embed?["external"]
      seedEmbed = [
        "$type": "app.bsky.embed.external",
        "external": [
          "uri": external!["uri"]!,
          "title": .string(ScheduledPostError.text(external?["title"])),
          "description": .string(ScheduledPostError.text(external?["description"])),
        ],
      ]
    }
    return ["text": .string(textForComposer(record)), "embed": seedEmbed]
  }

  // MARK: Posting it again

  static func mimeOf(_ blob: JSONValue?) -> String { blob?["mimeType"]?.stringValue ?? "image/jpeg" }

  /// The pictures an embed carries, in order.
  static func imagesOf(_ media: JSONValue?) -> [PostAgainSeed.Image] {
    let list: JSONValue?
    switch media?["$type"]?.stringValue {
    case "app.bsky.embed.images"?: list = media?["images"]
    case "app.bsky.embed.gallery"?: list = media?["items"]
    default: list = nil
    }
    return (list?.arrayValue ?? []).compactMap { item in
      guard let cid = Blobs.blobCid(item["image"]), cid.isTruthy else { return nil }
      return PostAgainSeed.Image(cid: cid, mime: mimeOf(item["image"]), alt: item["alt"]?.stringValue ?? "")
    }
  }

  /// What "Post again" takes from a post as it reads now: its words with
  /// their links put back, its tags and languages, what it quotes, its link
  /// card, and its pictures by CID (fetchPostImages reads them back from
  /// the repo). `video` and `labelled` say what can't come along as it is.
  public static func postAgainSeed(_ record: JSONValue?) -> PostAgainSeed {
    let embed = ComposerJS.or(record?["embed"], nil)
    let withMedia = embed?["$type"] == "app.bsky.embed.recordWithMedia"
    let media = withMedia ? embed?["media"] : embed
    let quoted: JSONValue? =
      withMedia
      ? embed?["record"]?["record"]?["uri"]
      : (embed?["$type"] == "app.bsky.embed.record" ? embed?["record"]?["uri"] : nil)
    let external = media?["$type"] == "app.bsky.embed.external" ? media?["external"] : nil
    var link: PostAgainSeed.Link?
    if let url = external?["uri"], url.isTruthy {
      link = PostAgainSeed.Link(
        url: url, title: ScheduledPostError.text(external?["title"]),
        description: ScheduledPostError.text(external?["description"]))
    }
    return PostAgainSeed(
      text: textForComposer(record),
      tags: Tags.normalizeTags(record?["tags"]),
      langs: ComposerJS.stringList(record?["langs"]),
      quote: quoted?.stringValue.flatMap { $0.isEmpty ? nil : $0 },
      link: link,
      images: imagesOf(media),
      video: media?["$type"] == "app.bsky.embed.video",
      labelled: !(record?["labels"]?["values"]?.arrayValue?.isEmpty ?? true))
  }

  /// Read a post's pictures back from the account's own repo (the PDS's
  /// public `com.atproto.sync.getBlob`), as files the composer can attach.
  /// A picture that can't be read is counted, not thrown: the post still
  /// opens, and the writer adds it again.
  public static func fetchPostImages(
    _ images: [PostAgainSeed.Image]?, did: String?, pdsUrl: String?, transport: any HTTPTransport = HTTP.transport,
    files: any ComposerFiles
  ) async -> PostedImages {
    var out: [PostedImageFile] = []
    var missing = 0
    for (n, image) in (images ?? []).enumerated() {
      do {
        guard let pdsUrl, !pdsUrl.isEmpty else { throw PostedModelError("no PDS") }
        let base = String(decoding: trimTrailingSlashes(Array(pdsUrl.utf16)), as: UTF16.self)
        let url =
          "\(base)/xrpc/com.atproto.sync.getBlob?did=\(JSURI.encodeURIComponent(did ?? "undefined"))&cid=\(JSURI.encodeURIComponent(image.cid.jsString))"
        let response = try await transport.send(HTTPRequest(url: url))
        guard response.ok else { throw PostedModelError("HTTP \(response.status)") }
        guard !response.body.isEmpty else { throw PostedModelError("empty") }
        let blobType = LinkCard.blobType(response.headers.get("content-type"))
        let type = PostingJS.hasPrefix(blobType, "image/") ? blobType : image.mime
        let parts = PostingQueue.split(type, 0x2F)
        let sub = parts.count > 1 ? PostingQueue.split(parts[1], 0x2B)[0] : ""
        let ext = sub.isEmpty ? "jpg" : sub
        let file = try await files.makeFile(
          response.body, name: "posted-image-\(n + 1).\(ext)", type: ScheduleSerialize.blobType(type), lastModified: nil)
        out.append(PostedImageFile(file: file, alt: image.alt))
      } catch {
        missing += 1
      }
    }
    return PostedImages(files: out, missing: missing)
  }

  /// `String(url).replace(/\/+$/, '')`.
  static func trimTrailingSlashes(_ units: [UInt16]) -> [UInt16] {
    var end = units.count
    while end > 0, units[end - 1] == 0x2F { end -= 1 }
    return Array(units[..<end])
  }

  /// The composer intent for "Post again", and what to tell the writer
  /// about anything that didn't come along. `intent` is nil when there is
  /// nothing to open with (a post that was only pictures, none of which
  /// could be read). The new post goes out with the account's usual reply
  /// settings and no timer, as any new post does, and never as a reply.
  public static func postAgainIntent(_ seed: PostAgainSeed, did: String, files: [PostedImageFile] = [], missing: Int = 0)
    -> PostAgainIntent
  {
    var notes: [String] = []
    let pictures = seed.labelled ? [] : files
    if seed.labelled && !seed.images.isEmpty {
      notes.append(
        "It had a content warning, so its pictures weren’t brought over. Add them again and set the warning.")
    } else if missing > 0 {
      notes.append(
        "\(missing == 1 ? "One of its pictures" : "\(missing) of its pictures") couldn’t be fetched. Add \(missing == 1 ? "it" : "them") again."
      )
    }
    if seed.video { notes.append("Its video isn’t carried over. Add it again.") }

    var intent: [String: JSONValue] = ["asDid": .string(did), "text": .string(seed.text)]
    if !seed.tags.isEmpty { intent["tags"] = .array(seed.tags.map(JSONValue.string)) }
    if !seed.langs.isEmpty { intent["langs"] = .array(seed.langs.map(JSONValue.string)) }
    if let quote = seed.quote { intent["quote"] = ["uri": .string(quote)] }
    if !pictures.isEmpty {
      intent["images"] = .array(pictures.map(\.json))
    } else if let link = seed.link {
      // A post holds pictures or a link card, not both; the original had one.
      intent["attach"] = [
        "attach": [
          "kind": "link", "url": link.url, "title": .string(link.title), "description": .string(link.description),
        ]
      ]
    }
    let brings = !seed.text.jsTrimmed().isEmpty || !seed.tags.isEmpty || seed.quote != nil || !pictures.isEmpty
      || seed.link != nil
    return PostAgainIntent(intent: brings ? .object(intent) : nil, notes: notes)
  }

  /// What a post row offers, given the account's capabilities.
  public static func postRowActions(_ row: JSONValue?, canPost: Bool, canSchedule: Bool) -> PostRowActions {
    PostRowActions(
      reply: canPost, quote: canPost, again: canPost, gates: canPost,
      // Replies take no threadgate: only quoting can be changed on one.
      gatesQuotesOnly: ComposerJS.truthy(row?["replyTo"]),
      timer: canSchedule, template: true, delete: canPost)
  }

  /// Whether only quoting can be changed on the post: true for any reply,
  /// its own thread's included. `record` is the post as it reads now.
  public static func gatesQuotesOnlyFor(_ offer: PostRowActions?, _ record: JSONValue?) -> Bool {
    (offer?.gatesQuotesOnly ?? false) || ComposerJS.truthy(record?["reply"])
  }
}
