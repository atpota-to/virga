// Ports src/lib/analyticsSync.js
//
// The archive's network sweeps: the loops that walk paginated APIs and hand
// compact rows back. No state and no storage: the archive model
// orchestrates and persists what these gather.
//
//   followers   app.bsky.graph.getFollowers through the account's agent
//               (only a signed-in call carries viewer.followedBy, whose TID
//               dates the follow)
//   following   the account's own follow records (listRecords)
//   blocks      Constellation backlinks: direct blocks, then the lists the
//               account is on, which are moderation lists, and who
//               subscribes to block them
//   posts       app.bsky.feed.getAuthorFeed on the public AppView
//   inbound     app.bsky.notification.listNotifications through the agent
//   outbound    the account's like and repost records (listRecords), the
//               fallback when the repo CAR can't be read
//
// Progress is reported as facts; syncProgress turns them into a bar. Every
// sweep can be called off (the web's AbortSignal is the task's
// cancellation), hands each page to `onPage` as it lands, and says honestly
// whether it completed, was called off, or failed partway.

import Foundation
import VirgaCore
import VirgaNetwork

/// What `sweepFollowers` read.
public struct SweepFollowersResult: Codable, Hashable, Sendable {
  public var followers: [FollowerRow]
  public var complete: Bool
  public var aborted: Bool
  public var error: String?
}

/// What `sweepFollowing` read.
public struct SweepFollowingResult: Codable, Hashable, Sendable {
  public var following: [FollowingRow]
  public var complete: Bool
  public var aborted: Bool
  public var error: String?
}

/// What `sweepBlocks` read: the block paths and every list the account is on.
public struct SweepBlocksResult: Codable, Hashable, Sendable {
  public var blocks: [BlockRow]
  public var lists: [ListInfo]
  public var complete: Bool
  public var truncated: Bool
  public var aborted: Bool
  public var error: String?
}

/// What `sweepPosts` did: how many rows it handed over, and the cursor to
/// resume from when it stopped short.
public struct SweepPostsResult: Codable, Hashable, Sendable {
  public var fetched: Int
  public var complete: Bool
  public var aborted: Bool
  public var cursor: String?
  public var error: String?
}

/// What `sweepInbound` or `sweepOutbound` read, and the oldest event time seen.
public struct SweepEventsResult: Codable, Hashable, Sendable {
  public var events: [EngagementEvent]
  public var fetched: Int
  public var reachedMs: Double?
  public var complete: Bool
  public var truncated: Bool
  public var aborted: Bool
  public var error: String?
}

/// A sweep's progress: rows so far, and for a newest-first walk how far
/// back it has reached (and for the outbound walk, which collection).
public struct SweepProgress: Codable, Hashable, Sendable {
  public var fetched: Int
  public var reachedMs: Double?
  public var part: Int?
  public var parts: Int?

  public init(fetched: Int, reachedMs: Double? = nil, part: Int? = nil, parts: Int? = nil) {
    self.fetched = fetched
    self.reachedMs = reachedMs
    self.part = part
    self.parts = parts
  }
}

/// `onPage`'s second argument in sweepPosts: the cursor that resumes after
/// the page (nil on the last).
public struct SweepPageInfo: Codable, Hashable, Sendable {
  public var cursor: String?
}

public enum AnalyticsSync {
  /// Page size everywhere: the API maximum.
  static let page = 100

  /// Hard page caps, so no sweep runs unbounded.
  public static let caps = (followers: 1000, following: 100, blocks: 200, posts: 500, inbound: 80, outboundPerKind: 120)

  /// One polite second ask, after 800 ms, then the truth.
  static func withRetry<T>(clock: NetworkClock, _ fn: () async throws -> T) async throws -> T {
    do {
      return try await fn()
    } catch {
      if Task.isCancelled { throw error }
      await clock.sleep(800)
      return try await fn()
    }
  }

  /// A request through the account's agent, which the web makes without
  /// the sweep's AbortSignal (only fetch and Constellation are handed it):
  /// calling the sweep off doesn't stop a request already out, which is
  /// answered and its page kept, and the sweep stops before the next one.
  /// A Swift request would be cancelled with its task and fail, so it runs
  /// in a task of its own.
  static func unaborted<T: Sendable>(_ fn: @escaping @Sendable () async throws -> T) async throws -> T {
    try await Task { try await fn() }.value
  }

