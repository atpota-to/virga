// Ports harness/fakeXrpc.js (methodsFor: the methods one account's agent answers)
//
// `params` is the params of a query or the body of a procedure (`input ??
// {}`), `opts` the call options (`encoding`, `headers`). Reads go to the
// account's world as it is now; writes go through DemoWorld.update and
// HarnessRepo, as the web's go through repo.js.

import Foundation
import VirgaCore
import VirgaNetwork

extension FakeAgent {
  var now: Double { core.clock.now() }

  func ownWorld() throws -> AccountWorld {
    guard let found = world.world(did) else { throw DemoWorldError.noAccount(did) }
    return found
  }

  /// `ownRepo(repo)`: an account writes only to its own repo.
  func ownRepo(_ repo: JSONValue?, _ me: AccountWorld) throws {
    guard let repo = repo.jsTruthy else { return }
    if case .string(let text) = repo, text.jsEquals(did) || text.jsEquals(me.me.handle) { return }
    throw HarnessRepo.XrpcError(403, "InvalidRequest", "This account can only write to its own repo")
  }

  /// `repoWorld(repo)`: another account's world, by DID or handle.
  func repoWorld(_ repo: JSONValue, _ views: DemoViews) throws -> AccountWorld {
    let key = repo.stringValue
    if let key, let found = views.world(key) { return found }
    if let did = views.resolveHandle(FakeXrpc.textOrEmpty(repo)), let found = views.world(did) { return found }
    throw HarnessRepo.XrpcError(400, "InvalidRequest", "Could not find repo: \(FakeXrpc.text(repo))")
  }

  /// The world a read is for: another repo's when one is named, else the
  /// account's own.
  func sourceWorld(_ repo: JSONValue?, _ me: AccountWorld, _ views: DemoViews) throws -> AccountWorld {
    guard let repo = repo.jsTruthy else { return me }
    if case .string(let text) = repo, text.jsEquals(did) { return me }
    return try repoWorld(repo, views)
  }

  /// A collection or record key as the web's string keys see it.
  static func key(_ value: JSONValue?) -> String { value?.stringValue ?? FakeXrpc.text(value) }

  /// A truthy key, or nil for the web's falsy one (writeRecord refuses it).
  static func truthyKey(_ value: JSONValue?) -> String? { value.jsTruthy.map { $0.stringValue ?? $0.jsString } }

  func notFound(_ collection: JSONValue?, _ rkey: JSONValue?) -> HarnessRepo.XrpcError {
    HarnessRepo.XrpcError(
      400, "RecordNotFound", "Could not locate record: at://\(did)/\(FakeXrpc.text(collection))/\(FakeXrpc.text(rkey))")
  }

  /// `checkSwap(collection, rkey, swapRecord)`.
  func checkSwap(_ world: AccountWorld, _ collection: JSONValue?, _ rkey: JSONValue?, _ swapRecord: JSONValue?) throws {
    guard let swapRecord else { return }
    let current = try HarnessRepo.readRecord(world, Self.key(collection), Self.key(rkey))
    let matches: Bool
    if swapRecord.isNull {
      matches = current == nil
    } else if case .string(let cid) = swapRecord, let current {
      matches = current.cid.jsEquals(cid)
    } else {
      matches = false
    }
    if !matches { throw HarnessRepo.XrpcError(400, "InvalidSwap", "Record was at \(current?.cid ?? "null")") }
  }

  /// `commit()`: `{ cid, rev }`.
  func commit() throws -> JSONValue {
    ["cid": "bafyharnesscommit", "rev": .string(try World.tidAt(now))]
  }

  func written(_ res: HarnessRepo.WriteResult) throws -> JSONValue {
    ["uri": .string(res.uri), "cid": .string(res.cid), "commit": try commit(), "validationStatus": "valid"]
  }

  static func encode<T: Encodable>(_ rows: [T]) throws -> JSONValue { try JSONValue(encoding: rows) }

