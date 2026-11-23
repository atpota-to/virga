// Ports src/archive/useAnalyticsArchive.js
//
// The archive: everything Virga knows about the signed-in account, held in
// the account's own store (AnalyticsStore over a FileStore), and the sync
// that fills it (the sweeps, the repo CAR) with its progress. One model per
// signed-in account, shared with every page (ArchiveContext's job; VirgaUI
// passes the model through the SwiftUI environment).
//
// Its dependencies come in at init: the account (DID, handle) and its agent,
// the file store, the transport for public reads, a clock, the zone and
// locale the words are written in, and where to hear of posts made or
// deleted (VirgaPosting's posting events, which this target can't import).
// The view calls `start()` when it appears (the hook's mount: open the
// store, read it, pick up an unfinished build or a stale archive) and
// `stop()` when it goes.

import Foundation
import Observation
import VirgaCore
import VirgaNetwork
import VirgaRepo

/// The sync bar while a sync runs: the steps it plans, those finished or
/// failed, and the one under way with its own measured share (nil when
/// there is nothing to measure by).
public struct SyncState: Codable, Hashable, Sendable {
  public var plan: [String]
  public var done: [String]
  public var failed: [String]
  public var step: String?
  public var fraction: Double?
  public var detail: String
  public var doing: String?

  public init(plan: [String], done: [String], failed: [String], step: String?, fraction: Double?, detail: String, doing: String?) {
    self.plan = plan
    self.done = done
    self.failed = failed
    self.step = step
    self.fraction = fraction
    self.detail = detail
    self.doing = doing
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(plan, forKey: .plan)
    try c.encode(done, forKey: .done)
    try c.encode(failed, forKey: .failed)
    try c.encode(step, forKey: .step)
    try c.encode(fraction, forKey: .fraction)
    try c.encode(detail, forKey: .detail)
    try c.encode(doing, forKey: .doing)
  }
}

/// `runSync`'s mode.
public enum SyncMode: String, Codable, Hashable, Sendable {
  /// Top up posts, refresh followers, deepen events.
  case incremental
  /// Clear the post archive and rebuild it from page one.
  case full
  /// Continue an interrupted build from its cursor.
  case resume
}

/// Where the archive hears of posts this account made or deleted: given
/// the DID and a handler for each event's detail (`{ did, added: [{ uri,
/// cid, record }], removed: [uri] }`), it starts listening and returns
/// what stops it. The app wires VirgaPosting's
/// `PostingEvents.onPostingEvent(PostingEvents.postsChangedEvent, did:, _:)`.
public typealias PostsChangedListener =
  @Sendable (_ did: String, _ onChange: @escaping @Sendable (JSONValue) -> Void) -> (@Sendable () -> Void)

/// What the archive needs from outside, passed to init.
public struct ArchiveEnvironment: Sendable {
  /// The file store the archive lives in (nil: memory only, for the session).
  public var files: (any FileStore)?
  /// The memoized store handles (the app's shared one).
  public var registry: AnalyticsStoreRegistry
  /// Public reads: the AppView, the PDS's repo export, Constellation, PLC.
  public var transport: any HTTPTransport
  /// The time (`Date.now()`) and the waits between retries.
  public var clock: NetworkClock
  /// The DID documents read so far (atproto.js's cache).
  public var didDocuments: PromiseCache<JSONValue>
  /// Where local days fall, and the words' locale. A nil zone is the
  /// active one (AppLocale's: the device's), read each time it is needed,
  /// as the web reads the browser's: an environment made before the app
  /// set it (at launch it is still UTC) or kept while the device changes
  /// zone doesn't hold on to a zone that is no longer the device's.
  public var timeZone: TimeZone?
  public var locale: String?
  /// Posts made or deleted elsewhere in the app.
  public var postsChanged: PostsChangedListener?

  public init(
    files: (any FileStore)?, registry: AnalyticsStoreRegistry = .shared, transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock, didDocuments: PromiseCache<JSONValue> = Atproto.didDocumentCache,
    timeZone: TimeZone? = nil, locale: String? = nil, postsChanged: PostsChangedListener? = nil
  ) {
    self.files = files
    self.registry = registry
    self.transport = transport
    self.clock = clock
    self.didDocuments = didDocuments
    self.timeZone = timeZone
    self.locale = locale
    self.postsChanged = postsChanged
  }
}

