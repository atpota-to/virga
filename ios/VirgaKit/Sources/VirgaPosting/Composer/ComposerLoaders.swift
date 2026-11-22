// Ports src/posting/composer/loaders.js
//
// Reading what an intent names before the composer shows it: the post
// being replied to, a record to quote, a Bluesky draft, a scheduled post.
// Public reads go to the public AppView through VirgaNetwork's ports of
// library/sources.js's helpers (PublicAppView.getPosts, publicXrpc,
// resolveHandle); the write account's own agent isn't asked for anything
// its scope doesn't hold. Every dependency can be injected (ComposerReads,
// and the draft and scheduled calls), so the tests run without a network.

import Foundation
import VirgaCore
import VirgaNetwork

/// A coded error with a sentence to show: NOT_FOUND, GONE, READ_FAILED,
/// REAUTH_REQUIRED, NEEDS_BACKEND, PARTIAL or NOT_EDITABLE.
public struct ComposerLoadError: Error, LocalizedError, Hashable, Sendable {
  public var code: String
  public var message: String
  public init(_ code: String, _ message: String) {
    self.code = code
    self.message = message
  }
  public var errorDescription: String? { message }
}

/// The public reads the loaders make. `.network(transport:)` is the app's.
public struct ComposerReads: Sendable {
  public var getPosts: @Sendable ([String?]) async -> GetPostsResult
  public var resolveHandle: @Sendable (String?) async -> String?
  public var xrpc: @Sendable (String, QueryParams) async throws -> JSONValue

  public init(
    getPosts: @escaping @Sendable ([String?]) async -> GetPostsResult,
    resolveHandle: @escaping @Sendable (String?) async -> String?,
    xrpc: @escaping @Sendable (String, QueryParams) async throws -> JSONValue
  ) {
    self.getPosts = getPosts
    self.resolveHandle = resolveHandle
    self.xrpc = xrpc
  }

  /// The public AppView over `transport`.
  public static func network(transport: any HTTPTransport = HTTP.transport) -> ComposerReads {
    ComposerReads(
      getPosts: { uris in await PublicAppView.getPosts(uris, transport: transport) },
      resolveHandle: { handle in await PublicAppView.resolveHandle(handle, transport: transport) },
      xrpc: { nsid, params in try await PublicAppView.publicXrpc(nsid, params, transport: transport) })
  }
}

/// A scheduled post opened in the composer: its state and the row.
public struct ScheduledTarget<State: Sendable>: Sendable {
  public var state: State
  public var row: JSONValue
}

// The library is being ported in another chain; the merge replaces this
// with library/model.js's own isOwnThreadRow (VirgaPosting/Library).
/// Whether an archive row belongs on Your posts (else Your replies).
private func isOwnThreadRow(_ row: JSONValue?, _ selfDid: String) -> Bool {
  guard let replyTo = row?["replyTo"], replyTo.isTruthy else { return true }
  return replyTo.stringValue?.jsEquals(selfDid) ?? false
}

public enum ComposerLoaders {
  /// A coded error with a sentence to show.
  public static func loadError(_ code: String, _ message: String) -> ComposerLoadError {
    ComposerLoadError(code, message)
  }

  /// The at:// URI a target ref names, resolving a handle when it has to.
  public static func refUri(_ ref: JSONValue?, reads: ComposerReads) async throws -> String? {
    guard let ref, ref.isTruthy else { return nil }
    if let uri = ref["uri"], uri.isTruthy { return uri.jsString }
    let did: String?
    if let given = ref["did"], given.isTruthy {
      did = given.jsString
    } else {
      did = await reads.resolveHandle(ref["handle"]?.stringValue)
    }
    guard let did, !did.isEmpty else { return nil }
    return try PostLink.recordUri(did, ref["kind"]?.stringValue ?? "undefined", ref["rkey"]?.jsString ?? "undefined")
  }