  /// `err?.message || String(err)`.
  static func message(_ error: any Error) -> String {
    jsMessage(error)
  }

  /// `/could not locate|not found/i.test(message)`.
  static func isMissingCollection(_ message: String) -> Bool {
    let lower = String(String.UnicodeScalarView(message.unicodeScalars.map { scalar in
      (0x41...0x5A).contains(scalar.value) ? Unicode.Scalar(scalar.value + 32)! : scalar
    }))
    return lower.utf16.containsSubsequence(Array("could not locate".utf16))
      || lower.utf16.containsSubsequence(Array("not found".utf16))
  }

  // MARK: - Followers

  /// Sweep every current follower: always the full set, since only a full
  /// set can see an unfollow.
  public static func sweepFollowers(
    agent: XRPCAgent, did: String, clock: NetworkClock = HTTP.clock,
    onProgress: (@Sendable (SweepProgress) async -> Void)? = nil
  ) async -> SweepFollowersResult {
    var followers: [FollowerRow] = []
    var cursor: String?
    var error: String?
    var complete = false
    for _ in 0..<caps.followers {
      if Task.isCancelled { return SweepFollowersResult(followers: followers, complete: false, aborted: true, error: nil) }
      let res: XRPCResponse
      do {
        let asked = cursor
        res = try await withRetry(clock: clock) {
          try await unaborted {
            try await agent.query(
              "app.bsky.graph.getFollowers", ["actor": .string(did), "limit": .integer(page), "cursor": asked.map(XRPCParamValue.string)])
          }
        }
      } catch let err {
        error = message(err)
        break
      }
      let batch = res.data["followers"]?.arrayValue ?? []
      for f in batch {
        guard let fdid = f["did"]?.stringValue, !fdid.isEmpty else { continue }
        followers.append(
          FollowerRow(
            did: fdid, handle: truthyString(f["handle"]) ?? "", displayName: truthyString(f["displayName"]) ?? "",
            avatar: truthyString(f["avatar"]) ?? "",
            followedAt: Atproto.tidToTimestamp(Atproto.rkeyFromAtUri(f["viewer"]?["followedBy"]?.stringValue))))
      }
      await onProgress?(SweepProgress(fetched: followers.count))
      cursor = truthyString(res.data["cursor"])
      if cursor == nil || batch.isEmpty {
        complete = true
        break
      }
    }
    if !complete && error == nil { error = "more followers than the sweep reads" }
    return SweepFollowersResult(followers: followers, complete: complete, aborted: false, error: error)
  }

  /// A non-empty string, or nil (`x || ''` for the strings the web reads).
  static func truthyString(_ value: JSONValue?) -> String? {
    guard let text = value?.stringValue, !text.isEmpty else { return nil }
    return text
  }

  // MARK: - Following

  static let follow = "app.bsky.graph.follow"

  /// One of the account's follow records → `{ uri, did, followedAt }`,
  /// dated by its record key's TID, else its createdAt.
  public static func followFromRecord(_ record: JSONValue?) -> FollowingRow? {
    guard let uri = record?["uri"]?.stringValue, !uri.isEmpty,
      let did = record?["value"]?["subject"]?.stringValue, did.jsStartsWithUnits("did:")
    else { return nil }
    let followedAt =
      Atproto.tidToTimestamp(Atproto.rkeyFromAtUri(uri)) ?? truthyString(record?["value"]?["createdAt"])
    return FollowingRow(uri: uri, did: did, followedAt: followedAt)
  }

  /// Sweep every account the account follows, from its own repo.
  public static func sweepFollowing(
    agent: XRPCAgent, did: String, clock: NetworkClock = HTTP.clock,
    onProgress: (@Sendable (SweepProgress) async -> Void)? = nil
  ) async -> SweepFollowingResult {
    var following: [FollowingRow] = []
    var cursor: String?
    for _ in 0..<caps.following {
      if Task.isCancelled { return SweepFollowingResult(following: following, complete: false, aborted: true, error: nil) }
      let res: XRPCResponse
      do {
        let asked = cursor
        res = try await withRetry(clock: clock) {
          try await unaborted {
            try await agent.query(
              "com.atproto.repo.listRecords",
              ["repo": .string(did), "collection": .string(follow), "limit": .integer(page), "cursor": asked.map(XRPCParamValue.string)])
          }
        }
      } catch let err {
        if Task.isCancelled { return SweepFollowingResult(following: following, complete: false, aborted: true, error: nil) }
        // A repo that has never followed anyone has no such collection.
        if isMissingCollection(message(err)) {
          return SweepFollowingResult(following: following, complete: true, aborted: false, error: nil)
        }
        return SweepFollowingResult(following: following, complete: false, aborted: false, error: message(err))
      }
      let batch = res.data["records"]?.arrayValue ?? []
      for record in batch {
        if let row = followFromRecord(record) { following.append(row) }
      }
      await onProgress?(SweepProgress(fetched: following.count))
      cursor = truthyString(res.data["cursor"])
      if cursor == nil || batch.isEmpty {
        return SweepFollowingResult(following: following, complete: true, aborted: false, error: nil)
      }
    }
    return SweepFollowingResult(following: following, complete: false, aborted: false, error: "more follows than the sweep reads")
  }