@MainActor @Observable
public final class ArchiveModel {
  /// Sweeps re-run quietly when the archive is older than this.
  public static let autoSyncAfterMs: Double = 60 * 60 * 1000
  /// Recent posts get their counts refreshed on every sync.
  public static let rehydrateDays: Double = 30
  /// How far back the event sweeps ever dig.
  public static let eventDepthDays: Double = 365
  static let dayMs: Double = 86_400_000
  static let follow = "app.bsky.graph.follow"
  /// Every store in an account's database, for "Delete this archive".
  public static let archiveStores = ["posts", "followers", "following", "blocks", "inbound", "outbound", "atmosphere", "actors", "meta"]

  /// The account.
  public let did: String
  /// The account's handle, for the exports: the app sets it again when the
  /// profile's fresh read arrives (the hook takes it on every render).
  public var handle: String?
  /// The account's signed-in agent (nil: nothing to sync with).
  public let agent: XRPCAgent?
  let env: ArchiveEnvironment

  /// The archive as read from the store (EMPTY until then).
  public private(set) var data = ArchiveData.empty
  /// Profile cards for the People lists, in the order first read.
  public private(set) var actors = ActorCards()
  /// While a sync runs, the bar; nil otherwise.
  public private(set) var sync: SyncState?
  /// What the last sync couldn't do, step by step, or nil.
  public private(set) var syncError: String?
  /// "Now" for the charts, one per change of data (ArchiveContext's
  /// `nowMs`, `useMemo(() => Date.now(), [archive.rev])`), so every chart
  /// on a screen agrees where its window ends: the time the model was made,
  /// then the time of each change of `data.rev`.
  public private(set) var nowMs: Double

  @ObservationIgnored var store: (any AnalyticsStoreHandle)?
  @ObservationIgnored var syncTask: Task<Void, Never>?
  @ObservationIgnored var autoRan = false
  @ObservationIgnored var attemptedActors = Set<JSKey>()
  @ObservationIgnored var stopListening: (@Sendable () -> Void)?
  /// Moves on every stop(): a mount whose store opens after it was
  /// stopped does nothing more (the effect's `cancelled` flag), and one
  /// stopped while it reads the store neither listens nor syncs.
  @ObservationIgnored var mounts = 0
  /// The first read of the store while it runs, so a mount made during it
  /// (after another was stopped part way) waits for the data rather than
  /// finding the store open and nothing read.
  @ObservationIgnored var reading: Task<Void, Never>?
  /// Hears every change of `sync` (tests read the bar's whole history).
  @ObservationIgnored var syncObserver: ((SyncState?) -> Void)?

  public init(agent: XRPCAgent?, did: String, handle: String?, environment: ArchiveEnvironment) {
    self.agent = agent
    self.did = did
    self.handle = handle
    env = environment
    nowMs = environment.clock.now()
  }

  // MARK: - Reading

  /// Whether the archive has anything to chart yet (ArchiveContext's isBuilt).
  public var isBuilt: Bool { ArchiveContext.isBuilt(data) }

  /// Whether a sync is under way.
  public var isSyncing: Bool { syncTask != nil }

  var timeZone: TimeZone { env.timeZone ?? AppLocale.activeTimeZone() }
  var locale: String? { env.locale }
  func clockNow() -> Double { env.clock.now() }