  /// A post view as ComposerState.reply: the refs, and who and what it is.
  public static func replyFromView(_ view: JSONValue?) -> JSONValue? {
    guard let view, let uri = view["uri"], uri.isTruthy, let cid = view["cid"], cid.isTruthy else { return nil }
    let parentRoot = view["record"]?["reply"]?["root"]
    let root: JSONValue
    if let rootUri = parentRoot?["uri"], rootUri.isTruthy, let rootCid = parentRoot?["cid"], rootCid.isTruthy {
      root = ["uri": rootUri, "cid": rootCid]
    } else {
      root = ["uri": uri, "cid": cid]
    }
    var out: [String: JSONValue] = [
      "uri": uri, "cid": cid, "root": root, "text": .string(ComposerJS.str(view["record"]?["text"])), "view": view,
    ]
    if let author = view["author"], author.isTruthy {
      var who: [String: JSONValue] = [
        "displayName": ComposerJS.or(author["displayName"], "") ?? "",
        "avatar": ComposerJS.or(author["avatar"], nil) ?? .null,
      ]
      if let did = author["did"] { who["did"] = did }
      if let handle = author["handle"] { who["handle"] = handle }
      out["author"] = .object(who)
    }
    return .object(out)
  }

  static func onePost(_ uri: String, _ reads: ComposerReads) async throws -> JSONValue? {
    let result = await reads.getPosts([uri])
    if result.failed > 0 {
      throw result.error
        ?? loadError("READ_FAILED", "Couldn’t read that post. Check your connection and try again.")
    }
    return result.views.first { $0["uri"]?.stringValue?.jsEquals(uri) ?? false } ?? result.views.first
  }

  /// The post a reply answers, as ComposerState.reply. Throws with a sentence.
  public static func loadReplyTarget(_ ref: JSONValue?, reads: ComposerReads = .network()) async throws -> JSONValue {
    guard let uri = try await refUri(ref, reads: reads) else {
      throw loadError("NOT_FOUND", "Couldn’t find the post to reply to.")
    }
    let view = try await onePost(uri, reads)
    guard let reply = replyFromView(view) else {
      throw loadError("GONE", "The post you’re replying to is gone, or can’t be seen.")
    }
    return reply
  }

  static let nouns = ["post": "post", "feed": "feed", "list": "list", "starterpack": "starter pack"]

  /// A record to attach (post, feed, list or starter pack) as a
  /// PostDraft's `record`: `{ kind, uri, cid, view }`. Throws with a
  /// sentence when it can't be read or is gone.
  public static func loadRecordTarget(_ ref: JSONValue?, reads: ComposerReads = .network()) async throws -> JSONValue {
    let uri = try await refUri(ref, reads: reads)
    let kind = ref?["kind"]?.stringValue
    let noun = kind.flatMap { nouns.jsValue($0) } ?? "post"
    guard let uri else { throw loadError("NOT_FOUND", "Couldn’t find that \(noun).") }
    var view: JSONValue?
    do {
      switch kind {
      case "post": view = try await onePost(uri, reads)
      case "feed": view = try await reads.xrpc("app.bsky.feed.getFeedGenerator", ["feed": .string(uri)])["view"]
      case "list": view = try await reads.xrpc("app.bsky.graph.getList", ["list": .string(uri), "limit": 1])["list"]
      case "starterpack":
        view = try await reads.xrpc("app.bsky.graph.getStarterPack", ["starterPack": .string(uri)])["starterPack"]
      default: break
      }
    } catch {
      // `err?.status`: whichever read failed, by the status it carries.
      let status = ComposerSubmit.status(of: error)
      if status == 400 || status == 404 {
        view = nil
      } else {
        throw loadError("READ_FAILED", "Couldn’t read that \(noun). Check your connection and try again.")
      }
    }
    guard let view, let viewUri = view["uri"], viewUri.isTruthy, let cid = view["cid"], cid.isTruthy else {
      throw loadError("GONE", "That \(noun) is gone, so it can’t be attached.")
    }
    var out: [String: JSONValue] = ["uri": viewUri, "cid": cid, "view": view]
    if let kind = ref?["kind"] { out["kind"] = kind }
    return .object(out)
  }