  // MARK: - Blocks

  static let tooManyBlocks = "more block records than the sweep reads"
  static let blockSource = "app.bsky.graph.block:subject"
  static let listMemberSource = "app.bsky.graph.listitem:subject"
  static let listBlockSource = "app.bsky.graph.listblock:subject"

  /// One backlink walk's outcome.
  struct Walk<Item> {
    var items: [Item]
    var complete = false
    var truncated = false
    var aborted = false
    var error: String?
  }

  /// Sweep every current direct block and moderation-list block path
  /// pointing at `did`, through Constellation. Progress names its stage:
  /// direct (rows read), lists (memberships read), check (lists checked of
  /// all), subscribers (moderation lists walked of all); `fetched` is the
  /// block paths found so far.
  public static func sweepBlocks(
    did: String, transport: any HTTPTransport = HTTP.transport, clock: NetworkClock = HTTP.clock,
    timeZone: TimeZone = AppLocale.activeTimeZone(),
    onProgress: (@Sendable (BlocksProgress) async -> Void)? = nil
  ) async -> SweepBlocksResult {
    var blocks: [BlockRow] = []
    var listOrder: [JSKey] = []
    var listInfo: [JSKey: ListInfo] = [:]
    var seen = Set<JSKey>()

    func result(complete: Bool = false, truncated: Bool = false, aborted: Bool = false, error: String? = nil) -> SweepBlocksResult {
      SweepBlocksResult(
        blocks: blocks, lists: listOrder.compactMap { listInfo[$0] }, complete: complete, truncated: truncated,
        aborted: aborted, error: error)
    }

    let direct = await backlinkSweep(did, blockSource, transport: transport, clock: clock) { rows in
      await onProgress?(BlocksProgress(stage: "direct", fetched: rows, done: rows))
    }
    if direct.aborted { return result(aborted: true) }
    if let error = direct.error { return result(error: error) }
    if direct.truncated { return result(truncated: true, error: tooManyBlocks) }

    for row in direct.items {
      guard let rowDid = truthyString(row["did"]), let rkey = truthyString(row["rkey"]) else { continue }
      let uri = "at://\(rowDid)/\(truthyString(row["collection"]) ?? "app.bsky.graph.block")/\(rkey)"
      guard seen.insert(JSKey(uri)).inserted else { continue }
      blocks.append(BlockRow(uri: uri, did: rowDid, source: "direct", blockedAt: Atproto.tidToTimestamp(rkey)))
    }
    let directPaths = blocks.count
    await onProgress?(BlocksProgress(stage: "lists", fetched: directPaths, done: 0))

    let memberships = await manyToManySweep(did, listMemberSource, "list", transport: transport, clock: clock) { items in
      await onProgress?(BlocksProgress(stage: "lists", fetched: directPaths, done: items))
    }
    if memberships.aborted { return result(aborted: true) }
    if let error = memberships.error { return result(error: error) }
    if memberships.truncated { return result(truncated: true, error: tooManyBlocks) }

    // Each list once, with the earliest date the account was added.
    var lists: [(listUri: String, memberAt: String?)] = []
    var listIndex: [JSKey: Int] = [:]
    for item in memberships.items {
      guard let rkey = truthyString(item["linkRecord"]?["rkey"]), let listUri = truthyString(item["otherSubject"]) else {
        continue
      }
      let memberAt = Atproto.tidToTimestamp(rkey)
      if let i = listIndex[JSKey(listUri)] {
        if earlier(memberAt, lists[i].memberAt, timeZone: timeZone) { lists[i].memberAt = memberAt }
      } else {
        listIndex[JSKey(listUri)] = lists.count
        lists.append((listUri, memberAt))
      }
    }

    // Only moderation lists make list blocks: read each list record from
    // the public AppView, eight at a time.
    var checked = 0
    await onProgress?(BlocksProgress(stage: "check", fetched: directPaths, done: 0, total: lists.count))
    // What each list is, for Lists you're on, in the order the lists were
    // asked for (the order the web's answers land in when they come back as
    // fast as they're asked).
    var records: [Int: JSONValue?] = [:]
    var moderationLists: [(listUri: String, memberAt: String?)] = []
    func keepListInfo() {
      for (index, list) in lists.enumerated() {
        guard let found = records[index], let record = found, record.isTruthy, let parts = listUriParts(list.listUri) else {
          continue
        }
        let purpose = record["purpose"]?.stringValue
        if purpose == "app.bsky.graph.defs#modlist" { moderationLists.append(list) }
        let key = JSKey(list.listUri)
        if listInfo[key] == nil { listOrder.append(key) }
        listInfo[key] = ListInfo(
          uri: list.listUri, owner: parts.did, name: record["name"]?.stringValue?.jsSlice(0, 120) ?? "",
          purpose: purpose == "app.bsky.graph.defs#modlist"
            ? "moderation" : purpose == "app.bsky.graph.defs#referencelist" ? "reference" : "curation",
          memberAt: list.memberAt.flatMap { $0.isEmpty ? nil : $0 }, subscribers: nil)
      }
    }
    do {
      try await withThrowingTaskGroup(of: (Int, JSONValue?).self) { group in
        var next = 0
        func start() {
          guard next < lists.count else { return }
          let index = next
          let listUri = lists[index].listUri
          next += 1
          group.addTask {
            guard let parts = listUriParts(listUri) else { return (index, nil) }
            return (index, try await getPublicRecord(parts.did, parts.collection, parts.rkey, transport: transport, clock: clock))
          }
        }
        for _ in 0..<min(8, lists.count) { start() }
        while let (index, record) = try await group.next() {
          records[index] = .some(record)
          checked += 1
          await onProgress?(BlocksProgress(stage: "check", fetched: directPaths, done: checked, total: lists.count))
          start()
        }
      }
    } catch {
      if Task.isCancelled { return result(aborted: true) }
      keepListInfo()
      return result(error: message(error))
    }
    keepListInfo()

    // The long stage: one moderation list at a time, a pause before each,
    // keeping under the public Constellation instance's rate limit.
    var walked = 0
    var listPaths = 0
    await onProgress?(BlocksProgress(stage: "subscribers", fetched: directPaths, done: 0, total: moderationLists.count))
    var subscriptions: [(listUri: String, memberAt: String?, walk: Walk<JSONValue>)] = []
    for list in moderationLists {
      if !Task.isCancelled { await clock.sleep(250) }
      let walk = await backlinkSweep(list.listUri, listBlockSource, transport: transport, clock: clock, onRows: nil)
      walked += 1
      listPaths += walk.items.count
      await onProgress?(
        BlocksProgress(stage: "subscribers", fetched: directPaths + listPaths, done: walked, total: moderationLists.count))
      subscriptions.append((list.listUri, list.memberAt, walk))
    }

    for (listUri, memberAt, walk) in subscriptions {
      if walk.aborted { return result(aborted: true) }
      if let error = walk.error { return result(error: error) }
      if walk.truncated { return result(truncated: true, error: tooManyBlocks) }
      listInfo[JSKey(listUri)]?.subscribers = walk.items.count
      for row in walk.items {
        guard let rowDid = truthyString(row["did"]), let rkey = truthyString(row["rkey"]) else { continue }
        let recordUri = "at://\(rowDid)/\(truthyString(row["collection"]) ?? "app.bsky.graph.listblock")/\(rkey)"
        let uri = "list:\(listUri):\(recordUri)"
        guard seen.insert(JSKey(uri)).inserted else { continue }
        blocks.append(
          BlockRow(
            uri: uri, did: rowDid, source: "list", listUri: listUri,
            blockedAt: effectiveBlockDate(memberAt, Atproto.tidToTimestamp(rkey), timeZone: timeZone)))
      }
    }
    return result(complete: true)
  }