  /// Every store and mark read back, as the hook's reload does.
  @discardableResult
  func reload(_ store: any AnalyticsStoreHandle) async -> ArchiveData {
    async let posts = store.all("posts")
    async let followers = store.all("followers")
    async let following = store.all("following")
    async let blocks = store.all("blocks")
    async let inbound = store.all("inbound")
    async let outbound = store.all("outbound")
    async let atmosphere = store.all("atmosphere")
    async let actorRows = store.all("actors")
    var metas: [String: JSONValue?] = [:]
    for key in ArchiveMeta.keys { metas[key] = await store.getMeta(key) }
    let rows = await (posts, followers, following, blocks, inbound, outbound, atmosphere, actorRows)
    actors = ActorCards(rows.7.compactMap(ActorCard.init(json:)))
    func meta(_ key: String) -> ArchiveMetaRecord? { ArchiveMetaRecord(json: metas[key] ?? nil) }
    let next = ArchiveData(
      loaded: true, persistent: store.persistent, blocked: store.blocked,
      posts: rows.0.compactMap(PostRow.init(json:)), followers: rows.1.compactMap(FollowerRow.init(json:)),
      following: rows.2.compactMap(FollowingRow.init(json:)), blocks: rows.3.compactMap(BlockRow.init(json:)),
      inbound: rows.4.compactMap(EngagementEvent.init(json:)), outbound: rows.5.compactMap(EngagementEvent.init(json:)),
      atmosphere: rows.6.compactMap(AtmosphereRow.init(json:)),
      meta: ArchiveMeta(
        posts: meta("posts"), followers: meta("followers"), following: meta("following"), blocks: meta("blocks"),
        inbound: meta("inbound"), outbound: meta("outbound"), repo: meta("repo"),
        followerLog: (metas["followerLog"] ?? nil).flatMap(FollowerLogRecord.init(json:)), lists: meta("lists"),
        read: true),
      rev: data.rev + 1, followRev: 0)
    setData(next)
    return next
  }

  func setData(_ next: ArchiveData) {
    let revChanged = next.rev != data.rev
    data = next
    if revChanged { nowMs = clockNow() }
  }

  // MARK: - Mount

  /// The hook's mount: open the store, read it, listen for posts made or
  /// deleted, and pick up an unfinished build or top up a stale archive
  /// (the first build is a button, never a surprise). Awaits that sync;
  /// cancelling the call calls it off.
  public func start() async {
    let mount = mounts
    if store == nil {
      let opened = await AnalyticsStore.openAnalyticsStore(did, files: env.files, registry: env.registry)
      if Task.isCancelled || mount != mounts { return }
      store = opened
      let read = Task { _ = await self.reload(opened) }
      reading = read
      await read.value
      if reading == read { reading = nil }
    } else if let reading {
      await reading.value
    }
    // Stopped while the store was read: on the web the listener and the
    // auto-sync are effects of the mounted component, and go with it. What
    // was read stays, for the next mount.
    if Task.isCancelled || mount != mounts { return }
    if stopListening == nil, let listen = env.postsChanged {
      stopListening = listen(did) { [weak self] detail in
        Task { @MainActor in
          let added = (detail["added"]?.arrayValue ?? []).map(PostedItem.init(json:))
          let removed = (detail["removed"]?.arrayValue ?? []).compactMap(\.stringValue)
          await self?.applyPosts(added: added, removed: removed)
        }
      }
    }
    await withTaskCancellationHandler {
      await autoSync()
    } onCancel: {
      Task { @MainActor in self.cancelSync() }
    }
  }

  /// The hook's unmount: call off a sync and stop listening.
  public func stop() {
    mounts += 1
    cancelSync()
    stopListening?()
    stopListening = nil
  }

  /// Pick incomplete builds back up, and top up a stale archive, quietly.
  func autoSync() async {
    guard data.loaded, agent != nil, !autoRan else { return }
    guard let pm = data.meta.posts else { return }
    autoRan = true
    // An interrupted build resumes at once, however fresh.
    if pm.complete != true {
      await runSync(.resume)
      return
    }
    // Archives from before the blocks store, moderation-list reach, the
    // follows the People tab marks, or the current post rows.
    if data.meta.blocks?.version != 2 || data.meta.following == nil || data.meta.lists == nil
      || pm.shape != Analytics.postRowVersion
    {
      await runSync(.incremental)
      return
    }
    let syncedAt = pm.syncedAt.flatMap { $0 == 0 || $0.isNaN ? nil : $0 } ?? 0
    if clockNow() - syncedAt < Self.autoSyncAfterMs { return }
    await runSync(.incremental)
  }

  /// Call off the sync under way.
  public func cancelSync() {
    syncTask?.cancel()
  }

  // MARK: - Sync

  /// The one sync entry point. Returns when the sync has finished (or was
  /// called off); does nothing while one runs, before the store is open, or
  /// with no agent.
  public func runSync(_ mode: SyncMode = .incremental) async {
    guard let store, agent != nil, syncTask == nil else { return }
    let task = Task { @MainActor in
      await self.performSync(mode, store: store)
    }
    syncTask = task
    await withTaskCancellationHandler {
      await task.value
    } onCancel: {
      task.cancel()
    }
  }