  static func page(_ key: String, _ rows: JSONValue, _ cursor: String?, _ extra: [String: JSONValue] = [:]) -> JSONValue {
    var out = extra
    out[key] = rows
    if let cursor { out["cursor"] = .string(cursor) }
    return .object(out)
  }

  /// Whether the AppView counts known followers for this batch
  /// (`knownFollowersCounter`): `ok` always; `failopen` never; `flaky` not
  /// the first time a batch is asked and always after.
  func counted(_ actors: [JSONValue]) -> Bool {
    if core.appview == "failopen" { return false }
    if core.appview != "flaky" { return true }
    // `[...actors].sort().join(' ')`: sorted as strings, joined with null as ''.
    let key = actors.jsSorted { a, b in a.jsString.jsLess(b.jsString) ? -1 : b.jsString.jsLess(a.jsString) ? 1 : 0 }
      .map { $0.isNull ? "" : $0.jsString }.joined(separator: " ")
    return core.asked.withLock { $0.insert(JSKey(key)).inserted == false }
  }

  /// One method's answer.
  func answer(_ nsid: String, _ p: JSONValue, _ input: FakeXrpc.Input, _ opts: JSONValue) async throws -> JSONValue {
    switch nsid {
    /* ---- the dashboard's reads ---------------------------------------- */
    case "app.bsky.graph.getFollowers":
      let me = try ownWorld()
      var all = me.followers
      if let churn = core.churn {
        if p["cursor"].jsTruthy == nil { churn.startSweep() }
        all = churn.list(me.followers)
      }
      let page = Views.pageOf(all, limit: p["limit"], cursor: p["cursor"])
      return Self.page("followers", try Self.encode(page.rows), page.cursor, ["subject": world.views.card(did)])

    case "app.bsky.notification.listNotifications":
      let me = try ownWorld()
      let page = Views.pageOf(me.notifications, limit: p["limit"], cursor: p["cursor"])
      return Self.page("notifications", try Self.encode(page.rows), page.cursor)

    /* ---- the repo ------------------------------------------------------ */
    case "com.atproto.repo.listRecords":
      let views = world.views
      let me = try ownWorld()
      let source = try sourceWorld(p["repo"], me, views)
      var all = try HarnessRepo.listCollection(source, Self.key(p["collection"]))
      if p["reverse"].jsTruthy != nil { all.reverse() }
      let page = Views.pageOf(all, limit: p["limit"], cursor: p["cursor"])
      return Self.page("records", try Self.encode(page.rows), page.cursor)

    case "com.atproto.repo.getRecord":
      let views = world.views
      let me = try ownWorld()
      let source = try sourceWorld(p["repo"], me, views)
      guard let found = try HarnessRepo.readRecord(source, Self.key(p["collection"]), Self.key(p["rkey"])) else {
        throw notFound(p["collection"], p["rkey"])
      }
      return try JSONValue(encoding: found)

    case "com.atproto.repo.describeRepo":
      let me = try ownWorld()
      var collections = JSOrderedSet([
        "app.bsky.actor.profile", "app.bsky.feed.post", "app.bsky.graph.follow", "app.bsky.feed.like",
        "app.bsky.feed.repost",
      ])
      for r in me.others { collections.add(r.collection) }
      for key in me.written.keys { collections.add(key.jsSplit("/")[0]) }
      let sorted = collections.elements.jsSorted { a, b in a.jsLess(b) ? -1 : b.jsLess(a) ? 1 : 0 }
      return [
        "did": .string(did), "handle": .string(me.me.handle), "handleIsCorrect": true,
        "collections": .array(sorted.map(JSONValue.string)), "didDoc": [:],
      ]

    case "com.atproto.repo.createRecord":
      let at = now
      let res = try world.update(did) { w -> HarnessRepo.WriteResult in
        try ownRepo(p["repo"], w)
        let rkey = Self.truthyKey(p["rkey"]) ?? core.tids.next(ms: at)
        return try HarnessRepo.writeRecord(
          &w, collection: Self.truthyKey(p["collection"]), rkey: rkey, record: p["record"], createOnly: true, now: at)
      }
      return try written(res)

    case "com.atproto.repo.putRecord":
      let at = now
      let res = try world.update(did) { w -> HarnessRepo.WriteResult in
        try ownRepo(p["repo"], w)
        try checkSwap(w, p["collection"], p["rkey"], p["swapRecord"])
        return try HarnessRepo.writeRecord(
          &w, collection: Self.truthyKey(p["collection"]), rkey: Self.truthyKey(p["rkey"]), record: p["record"], now: at)
      }
      return try written(res)

    case "com.atproto.repo.deleteRecord":
      try world.update(did) { w in
        try ownRepo(p["repo"], w)
        try checkSwap(w, p["collection"], p["rkey"], p["swapRecord"])
        try HarnessRepo.removeRecord(&w, Self.key(p["collection"]), Self.key(p["rkey"]))
      }
      return ["commit": try commit()]

    case "com.atproto.repo.applyWrites":
      return try applyWrites(p)

    case "com.atproto.repo.uploadBlob":
      // `opts?.encoding || opts?.headers?.['content-type'] || ''`
      let encoding = opts["encoding"].jsTruthy ?? opts["headers"]?["content-type"].jsTruthy
      let type = encoding.map(\.jsString) ?? ""
      if type.isEmpty || type == "application/octet-stream" {
        throw HarnessRepo.XrpcError(400, "InvalidRequest", "A blob upload needs its media type")
      }
      let bytes: [UInt8]
      switch input {
      case .bytes(let data): bytes = data
      case .json(.string(let text)): bytes = Array(text.utf8)
      default: throw HarnessRepo.XrpcError(400, "InvalidRequest", "A blob upload needs a body")
      }
      return ["blob": try world.storeBlob(did: did, bytes: bytes, mimeType: type)]

    case "com.atproto.server.getServiceAuth":
      guard let aud = p["aud"].jsTruthy else { throw HarnessRepo.XrpcError(400, "InvalidRequest", "aud is required") }
      let nowSec = (now / 1000).rounded(.down)
      let expiry = p["exp"].jsTruthy.map(\.jsNumber) ?? nowSec + 60
      if !expiry.isFinite || expiry <= nowSec {
        throw HarnessRepo.XrpcError(400, "BadExpiration", "expiration is in the past")
      }
      let lxm = p["lxm"]
      if expiry - nowSec > (lxm.jsTruthy != nil ? 3600 : 60) {
        throw HarnessRepo.XrpcError(400, "BadExpiration", "cannot request a token that long-lived")
      }
      return ["token": .string(try FakeXrpc.mintServiceToken(iss: .string(did), aud: aud, lxm: lxm, exp: .number(expiry)))]

    /* ---- Bluesky's AppView, signed in ------------------------------------ */
    case "app.bsky.actor.getProfiles":
      return try getProfiles(p["actors"])

    case "app.bsky.actor.getPreferences":
      return ["preferences": .array(try ownWorld().preferences)]

    case "app.bsky.actor.putPreferences":
      try world.update(did) { w in w.preferences = p["preferences"]?.arrayValue ?? [] }
      return [:]

    case "app.bsky.bookmark.getBookmarks":
      let me = try ownWorld()
      let views = world.views
      let page = Views.pageOf(me.bookmarks, limit: p["limit"], cursor: p["cursor"])
      let at = now
      let rows: [JSONValue] = try page.rows.map { b in
        let view = try views.postView(b.uri, now: at)
        return [
          "subject": ["uri": .string(b.uri), "cid": view?["cid"].jsTruthy ?? "bafyharness"],
          "createdAt": .string(b.createdAt),
          "item": view ?? ["$type": "app.bsky.feed.defs#notFoundPost", "uri": .string(b.uri), "notFound": true],
        ]
      }
      return Self.page("bookmarks", .array(rows), page.cursor)

    case "app.bsky.bookmark.createBookmark":
      let uri = Self.key(p["uri"])
      let stamp = World.iso(now)
      try world.update(did) { w in
        if !w.bookmarks.contains(where: { $0.uri.jsEquals(uri) }) {
          w.bookmarks.insert(WorldBookmark(uri: uri, createdAt: stamp), at: 0)
        }
      }
      return [:]

    case "app.bsky.bookmark.deleteBookmark":
      let uri = p["uri"]?.stringValue
      try world.update(did) { w in w.bookmarks.removeAll { Optional($0.uri).jsEquals(uri) } }
      return [:]

    case "app.bsky.feed.searchPosts":
      guard let q = p["q"].jsTruthy else { throw HarnessRepo.XrpcError(400, "InvalidRequest", "q is required") }
      let views = world.views
      var all = try views.searchPosts(q.stringValue ?? q.jsString, now: now)
      if let author = p["author"].jsTruthy {
        // `author.startsWith('did:')`: only a string has it.
        guard let name = author.stringValue else { throw HarnessJSError.typeError("author.startsWith is not a function") }
        let authorDid = name.jsHasPrefix("did:") ? name : views.resolveHandle(name)
        all = all.filter { Optional($0["author"]?["did"]?.stringValue ?? "").jsEquals(authorDid) }
      }
      // `limit ?? 25`
      var limit: JSONValue = 25
      if let given = p["limit"], !given.isNull { limit = given }
      let page = Views.pageOf(all, limit: limit, cursor: p["cursor"])
      return Self.page("posts", .array(page.rows), page.cursor, ["hitsTotal": .number(Double(all.count))])

    /* ---- drafts (app.bsky.draft.*), kept for the account alone ---------- */
    case "app.bsky.draft.getDrafts":
      let me = try ownWorld()
      // `(a.updatedAt < b.updatedAt ? 1 : -1)`: never "equal".
      let sorted = me.drafts.jsSorted { a, b in a.updatedAt.jsLess(b.updatedAt) ? 1 : -1 }
      let page = Views.pageOf(sorted, limit: p["limit"], cursor: p["cursor"])
      return Self.page("drafts", try Self.encode(page.rows), page.cursor)

    case "app.bsky.draft.createDraft":
      let draft = p["draft"]
      guard let draft = draft.jsTruthy, let posts = draft["posts"]?.arrayValue, !posts.isEmpty else {
        throw HarnessRepo.XrpcError(400, "InvalidRequest", "A draft needs at least one post")
      }
      let at = now
      let stamp = World.iso(at)
      let id = try world.update(did) { w -> String in
        if w.drafts.count >= FakeXrpc.draftLimit {
          throw HarnessRepo.XrpcError(400, "DraftLimitReached", "Draft limit reached")
        }
        let id = core.tids.next(ms: at)
        w.drafts.append(WorldDraft(id: id, draft: draft, createdAt: stamp, updatedAt: stamp))
        return id
      }
      return ["id": .string(id)]

    case "app.bsky.draft.updateDraft":
      // Bluesky answers an update to a draft that is gone with success, and
      // changes nothing; drafts.js looks first because of it.
      let id = p["draft"]?["id"]?.stringValue
      let stamp = World.iso(now)
      try world.update(did) { w in
        guard let i = w.drafts.firstIndex(where: { Optional($0.id).jsEquals(id) }) else { return }
        // `found.draft = draft.draft`: left out when the update sent none.
        w.drafts[i].draft = p["draft"]?["draft"]
        w.drafts[i].updatedAt = stamp
      }
      return [:]

    case "app.bsky.draft.deleteDraft":
      let id = p["id"]?.stringValue
      try world.update(did) { w in w.drafts.removeAll { Optional($0.id).jsEquals(id) } }
      return [:]

    default:
      throw HarnessRepo.XrpcError(501, "MethodNotImplemented", "Method Not Implemented: \(nsid)")
    }
  }