  /// Every backlink to `target` from `source`, page by page.
  static func backlinkSweep(
    _ target: String, _ source: String, transport: any HTTPTransport, clock: NetworkClock,
    onRows: (@Sendable (Int) async -> Void)?
  ) async -> Walk<JSONValue> {
    var rows: [JSONValue] = []
    var cursor: String?
    for _ in 0..<caps.blocks {
      if Task.isCancelled { return Walk(items: rows, aborted: true) }
      let page = await Constellation.getBacklinks(target, source, limit: AnalyticsSync.page, cursor: cursor, transport: transport, clock: clock)
      if Task.isCancelled { return Walk(items: rows, aborted: true) }
      guard let page, page.isTruthy else { return Walk(items: rows, error: "Constellation backlinks unavailable") }
      let batch = Constellation.backlinkRows(page).arrayValue ?? []
      rows.append(contentsOf: batch)
      await onRows?(rows.count)
      let next = truthyString(page["cursor"])
      guard let next, !batch.isEmpty else { return Walk(items: rows, complete: true) }
      if Optional(next).jsEquals(cursor) { return Walk(items: rows, error: "Constellation returned a repeated cursor") }
      cursor = next
    }
    return Walk(items: rows, truncated: true)
  }

  /// Every record linking `subject` through `source`, with the other
  /// subject `pathToOther` names, page by page.
  static func manyToManySweep(
    _ subject: String, _ source: String, _ pathToOther: String, transport: any HTTPTransport, clock: NetworkClock,
    onItems: (@Sendable (Int) async -> Void)?
  ) async -> Walk<JSONValue> {
    var items: [JSONValue] = []
    var cursor: String?
    for _ in 0..<caps.blocks {
      if Task.isCancelled { return Walk(items: items, aborted: true) }
      let page = await Constellation.getManyToMany(
        subject, source, pathToOther, limit: AnalyticsSync.page, cursor: cursor, transport: transport, clock: clock)
      if Task.isCancelled { return Walk(items: items, aborted: true) }
      guard let page, page.isTruthy else { return Walk(items: items, error: "Constellation list membership join unavailable") }
      let batch = page["items"]?.arrayValue ?? []
      items.append(contentsOf: batch)
      await onItems?(items.count)
      let next = truthyString(page["cursor"])
      guard let next, !batch.isEmpty else { return Walk(items: items, complete: true) }
      if Optional(next).jsEquals(cursor) { return Walk(items: items, error: "Constellation returned a repeated cursor") }
      cursor = next
    }
    return Walk(items: items, truncated: true)
  }