  func setSync(_ next: SyncState?) {
    sync = next
    syncObserver?(next)
  }

  func setSyncError(_ message: String?) {
    syncError = message
  }

  // MARK: - Follows

  /// Follow or unfollow one account: a follow record written to (or every
  /// one deleted from) the account's repo, then the archive's copy updated.
  /// Throws when the PDS refuses.
  public func setFollow(_ subject: String?, _ on: Bool) async throws {
    guard let agent, let store, let subject, !subject.isEmpty else { return }
    if on {
      let createdAt = JSDate.toISOString(clockNow()) ?? ""
      let res = try await agent.procedure(
        "com.atproto.repo.createRecord",
        input: .json([
          "repo": .string(did), "collection": .string(Self.follow),
          "record": ["$type": .string(Self.follow), "subject": .string(subject), "createdAt": .string(createdAt)],
        ]))
      guard let uri = res.data["uri"]?.stringValue, !uri.isEmpty else {
        throw AnalyticsSyncError(message: "the PDS did not return the follow record")
      }
      let row = FollowingRow(uri: uri, did: subject, followedAt: createdAt)
      await store.putAll("following", [row.json])
      var next = data
      next.following.append(row)
      next.followRev += 1
      data = next
      return
    }
    // Every record for this subject: a repo can hold more than one.
    let rows = data.following.filter { $0.did.jsEquals(subject) }
    for row in rows {
      if let rkey = Atproto.rkeyFromAtUri(row.uri) {
        _ = try await agent.procedure(
          "com.atproto.repo.deleteRecord",
          input: .json(["repo": .string(did), "collection": .string(Self.follow), "rkey": .string(rkey)]))
      }
    }
    await store.remove("following", rows.map { .string($0.uri) })
    var next = data
    next.following.removeAll { $0.did.jsEquals(subject) }
    next.followRev += 1
    data = next
  }

  // MARK: - Posts made and deleted

  /// Posts this account just made in Virga, added with zero counts so they
  /// show before the next sync fills the counts in. Nothing before the
  /// first build (it reads every post anyway).
  public func notePosted(_ posted: [PostedItem]) async {
    await applyPosts(added: posted, removed: [])
  }

  /// Posts this account deleted, taken out of the archive at once.
  public func noteDeleted(_ uris: [String]) async {
    await applyPosts(added: [], removed: uris)
  }

  func applyPosts(added: [PostedItem], removed: [String]) async {
    guard let store, data.meta.posts != nil else { return }
    let rows = PostChanges.postRowsFor(did, added, timeZone: timeZone)
    let gone = removed.filter { PostChanges.isOwnPostUri(did, $0) }
    if rows.isEmpty && gone.isEmpty { return }
    guard let posts = PostChanges.applyPostChanges(data.posts, rows: rows, removed: gone) else { return }
    // The rows as they now stand, with the counts the archive had.
    let fresh = Set(rows.map { JSKey($0.uri) })
    if !gone.isEmpty { await store.remove("posts", gone.map(JSONValue.string)) }
    let kept = posts.filter { fresh.contains(JSKey($0.uri)) }
    if !kept.isEmpty { await store.putAll("posts", kept.map(\.json)) }
    guard let next = PostChanges.applyPostChanges(data.posts, rows: rows, removed: gone) else { return }
    var updated = data
    updated.posts = next
    updated.rev += 1
    setData(updated)
  }

  // MARK: - Actors