  /// applyWrites: all or nothing for what can be checked first (every
  /// create is checked before anything is written), then each in turn.
  func applyWrites(_ p: JSONValue) throws -> JSONValue {
    let at = now
    return try world.update(did) { w -> JSONValue in
      try ownRepo(p["repo"], w)
      guard let writes = p["writes"]?.arrayValue, !writes.isEmpty else {
        throw HarnessRepo.XrpcError(400, "InvalidRequest", "applyWrites needs writes")
      }
      if writes.count > 200 { throw HarnessRepo.XrpcError(400, "InvalidRequest", "Too many writes. Max: 200") }
      struct Planned {
        var write: JSONValue
        var kind: String?
        var rkey: String
      }
      let planned = writes.map { write in
        Planned(write: write, kind: FakeXrpc.writeKind(write), rkey: Self.truthyKey(write["rkey"]) ?? core.tids.next(ms: at))
      }
      var seen = Set<JSKey>()
      for w0 in planned {
        guard let kind = w0.kind, ["create", "update", "delete"].contains(kind) else {
          throw HarnessRepo.XrpcError(400, "InvalidRequest", "Unknown write: \(FakeXrpc.text(w0.write["$type"]))")
        }
        let key = HarnessRepo.keyOf(Self.key(w0.write["collection"]), w0.rkey)
        if !seen.insert(JSKey(key)).inserted {
          throw HarnessRepo.XrpcError(400, "InvalidRequest", "Two writes to \(key)")
        }
        if kind == "create", try HarnessRepo.readRecord(w, Self.key(w0.write["collection"]), w0.rkey) != nil {
          throw HarnessRepo.XrpcError(400, "InvalidRequest", "Record already exists at \(key)")
        }
      }
      var results: [JSONValue] = []
      for w0 in planned {
        if w0.kind == "delete" {
          try HarnessRepo.removeRecord(&w, Self.key(w0.write["collection"]), w0.rkey)
          results.append(["$type": "com.atproto.repo.applyWrites#deleteResult"])
        } else {
          let res = try HarnessRepo.writeRecord(
            &w, collection: Self.truthyKey(w0.write["collection"]), rkey: w0.rkey, record: w0.write["value"], now: at)
          results.append([
            "$type": .string("com.atproto.repo.applyWrites#\(w0.kind ?? "")Result"), "uri": .string(res.uri),
            "cid": .string(res.cid), "validationStatus": "valid",
          ])
        }
      }
      return ["commit": try commit(), "results": .array(results)]
    }
  }