  /// A record read from the public AppView: its value, or nil for a record
  /// that is gone (400 RecordNotFound or 404). Any other failure throws.
  static func getPublicRecord(
    _ repo: String, _ collection: String, _ rkey: String, transport: any HTTPTransport, clock: NetworkClock
  ) async throws -> JSONValue? {
    let params = JSURI.searchParams([("repo", repo), ("collection", collection), ("rkey", rkey)])
    let url = "\(AppConfig.appview)/xrpc/com.atproto.repo.getRecord?\(params)"
    let response = try await withRetry(clock: clock) { try await transport.send(HTTPRequest(url: url)) }
    if response.status == 400 || response.status == 404 { return nil }
    if !response.ok { throw AnalyticsSyncError(message: "HTTP \(response.status) while reading moderation-list record") }
    let body = try response.json()
    return body["value"].truthy
  }

  /// `/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/`.
  static func listUriParts(_ uri: String) -> (did: String, collection: String, rkey: String)? {
    let units = Array(uri.utf16)
    let prefix = Array("at://".utf16)
    guard units.count > prefix.count, Array(units[0..<prefix.count]) == prefix else { return nil }
    var i = prefix.count
    func segment(stop: (UInt16) -> Bool) -> String? {
      let start = i
      while i < units.count, !stop(units[i]) { i += 1 }
      return i > start ? String(jsUnits: units[start..<i]) : nil
    }
    guard let did = segment(stop: { $0 == 0x2F }), i < units.count else { return nil }
    i += 1
    guard let collection = segment(stop: { $0 == 0x2F }), i < units.count else { return nil }
    i += 1
    guard let rkey = segment(stop: { $0 == 0x2F || $0 == 0x3F || $0 == 0x23 }) else { return nil }
    return (did, collection, rkey)
  }