  /// A Bluesky draft for the composer, as its owner: what `openDraft` makes
  /// of it. Throws with a sentence when it can't be found.
  public static func loadDraftTarget<Agent, Opened>(
    draftId: JSONValue?,
    ownerDid: String,
    agentFor: (String) async throws -> Agent,
    listAllDrafts: (Agent) async throws -> [JSONValue]?,
    openDraft: (JSONValue, String) async throws -> Opened
  ) async throws -> Opened {
    let agent: Agent
    do {
      agent = try await agentFor(ownerDid)
    } catch {
      throw loadError("REAUTH_REQUIRED", "This draft’s account needs to sign in again before it can be opened.")
    }
    let all: [JSONValue]?
    do {
      all = try await listAllDrafts(agent)
    } catch {
      throw loadError("READ_FAILED", "Couldn’t read your drafts from Bluesky. Try again.")
    }
    guard let view = (all ?? []).first(where: { ComposerJS.strictEquals($0["id"], draftId) }) else {
      throw loadError("GONE", "That draft is gone. It may have been posted or deleted in another app.")
    }
    return try await openDraft(view, ownerDid)
  }

  /// A scheduled post for the composer: the row, its images, then
  /// `reconstructFromScheduled`. Only rows that haven't started going out
  /// can be changed here. `status(of:)` reads an error's HTTP status.
  public static func loadScheduledTarget<Requester, State: Sendable>(
    id: JSONValue,
    asDid: String,
    req: Requester?,
    getScheduled: (Requester, JSONValue) async throws -> JSONValue?,
    getScheduledMedia: (Requester, JSONValue) async throws -> JSONValue,
    reconstructFromScheduled: (JSONValue, JSONValue, String) throws -> State,
    status: (any Error) -> Int? = { ComposerSubmit.status(of: $0) }
  ) async throws -> ScheduledTarget<State> {
    guard let req else {
      throw loadError("NEEDS_BACKEND", "Scheduled posts need a long session through Virga’s server.")
    }
    let gone = loadError("GONE", "That scheduled post is gone. It may already have gone out.")
    let row: JSONValue?
    do {
      row = try await getScheduled(req, id)
    } catch {
      if status(error) == 404 { throw gone }
      throw loadError("READ_FAILED", "Couldn’t read that scheduled post. Try again.")
    }
    guard let row, row.isTruthy else { throw gone }
    if ComposerJS.truthy(row["partial"]) {
      throw loadError(
        "PARTIAL",
        "Part of this thread has already gone out, so it can’t be changed. Retry or cancel it in Scheduled posts.")
    }
    if !ComposerJS.includes(["pending", "failed"], row["status"]) {
      throw loadError("NOT_EDITABLE", "This post is going out right now, so it can’t be changed.")
    }
    let media = row["payload"]?["media"]
    let hasMedia = ComposerJS.truthy(media) && !ComposerJS.spread(media).isEmpty
    var found: JSONValue = [:]
    if hasMedia {
      do {
        found = try await getScheduledMedia(req, id)
      } catch {
        throw loadError("READ_FAILED", "Couldn’t read this post’s images from Virga’s server. Try again.")
      }
    }
    return ScheduledTarget(state: try reconstructFromScheduled(row, found, asDid), row: row)
  }

  /// The account's own latest posts to continue, newest first, from its
  /// archive rows: top-level posts and continuations of its own threads. A
  /// row's time without an offset is read in `timeZone` (the device's).
  public static func continueCandidates(_ rows: [JSONValue]?, _ did: String, limit: Int = 5, timeZone: TimeZone? = nil)
    -> [JSONValue]
  {
    let zone = timeZone ?? AppLocale.activeTimeZone()
    func time(_ row: JSONValue) -> Double {
      let at = ComposerJS.or(row["at"], "") ?? ""
      let ms = JSDate.parse(at.jsString, timeZone: zone)
      return ms.isNaN || ms == 0 ? 0 : ms
    }
    let prefix = "at://\(did)/app.bsky.feed.post/"
    let mine = (rows ?? []).filter { row in
      guard let uri = row["uri"]?.stringValue, PostingJS.hasPrefix(uri, prefix) else { return false }
      return isOwnThreadRow(row, did)
    }
    // `.slice(0, limit)`: a negative limit counts back from the end.
    return ComposerJS.slice(TimerJS.v8Sorted(mine) { time($1) - time($0) }, 0, limit)
  }
}