  /// Profiles as this account sees them, with `viewer.knownFollowers`: how
  /// many of the people it follows follow each one (Crowd). Under
  /// appview 'failopen' or 'flaky' the counts are left off a call, as the
  /// real AppView does when its lookup runs out of time.
  func getProfiles(_ actors: JSONValue?) throws -> JSONValue {
    let list: [JSONValue]
    if let array = actors?.arrayValue {
      list = array
    } else {
      list = actors.jsTruthy.map { [$0] } ?? []
    }
    if list.count > 25 { throw HarnessRepo.XrpcError(400, "InvalidRequest", "Too many actors: at most 25") }
    let withCounts = counted(list)
    let views = world.views
    let me = try ownWorld()
    var profiles: [JSONValue] = []
    for actor in list {
      let text = actor.stringValue
      // A list (say) whose `String()` starts "did:" is kept as the id
      // itself, which no Map holds: nobody is found.
      if text == nil && actor.jsString.jsHasPrefix("did:") { continue }
      let byDid = text.map { views.world($0) != nil } ?? false
      let id: String? = byDid || actor.jsString.jsHasPrefix("did:") ? actor.jsString : views.resolveHandle(FakeXrpc.textOrEmpty(actor))
      guard let known = views.person(id) else { continue }
      var p: JSONValue?
      if let id, let own = views.world(id) {
        var profile = try JSONValue(encoding: own.profile)
        profile["viewer"] = [:]
        p = profile
      } else if let id {
        p = views.crowd.profileAs(me, id, card: known)
      }
      guard var found = p, found.isTruthy else { continue }
      if !withCounts, case .object(var viewer)? = found["viewer"] {
        viewer["knownFollowers"] = nil
        found["viewer"] = .object(viewer)
      }
      profiles.append(found)
    }
    return ["profiles": .array(profiles)]
  }
}