  /// Resolve profile cards for DIDs a People list wants but lacks (each
  /// DID tried once per archive).
  public func wantActors(_ dids: [String?]) async {
    let held = actors
    var missing: [String] = []
    for did in dids {
      guard let did, !did.isEmpty else { continue }
      if let handle = held[did]?.handle, !handle.isEmpty { continue }
      if attemptedActors.contains(JSKey(did)) { continue }
      missing.append(did)
    }
    if missing.isEmpty { return }
    for did in missing { attemptedActors.insert(JSKey(did)) }
    // The read is never called off (the web's hydrateActors takes no
    // signal): a list left before it answers, or a `.task(id:)` started
    // again, would otherwise cancel requests for DIDs now marked as tried,
    // and those cards would never come.
    let cache = held.byDid
    let now = clockNow()
    let transport = env.transport
    let clock = env.clock
    let fresh = await Task {
      await AnalyticsSync.hydrateActors(missing, cache: cache, now: now, transport: transport, clock: clock)
    }.value
    if fresh.isEmpty { return }
    // A card keeps what the tools learned about the account.
    let merged = fresh.map { ActorCards.merge(held[$0.did], $0) }
    let target = store
    Task { await target?.putAll("actors", merged.map(\.json)) }
    var next = actors
    for card in merged { next.set(ActorCards.merge(next[card.did], card)) }
    actors = next
  }

  /// When each of `dids` last posted or reposted (one feed item each from
  /// the public AppView), kept on their cards. Returns how many were read.
  public func checkActivity(_ dids: [String?], onProgress: (@Sendable (ActivityProgress) -> Void)? = nil) async -> Int {
    let results = await Activity.checkActivity(dids, onProgress: onProgress, transport: env.transport, timeZone: timeZone)
    if results.isEmpty { return 0 }
    let now = clockNow()
    var next = actors
    var merged: [ActorCard] = []
    for r in results {
      var card = next[r.did] ?? ActorCard(did: r.did)
      card.did = r.did
      card.lastActiveAt = r.lastActiveAt
      if r.lastActiveAt == nil { card.extra["lastActiveAt"] = .null } else { card.extra["lastActiveAt"] = nil }
      card.gone = r.gone
      card.activityAt = now
      next.set(card)
      merged.append(card)
    }
    actors = next
    await store?.putAll("actors", merged.map(\.json))
    return results.count
  }

  // MARK: - Deleting

  /// Empty this account's archive here: every store and its marks. The
  /// account, its repo and its followers are untouched.
  public func deleteArchive() async {
    guard let store else { return }
    cancelSync()
    for name in Self.archiveStores { await store.clear(name) }
    autoRan = false
    attemptedActors = []
    syncError = nil
    await reload(store)
  }

  // MARK: - Exports

  /// The whole archive as a JSON file (exports.js exportArchive).
  public func exportArchive() throws -> ExportFile {
    try ArchiveExports.exportArchive(data, did: did, handle: handle, actors: actors.cards, now: clockNow(), timeZone: timeZone)
  }

  /// The posts (all, or the ones a page shows) as CSV.
  public func exportPosts(_ posts: [PostRow]? = nil) -> ExportFile {
    ArchiveExports.exportPosts(data, did: did, handle: handle, posts: posts, now: clockNow(), timeZone: timeZone)
  }

  /// Any table as CSV.
  public func exportRows(_ what: String, _ rows: [[JSONValue?]]) -> ExportFile {
    ArchiveExports.exportRows(did: did, handle: handle, what: what, rows: rows, now: clockNow(), timeZone: timeZone)
  }
}

/// The actor cards (the web's Map, did → card): in the order first set,
/// keyed by code unit.
public struct ActorCards: Hashable, Sendable {
  public private(set) var order: [JSKey] = []
  public private(set) var byDid: [JSKey: ActorCard] = [:]

  public init(_ cards: [ActorCard] = []) {
    for card in cards { set(card) }
  }

  public subscript(_ did: String) -> ActorCard? { byDid[JSKey(did)] }

  /// Every card, in the Map's order.
  public var cards: [ActorCard] { order.compactMap { byDid[$0] } }
  public var count: Int { order.count }

  /// `map.set(card.did, card)`: a card already held keeps its place.
  public mutating func set(_ card: ActorCard) {
    let key = JSKey(card.did)
    if byDid[key] == nil { order.append(key) }
    byDid[key] = card
  }

  /// `{ ...held, ...card }` for the members a fresh card carries.
  static func merge(_ held: ActorCard?, _ card: ActorCard) -> ActorCard {
    guard var out = held else { return card }
    out.did = card.did
    if card.handle != nil { out.handle = card.handle }
    if card.displayName != nil { out.displayName = card.displayName }
    if card.avatar != nil { out.avatar = card.avatar }
    if card.at != nil { out.at = card.at }
    for (key, value) in card.extra { out.extra[key] = value }
    return out
  }
}