  /// The later of the membership and the subscription: a list block exists
  /// only once both do.
  static func effectiveBlockDate(_ memberAt: String?, _ subscribedAt: String?, timeZone: TimeZone) -> String? {
    let memberMs = JSDate.parse(memberAt.flatMap { $0.isEmpty ? nil : $0 } ?? "", timeZone: timeZone)
    let subscribedMs = JSDate.parse(subscribedAt.flatMap { $0.isEmpty ? nil : $0 } ?? "", timeZone: timeZone)
    guard memberMs.isFinite, subscribedMs.isFinite else { return nil }
    return JSDate.toISOString(max(memberMs, subscribedMs))
  }

  static func earlier(_ a: String?, _ b: String?, timeZone: TimeZone) -> Bool {
    let aMs = JSDate.parse(a.flatMap { $0.isEmpty ? nil : $0 } ?? "", timeZone: timeZone)
    let bMs = JSDate.parse(b.flatMap { $0.isEmpty ? nil : $0 } ?? "", timeZone: timeZone)
    return aMs.isFinite && (!bMs.isFinite || aMs < bMs)
  }

  // MARK: - Posts

  /// Sweep the author feed into archive rows, newest first: to the end with
  /// no known URIs (a build, resumable from `resumeCursor`), or, topping up,
  /// until a page whose own posts are all known and older than
  /// `rehydrateSinceMs` (recent posts are handed over again so their counts
  /// refresh).
  public static func sweepPosts(
    did: String, knownUris: Set<JSKey>? = nil, rehydrateSinceMs: Double = .infinity, resumeCursor: String? = nil,
    transport: any HTTPTransport = HTTP.transport, clock: NetworkClock = HTTP.clock,
    timeZone: TimeZone = AppLocale.activeTimeZone(),
    onPage: (@Sendable ([PostRow], SweepPageInfo) async -> Void)? = nil,
    onProgress: (@Sendable (SweepProgress) async -> Void)? = nil
  ) async -> SweepPostsResult {
    var cursor = resumeCursor.flatMap { $0.isEmpty ? nil : $0 }
    var fetched = 0
    var reachedMs: Double?
    for _ in 0..<caps.posts {
      if Task.isCancelled { return SweepPostsResult(fetched: fetched, complete: false, aborted: true, cursor: cursor, error: nil) }
      var pairs = [("actor", did), ("limit", String(page)), ("filter", "posts_with_replies")]
      if let cursor { pairs.append(("cursor", cursor)) }
      let url = "\(AppConfig.appview)/xrpc/app.bsky.feed.getAuthorFeed?\(JSURI.searchParams(pairs))"
      let res: JSONValue
      do {
        res = try await withRetry(clock: clock) {
          let r = try await transport.send(HTTPRequest(url: url))
          if !r.ok { throw AnalyticsSyncError(message: "HTTP \(r.status) from getAuthorFeed") }
          return try r.json()
        }
      } catch {
        if Task.isCancelled { return SweepPostsResult(fetched: fetched, complete: false, aborted: true, cursor: cursor, error: nil) }
        return SweepPostsResult(fetched: fetched, complete: false, aborted: false, cursor: cursor, error: message(error))
      }

      let feed = res["feed"]?.arrayValue ?? []
      var rows: [PostRow] = []
      var sawNew = false
      var oldestOwnMs = Double.infinity
      for item in feed {
        guard let row = Analytics.compactPostFromFeedItem(item, timeZone: timeZone) else { continue }
        rows.append(row)
        let at = JSDate.parse(row.at ?? "", timeZone: timeZone)
        if at.isFinite && at < oldestOwnMs { oldestOwnMs = at }
        if !(knownUris?.contains(JSKey(row.uri)) ?? false) { sawNew = true }
      }
      fetched += rows.count
      if oldestOwnMs.isFinite && (reachedMs == nil || oldestOwnMs < reachedMs!) { reachedMs = oldestOwnMs }
      let next = truthyString(res["cursor"])
      if !rows.isEmpty { await onPage?(rows, SweepPageInfo(cursor: next)) }
      await onProgress?(SweepProgress(fetched: fetched, reachedMs: reachedMs))

      let done = next == nil || feed.isEmpty || (!sawNew && !rows.isEmpty && oldestOwnMs < rehydrateSinceMs)
      if done { return SweepPostsResult(fetched: fetched, complete: true, aborted: false, cursor: nil, error: nil) }
      cursor = next
    }
    return SweepPostsResult(fetched: fetched, complete: false, aborted: false, cursor: cursor, error: nil)
  }

  // MARK: - Inbound

  /// Sweep notifications back to `cutoffMs`, banking engagement events. A
  /// page of known events ends the sweep only when an earlier sweep already
  /// reached the cutoff (`coveredToMs`).
  public static func sweepInbound(
    agent: XRPCAgent, cutoffMs: Double, knownUris: Set<JSKey>? = nil, coveredToMs: Double? = nil,
    clock: NetworkClock = HTTP.clock, timeZone: TimeZone = AppLocale.activeTimeZone(),
    onPage: (@Sendable ([EngagementEvent]) async -> Void)? = nil,
    onProgress: (@Sendable (SweepProgress) async -> Void)? = nil
  ) async -> SweepEventsResult {
    var events: [EngagementEvent] = []
    var cursor: String?
    var reachedMs: Double?
    var positionMs: Double?
    let covered = coveredToMs.map { $0 <= cutoffMs } ?? false
    func result(complete: Bool = false, truncated: Bool = false, aborted: Bool = false, error: String? = nil) -> SweepEventsResult {
      SweepEventsResult(
        events: events, fetched: events.count, reachedMs: reachedMs, complete: complete, truncated: truncated, aborted: aborted,
        error: error)
    }
    for _ in 0..<caps.inbound {
      if Task.isCancelled { return result(aborted: true) }
      let res: XRPCResponse
      do {
        let asked = cursor
        res = try await withRetry(clock: clock) {
          try await unaborted {
            try await agent.query(
              "app.bsky.notification.listNotifications", ["limit": .integer(page), "cursor": asked.map(XRPCParamValue.string)])
          }
        }
      } catch {
        return result(error: message(error))
      }
      let batch = res.data["notifications"]?.arrayValue ?? []
      var rows: [EngagementEvent] = []
      var sawNew = false
      var pageOldest = Double.infinity
      for n in batch {
        // The stop test reads indexedAt on every notification: the feed's
        // own position, which a backdated createdAt can't move.
        let idx = JSDate.parse(truthyString(n["indexedAt"]) ?? "", timeZone: timeZone)
        if idx.isFinite && idx < pageOldest { pageOldest = idx }
        guard let ev = Analytics.inboundFromNotification(n, timeZone: timeZone) else { continue }
        let at = JSDate.toMs(ev.at, timeZone: timeZone)
        if at.isFinite && (reachedMs == nil || at < reachedMs!) { reachedMs = at }
        if !at.isFinite || at < cutoffMs { continue }
        if !(knownUris?.contains(JSKey(ev.uri)) ?? false) { sawNew = true }
        rows.append(ev)
      }
      events.append(contentsOf: rows)
      if pageOldest.isFinite && (positionMs == nil || pageOldest < positionMs!) { positionMs = pageOldest }
      if !rows.isEmpty { await onPage?(rows) }
      await onProgress?(SweepProgress(fetched: events.count, reachedMs: positionMs))

      let next = truthyString(res.data["cursor"])
      if next == nil || batch.isEmpty { return result(complete: true) }
      if pageOldest < cutoffMs { return result(complete: true) }
      if !sawNew && !rows.isEmpty && covered { return result(complete: true) }
      cursor = next
    }
    return result(truncated: true)
  }

  // MARK: - Outbound

  static let outboundCollections = [("app.bsky.feed.like", "like"), ("app.bsky.feed.repost", "repost")]

  /// Sweep the account's like and repost records back to `cutoffMs`, as
  /// sweepInbound; the stop test reads the record key's TID, the order the
  /// collection pages in.
  public static func sweepOutbound(
    agent: XRPCAgent, did: String, cutoffMs: Double, knownUris: Set<JSKey>? = nil, coveredToMs: Double? = nil,
    clock: NetworkClock = HTTP.clock, timeZone: TimeZone = AppLocale.activeTimeZone(),
    onPage: (@Sendable ([EngagementEvent]) async -> Void)? = nil,
    onProgress: (@Sendable (SweepProgress) async -> Void)? = nil
  ) async -> SweepEventsResult {
    var events: [EngagementEvent] = []
    var reachedMs: Double?
    var error: String?
    var truncated = false
    var complete = true
    let covered = coveredToMs.map { $0 <= cutoffMs } ?? false

    for (part, (collection, kind)) in outboundCollections.enumerated() {
      var cursor: String?
      var finished = false
      var positionMs: Double?
      for _ in 0..<caps.outboundPerKind {
        if Task.isCancelled {
          return SweepEventsResult(
            events: events, fetched: events.count, reachedMs: reachedMs, complete: false, truncated: truncated, aborted: true,
            error: error)
        }
        let res: XRPCResponse
        do {
          let asked = cursor
          res = try await withRetry(clock: clock) {
            try await unaborted {
              try await agent.query(
                "com.atproto.repo.listRecords",
                ["repo": .string(did), "collection": .string(collection), "limit": .integer(page), "cursor": asked.map(XRPCParamValue.string)])
            }
          }
        } catch let err {
          // A missing collection is an empty archive, not a failure.
          if isMissingCollection(message(err)) {
            finished = true
            break
          }
          error = message(err)
          break
        }
        let batch = res.data["records"]?.arrayValue ?? []
        var rows: [EngagementEvent] = []
        var sawNew = false
        var pageOldestTid = Double.infinity
        for record in batch {
          let tid = JSDate.parse(
            Atproto.tidToTimestamp(Atproto.rkeyFromAtUri(record["uri"]?.stringValue)) ?? "", timeZone: timeZone)
          if tid.isFinite && tid < pageOldestTid { pageOldestTid = tid }
          guard let ev = Analytics.outboundFromRecord(kind, record, timeZone: timeZone) else { continue }
          let at = JSDate.toMs(ev.at, timeZone: timeZone)
          if at.isFinite && (reachedMs == nil || at < reachedMs!) { reachedMs = at }
          if at.isFinite && at < cutoffMs { continue }
          if !(knownUris?.contains(JSKey(ev.uri)) ?? false) { sawNew = true }
          rows.append(ev)
        }
        events.append(contentsOf: rows)
        if pageOldestTid.isFinite && (positionMs == nil || pageOldestTid < positionMs!) { positionMs = pageOldestTid }
        if !rows.isEmpty { await onPage?(rows) }
        await onProgress?(SweepProgress(fetched: events.count, reachedMs: positionMs, part: part, parts: outboundCollections.count))

        let next = truthyString(res.data["cursor"])
        if next == nil || batch.isEmpty || pageOldestTid < cutoffMs || (!sawNew && !rows.isEmpty && covered) {
          finished = true
          break
        }
        cursor = next
      }
      if !finished {
        if error != nil { break }
        truncated = true
      }
      complete = complete && finished
    }
    return SweepEventsResult(
      events: events, fetched: events.count, reachedMs: reachedMs, complete: complete, truncated: truncated, aborted: false,
      error: error)
  }

  // MARK: - Actor cards

  /// Actor cards older than this are resolved again.
  public static let actorTtlMs: Double = 7 * 86_400_000

  /// Profile cards for the DIDs that have none, or a stale one, from the
  /// public AppView (resolveProfiles). Unresolved DIDs are simply absent.
  /// Returns only the newly resolved cards, for the caller to keep.
  public static func hydrateActors(
    _ dids: [String?]?, cache: [JSKey: ActorCard], now: Double, transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock
  ) async -> [ActorCard] {
    var seen = Set<JSKey?>()
    var missing: [String?] = []
    for did in dids ?? [] {
      let key = did.map(JSKey.init)
      guard seen.insert(key).inserted else { continue }
      let hit = key.flatMap { cache[$0] }
      let stale = hit.map { hit in hit.handle.map(\.isEmpty) ?? true || now - (hit.at ?? 0) > actorTtlMs } ?? true
      if stale { missing.append(did) }
    }
    if missing.isEmpty { return [] }
    let profiles = await Atproto.resolveProfiles(missing, transport: transport, clock: clock)
    return profiles.entries.map { entry in
      ActorCard(
        did: entry.did, handle: entry.profile.handle, displayName: entry.profile.displayName, avatar: entry.profile.avatar,
        at: now)
    }
  }
}

/// A sweep's own failure, with the web's message.
public struct AnalyticsSyncError: Error, LocalizedError, Hashable, Sendable {
  public var message: String
  public var errorDescription: String? { message }
}

extension String.UTF16View {
  func containsSubsequence(_ needle: [UInt16]) -> Bool {
    let hay = Array(self)
    guard needle.count <= hay.count else { return needle.isEmpty }
    if needle.isEmpty { return true }
    for start in 0...(hay.count - needle.count) where hay[start] == needle[0] {
      if Array(hay[start..<(start + needle.count)]) == needle { return true }
    }
    return false
  }
}
