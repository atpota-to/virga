// Ports src/posting/library/useLibrary.js
//
// Everything behind the library dialog, with no markup: the shelves and
// their items, suggestions for a reply, search, what each template quotes,
// use counts, and turning a pick into a plan the composer can carry out.
//
// `did` is the account the post is written as: its templates, its archive,
// its saved posts. Shelf data lives in LibraryStore, keyed by DID, because
// the model goes with the dialog and reopening it should show what was there
// at once. Shelves load when the dialog asks for them (`ensure`). Use counts
// are read once per opening, so using a template doesn't reshuffle the shelf
// as the dialog closes. Using a template is counted by the composer as it
// applies the plan, so nothing here counts one.
//
// The hook's lifetime maps to calls the view makes: `init` is the first
// render, `start()` the mount (on appear, from `.task`), `setOpen(_:)` and
// `update(...)` new props, `stop()` the unmount. The web's effects run
// after each of those and after every store or template change, each only
// when what it depends on moved, as React runs them. The web computes the
// suggestions while rendering, once their sources have settled; here they
// are frozen at the first read (or change) after that.
//
// The archive is read from the account's analytics store, as the web reads
// it (LibraryEnvironment.openStore), not through ArchiveModel.

import Foundation
import Observation
import VirgaArchive
import VirgaCore
import VirgaNetwork
import VirgaSession

/// What the library needs of the session: an agent for the account it
/// writes as (agentFor, asked at call time) and an account's handle.
@MainActor
public protocol LibrarySession: AnyObject, Sendable {
  func libraryAgent(for did: String) async throws -> XRPCAgent?
  func libraryHandle(for did: String) -> String?
}

extension SessionModel: LibrarySession {
  public func libraryAgent(for did: String) async throws -> XRPCAgent? {
    try await agentFor(did)
  }

  public func libraryHandle(for did: String) -> String? {
    accounts.first { $0.did.jsEquals(did) }?.handle
  }
}

/// A pending `setTimeout`: cancel it to clear it.
public struct LibraryTimerHandle: Sendable {
  let cancelAction: @MainActor @Sendable () -> Void
  public init(cancel: @escaping @MainActor @Sendable () -> Void) { cancelAction = cancel }
  @MainActor public func cancel() { cancelAction() }
}

/// `setTimeout(action, ms)`, injectable so tests fire the search debounce
/// themselves.
public typealias LibrarySchedule = @MainActor (_ ms: Double, _ action: @escaping @MainActor () -> Void) -> LibraryTimerHandle

/// The model's I/O: the network, the archive, the card service, where use
/// counts are kept, the clock and the timer.
public struct LibraryEnvironment {
  public var transport: any HTTPTransport
  public var openStore: OpenArchiveStore
  public var fetchLinkCard: FetchLinkCard
  /// Where readTemplateUsage reads use counts (the web's localStorage).
  public var usageStore: (any KeyValueStore)?
  public var now: @MainActor () -> Date
  public var locale: String?
  public var timeZone: TimeZone?
  public var schedule: LibrarySchedule

  public init(
    transport: any HTTPTransport = HTTP.transport, openStore: @escaping OpenArchiveStore,
    fetchLinkCard: @escaping FetchLinkCard = LibrarySources.noLinkCard, usageStore: (any KeyValueStore)? = nil,
    now: @escaping @MainActor () -> Date = { Date() }, locale: String? = nil, timeZone: TimeZone? = nil,
    schedule: @escaping LibrarySchedule = LibraryEnvironment.liveSchedule
  ) {
    self.transport = transport
    self.openStore = openStore
    self.fetchLinkCard = fetchLinkCard
    self.usageStore = usageStore
    self.now = now
    self.locale = locale
    self.timeZone = timeZone
    self.schedule = schedule
  }

  /// The archive read from the app's file store, as analyticsStore.js opens it.
  public static func archive(files: (any FileStore)?, registry: AnalyticsStoreRegistry = .shared) -> OpenArchiveStore {
    { did in await AnalyticsStore.openAnalyticsStore(did, files: files, registry: registry) }
  }

  /// setTimeout on the main actor.
  public static let liveSchedule: LibrarySchedule = { ms, action in
    let task = Task { @MainActor in
      try? await Task.sleep(nanoseconds: UInt64(max(0, ms) * 1_000_000))
      if !Task.isCancelled { action() }
    }
    return LibraryTimerHandle { task.cancel() }
  }
}

/// A shelf as the dialog lists it: its words, how many items, and how its
/// read is going.
public struct LibraryShelfSummary: Sendable {
  public var id: String
  public var label: String
  public var count: Int?
  public var total: Int?
  public var status: String
  public var error: (any Error)?
  public var refreshing: Bool
  public var loadingMore: Bool
  public var loadMoreError: String?
}

/// "For this reply": `{ status: 'loading' | 'ready', items }`.
public struct LibrarySuggestions: Hashable, Sendable {
  public var status: String
  public var items: [LibraryItem]
}

/// Bluesky search's state, as the dialog shows it.
public struct LibraryRemoteSearch: Sendable {
  public var query: String
  public var status: String
  public var error: (any Error)?
  public var posts: [LibraryItem]
  public var hasMore: Bool
  public var loadingMore: Bool
  public var loadMoreError: String?
}

@MainActor
@Observable
public final class LibraryModel {
  static let searchDebounceMs: Double = 400
  static let suggestionLimit = 5
  // How many archive rows a shelf shows at first, and how many more each Load more adds.
  static let archivePage: Double = 50
  // The recent posts "For this reply" compares the parent with. More would
  // let one topic the account posts about all the time count as "common".
  static let suggestionPosts: Double = 200
  // Searching an archive returns at most this many of each kind of post.
  static let archiveSearchLimit: Double = 50
  // What searching reads, besides the templates.
  static let searchShelves = ["archive", "saved", "links", "feeds", "lists"]

  struct RemoteState {
    var query = ""
    var posts: [JSONValue] = []
    var cursor: String?
    var status = "idle"
    var error: (any Error)?
    var loadingMore = false
    var loadMoreError: String?

    static let idle = RemoteState()
  }

  struct Frozen {
    var openId: Int?
    var replyKey: String
    var did: String?
    var picked: [LibraryItem]
  }

  // MARK: Props

  public private(set) var did: String?
  public private(set) var isOpen: Bool
  public private(set) var reply: JSONValue?
  public private(set) var selfHandle: String?
  public private(set) var quoteSlotLocked: Bool
  /// One id per opening of the dialog.
  public private(set) var openId: Int?

  // MARK: State

  public private(set) var sort = "date"
  private var visible: [String: Double] = ["posts": LibraryModel.archivePage, "replies": LibraryModel.archivePage]
  private var wantsFeed: [String] = []
  public private(set) var query = ""
  public private(set) var mine = false
  private var remote = RemoteState.idle

  @ObservationIgnored public let templates: TemplatesModel
  @ObservationIgnored public let store: LibraryStore
  @ObservationIgnored private let session: (any LibrarySession)?
  @ObservationIgnored private let givenSources: (any LibraryShelfSources)?
  @ObservationIgnored private let environment: LibraryEnvironment
  @ObservationIgnored private var frozen: Frozen?
  @ObservationIgnored private var started = false
  @ObservationIgnored private var unsubscribeStore: (@MainActor () -> Void)?
  @ObservationIgnored private var unsubscribeTemplates: (@MainActor () -> Void)?
  // The search's bookkeeping (the web's searchRef).
  @ObservationIgnored private var searchToken = 0
  @ObservationIgnored private var searchPending = false
  @ObservationIgnored private var searchFailed: String?
  @ObservationIgnored private var searchTimer: LibraryTimerHandle?
  /// The remote search or Load more in flight, for tests to wait on.
  @ObservationIgnored private(set) var searchTask: Task<Void, Never>?
  /// The store reads this model started, for tests to wait on (settled()).
  @ObservationIgnored private var startedLoads: [Task<Void, Never>] = []
  // What each effect last ran for.
  @ObservationIgnored private var suggestedEffect: [String]?
  @ObservationIgnored private var feedEffect: [String]?
  @ObservationIgnored private var embedsEffect: (key: [String], templates: [PostTemplate])?
  @ObservationIgnored private var searchEffect: [String]?
  // Memos the web keeps per opening.
  @ObservationIgnored private var contextMemo: (key: [String], value: TemplateContext)?
  @ObservationIgnored private var usageMemo: (key: [String], value: TemplateUsageCounts)?

  public init(
    session: (any LibrarySession)?, templates: TemplatesModel, did: String?, isOpen: Bool = true, reply: JSONValue? = nil,
    selfHandle: String? = nil, quoteSlotLocked: Bool = false, sources: (any LibraryShelfSources)? = nil,
    store: LibraryStore = .shared, environment: LibraryEnvironment
  ) {
    self.session = session
    self.templates = templates
    self.did = did?.isEmpty == false ? did : nil
    self.isOpen = isOpen
    self.reply = reply
    self.selfHandle = selfHandle
    self.quoteSlotLocked = quoteSlotLocked
    givenSources = sources
    self.store = store
    self.environment = environment
    // Assigned while rendering, because the dialog's effects (which call
    // ensure) run before this model's own.
    openId = isOpen ? store.nextOpen() : nil
    templates.setAccount(self.did, enabled: self.did != nil)
  }

  // MARK: - Lifetime

  /// The mount: follow the store and the templates, and run the effects.
  public func start() {
    guard !started else { return }
    started = true
    templates.start()
    unsubscribeStore = store.subscribe { [weak self] in self?.runEffects() }
    unsubscribeTemplates = templates.service.subscribe { [weak self] _, _ in self?.runEffects() }
    runEffects()
  }

  /// The unmount: stop following, clear the search's timer.
  public func stop() {
    started = false
    unsubscribeStore?()
    unsubscribeStore = nil
    unsubscribeTemplates?()
    unsubscribeTemplates = nil
    searchTimer?.cancel()
    searchTimer = nil
    searchPending = false
    templates.stop()
    suggestedEffect = nil
    feedEffect = nil
    embedsEffect = nil
    searchEffect = nil
  }

  /// The dialog opened or closed: a new opening gets a new id.
  public func setOpen(_ open: Bool) {
    if open && openId == nil { openId = store.nextOpen() } else if !open && openId != nil { openId = nil }
    isOpen = open
    runEffects()
  }

  /// New props.
  public func update(did: String?, reply: JSONValue? = nil, selfHandle: String? = nil, quoteSlotLocked: Bool = false) {
    let next = did?.isEmpty == false ? did : nil
    if !next.jsEquals(self.did) {
      self.did = next
      templates.setAccount(next, enabled: next != nil)
    }
    self.reply = reply
    self.selfHandle = selfHandle
    self.quoteSlotLocked = quoteSlotLocked
    runEffects()
  }

  // MARK: - Derived

  public var replying: Bool { reply?["uri"]?.isTruthy == true }

  /// The handle the post goes out as.
  public var handle: String? {
    if let selfHandle, !selfHandle.isEmpty { return selfHandle }
    guard let did else { return nil }
    return session?.libraryHandle(for: did)
  }

  /// The shelves' reads for the account (the given sources, else the app's).
  public var sources: (any LibraryShelfSources)? {
    if let givenSources { return givenSources }
    guard let did else { return nil }
    let environment = self.environment
    let locale = environment.locale
    let zone = environment.timeZone
    let now = environment.now()
    return LibrarySources.librarySources(
      did: did,
      agent: { [session] d in
        guard let d else { return nil }
        return try await session?.libraryAgent(for: d)
      }, handle: handle, transport: environment.transport, openStore: environment.openStore,
      fetchLinkCard: environment.fetchLinkCard, clock: { LibraryClock(now: now, locale: locale, timeZone: zone) })
  }

  var clock: LibraryClock {
    LibraryClock(now: environment.now(), locale: environment.locale, timeZone: environment.timeZone)
  }

  /// The template context: who is replied to, the handle, today (fixed per opening).
  public var context: TemplateContext {
    let key = [
      replying ? "1" : "0", Library.str(reply?["author"]?["displayName"]), Library.str(reply?["author"]?["handle"]),
      Library.str(reply?["text"]), handle ?? "", openId.map(String.init) ?? "",
    ]
    if let memo = contextMemo, memo.key == key { return memo.value }
    let value = Library.libraryContext(
      reply: reply ?? .null, selfHandle: handle, now: environment.now(), locale: environment.locale,
      timeZone: environment.timeZone)
    contextMemo = (key, value)
    return value
  }

  /// Use counts, read once per opening.
  var usage: TemplateUsageCounts {
    let key = [did ?? "", openId.map(String.init) ?? ""]
    if let memo = usageMemo, memo.key == key { return memo.value }
    let value = TemplateUsage.readTemplateUsage(did, store: environment.usageStore)
    usageMemo = (key, value)
    return value
  }

  func entryOf(_ id: String) -> LibraryEntry { store.entry(did, id) }

  /// Where Your posts and Your replies come from: 'archive', 'feed', or nil yet.
  public var postsFrom: String? { LibraryStore.postsSource(entryOf("archive")) }

  // MARK: - Shelves

  func ensureStoreShelf(_ shelfId: String) {
    guard let did, isOpen else { return }
    if let load = store.ensure(did: did, shelfId: shelfId, sources: sources, openId: openId) { startedLoads.append(load) }
  }

  /// Waits for every store read this model started, and for those their
  /// landing started in turn (the effects they set off), until none is left.
  func settled() async {
    while !startedLoads.isEmpty {
      let loads = startedLoads
      startedLoads = []
      for load in loads { await load.value }
    }
  }

  /// Loads what a shelf shows, if it isn't loaded.
  public func ensure(_ shelfId: String) {
    if shelfId == "suggested" {
      ["archive", "feeds", "lists"].forEach(ensureStoreShelf)
      if !wantsFeed.contains("posts") { wantsFeed.append("posts") }
    } else if shelfId == "posts" || shelfId == "replies" {
      ensureStoreShelf("archive")
      if !wantsFeed.contains(shelfId) { wantsFeed.append(shelfId) }
    } else if shelfId != "templates" && shelfId != "search" {
      ensureStoreShelf(shelfId)
    }
    runEffects()
  }

  /// Reads a shelf again.
  public func retry(_ shelfId: String) {
    if shelfId == "templates" {
      Task { await templates.reload() }
      return
    }
    guard let did else { return }
    let ids: [String]
    if shelfId == "suggested" {
      ids = ["archive", "feeds", "lists"]
    } else if shelfId == "posts" || shelfId == "replies" {
      ids = postsFrom == "feed" ? [shelfId] : ["archive"]
    } else {
      ids = [shelfId]
    }
    let sources = self.sources
    for id in ids {
      let store = self.store
      startedLoads.append(Task { await store.retry(did: did, shelfId: id, sources: sources) })
    }
  }

  public func setSort(_ next: String) {
    sort = next == "engagement" ? "engagement" : "date"
  }

  /// Every shelf's items, from the store's entries.
  var shelfItems: [String: ShelfItems] {
    let clock = self.clock
    let archive = entryOf("archive")
    var out: [String: ShelfItems] = [:]
    for id in ["posts", "replies"] {
      out[id] = LibraryStore.buildShelfItems(
        id, entry: entryOf(id), archive: archive, did: did, sort: sort, limit: visible[id] ?? Self.archivePage,
        clock: clock)
    }
    for id in ["saved", "links", "feeds", "lists"] {
      out[id] = LibraryStore.buildShelfItems(id, entry: entryOf(id), did: did, clock: clock)
    }
    return out
  }

  public func hasMore(_ shelfId: String) -> Bool {
    if shelfId == "search" { return false }
    if (shelfId == "posts" || shelfId == "replies") && postsFrom == "archive" {
      let shelf = shelfItems[shelfId]
      return (shelf?.total ?? 0) > (shelf?.items.count ?? 0)
    }
    let e = entryOf(shelfId)
    return e.status == "ready" && e.cursor?.isEmpty == false
  }

  public func loadMore(_ shelfId: String) {
    guard let did else { return }
    if (shelfId == "posts" || shelfId == "replies") && postsFrom == "archive" {
      visible[shelfId, default: Self.archivePage] += Self.archivePage
      return
    }
    let store = self.store
    let sources = self.sources
    startedLoads.append(Task { await store.loadMore(did: did, shelfId: shelfId, sources: sources) })
  }

  /// What the account's templates quote, as the store has read it.
  public var templateEmbeds: LibraryEmbedViews { store.embeds(did) ?? LibraryEmbedViews() }

  var templateData: LibraryStore.TemplateShelf {
    LibraryStore.templateShelf(
      templates.templates, usage: usage, context: context, embeds: templateEmbeds, replying: replying)
  }

  // MARK: - Suggestions

  var templatesSettled: Bool { templates.ready || templates.error != nil }

  static func settled(_ status: String) -> Bool { status == "ready" || status == "error" }

  var replyKey: String { replying ? (Library.text(reply?["uri"]) ?? "") : "" }

  private func frozenFits(_ f: Frozen?) -> Bool {
    guard let f else { return false }
    return f.openId == openId && f.replyKey.jsEquals(replyKey) && f.did.jsEquals(did)
  }

  /// Computes "For this reply" once its sources have settled, then keeps it.
  private func freezeIfReady() {
    guard replying, isOpen, did != nil, !frozenFits(frozen) else { return }
    let archive = entryOf("archive")
    let from = postsFrom
    let sourcesSettled =
      templatesSettled && Self.settled(archive.status) && (from != "feed" || Self.settled(entryOf("posts").status))
      && Self.settled(entryOf("feeds").status) && Self.settled(entryOf("lists").status)
    guard sourcesSettled else { return }
    let shelves = shelfItems
    let posts =
      from == "archive"
      ? LibrarySources.archiveShelf(archive.data?.items, did: did, limit: Self.suggestionPosts, clock: clock).items
      : shelves["posts"]?.items ?? []
    let context = self.context
    let locked = quoteSlotLocked
    let picked = Library.suggestItems(
      templates: templateData.items.filter { Library.previewFor($0, context: context, quoteSlotLocked: locked, clock: clock).usable },
      posts: locked ? [] : posts, feeds: locked ? [] : shelves["feeds"]?.items ?? [],
      lists: locked ? [] : shelves["lists"]?.items ?? [], parentText: Library.str(reply?["text"]),
      parentUri: Library.text(reply?["uri"]), limit: Self.suggestionLimit)
    frozen = Frozen(
      openId: openId, replyKey: replyKey, did: did,
      picked: picked.map {
        var item = $0
        item.shelf = "suggested"
        return item
      })
  }

  /// "For this reply": loading until its sources settle. The order and
  /// reasons are frozen; a template follows its shelf, so a quote hydrated
  /// later still shows, and one deleted meanwhile drops out.
  public var suggested: LibrarySuggestions {
    guard replying else { return LibrarySuggestions(status: "ready", items: []) }
    freezeIfReady()
    guard let frozen, frozenFits(frozen) else { return LibrarySuggestions(status: "loading", items: []) }
    let byId = Dictionary(templateData.items.map { (JSKey($0.id), $0) }, uniquingKeysWith: { _, last in last })
    let items = frozen.picked.compactMap { s -> LibraryItem? in
      guard s.kind == "template" else { return s }
      guard var current = byId[JSKey(s.id)] else { return nil }
      current.shelf = "suggested"
      current.reason = s.reason
      return current
    }
    return LibrarySuggestions(status: "ready", items: items)
  }

  // MARK: - Search

  public func setQuery(_ value: String?) {
    query = value ?? ""
    runEffects()
  }

  public func setMine(_ value: Bool) {
    if value == mine { return }
    mine = value
    let q = LibraryStore.remoteQueryFor(query)
    if !q.isEmpty && !searchPending && isOpen && did != nil { runSearch(q) }
  }

  private func runSearch(_ q: String) {
    searchToken += 1
    let token = searchToken
    searchFailed = nil
    remote = RemoteState(query: q, status: "loading")
    let sources = self.sources
    let mine = self.mine
    searchTask = Task { [weak self] in
      let result: Result<LibraryPage, any Error>
      do {
        guard let sources else { throw LibrarySourcesError(message: "Not signed in") }
        result = .success(try await sources.search(q, mine: mine, cursor: nil))
      } catch {
        result = .failure(error)
      }
      guard let self, token == self.searchToken else { return }
      switch result {
      case .success(let page):
        self.remote.posts = page.items
        self.remote.cursor = page.cursor?.isEmpty == false ? page.cursor : nil
        self.remote.status = "ready"
      case .failure(let error):
        self.searchFailed = q
        self.remote.status = "error"
        self.remote.error = error
      }
    }
  }

  private func stopSearch() {
    searchToken += 1
    searchFailed = nil
    if remote.status != "idle" || !remote.query.isEmpty || !remote.posts.isEmpty { remote = .idle }
  }

  /// Runs a failed search again.
  public func retrySearch() {
    let q = LibraryStore.remoteQueryFor(query)
    guard !q.isEmpty, !searchPending, isOpen, did != nil else { return }
    if searchFailed.jsEquals(q) { runSearch(q) }
  }

  /// The next page of Bluesky search.
  public func loadMoreSearch() {
    guard remote.status == "ready", let cursor = remote.cursor, !cursor.isEmpty, !remote.loadingMore else { return }
    let token = searchToken
    let q = remote.query
    remote.loadingMore = true
    remote.loadMoreError = nil
    let sources = self.sources
    let mine = self.mine
    searchTask = Task { [weak self] in
      let result: Result<LibraryPage, any Error>
      do {
        guard let sources else { throw LibrarySourcesError(message: "Not signed in") }
        result = .success(try await sources.search(q, mine: mine, cursor: cursor))
      } catch {
        result = .failure(error)
      }
      guard let self, token == self.searchToken else { return }
      switch result {
      case .success(let page):
        var seen = LibrarySources.SeenLinks()
        for post in self.remote.posts { seen.insert(post["uri"] ?? .null) }
        let added = page.items.filter { p in
          guard let uri = p["uri"], uri.isTruthy, !seen.contains(uri) else { return false }
          return true
        }
        self.remote.posts += added
        self.remote.cursor = page.cursor?.isEmpty == false && !page.cursor.jsEquals(cursor) ? page.cursor : nil
        self.remote.loadingMore = false
      case .failure(let error):
        self.remote.loadingMore = false
        let message = jsMessage(error)
        self.remote.loadMoreError = message.isEmpty ? "Search failed" : message
      }
    }
  }

  /// What the library itself holds that matches the query: templates (a
  /// "/" query looks at shortcuts only), saved posts, links, feeds, lists,
  /// and the whole archive.
  public var local: [LibraryItem] {
    let trimmed = query.jsTrimmed()
    if trimmed.isEmpty { return [] }
    let shelves = shelfItems
    let listed =
      templateData.items + (shelves["saved"]?.items ?? []) + (shelves["links"]?.items ?? [])
      + (shelves["feeds"]?.items ?? []) + (shelves["lists"]?.items ?? [])
    if trimmed.utf16.first == 0x2F { return Library.searchItems(listed, trimmed, replying: replying) }
    // The archive is searched whole, not only the rows shown.
    let posts: [LibraryItem]
    if postsFrom == "archive" {
      let rows = entryOf("archive").data?.items
      posts =
        LibrarySources.archiveShelf(rows, did: did, query: trimmed, limit: Self.archiveSearchLimit, clock: clock).items
        + LibrarySources.archiveShelf(rows, did: did, replies: true, query: trimmed, limit: Self.archiveSearchLimit, clock: clock).items
    } else {
      posts = Library.searchItems((shelves["posts"]?.items ?? []) + (shelves["replies"]?.items ?? []), trimmed)
    }
    return Library.dedupeById(Library.searchItems(listed, trimmed, replying: replying) + posts)
  }

  /// Whether `local` is all there: 'loading' while something it searches is
  /// still to land. A "/" query searches templates only.
  public var localStatus: String {
    let trimmed = query.jsTrimmed()
    guard isOpen, did != nil, !trimmed.isEmpty else { return "ready" }
    let shortcut = trimmed.utf16.first == 0x2F
    let shelfPending = !shortcut && Self.searchShelves.contains { !Self.settled(entryOf($0).status) }
    return !templatesSettled || shelfPending ? "loading" : "ready"
  }

  /// Bluesky search: the posts (those not already among `local`).
  public var remoteSearch: LibraryRemoteSearch {
    let localIds = Set(local.map { JSKey($0.id) })
    let clock = self.clock
    let posts = Library.dedupeById(
      remote.posts.map { Library.itemFromPost($0, shelf: "search", selfDid: did, clock: clock) }, localIds)
    return LibraryRemoteSearch(
      query: remote.query, status: remote.status, error: remote.error, posts: posts,
      hasMore: remote.status == "ready" && remote.cursor?.isEmpty == false, loadingMore: remote.loadingMore,
      loadMoreError: remote.loadMoreError)
  }

  // MARK: - Shelf summaries

  var templatesStatus: String {
    guard did != nil else { return "idle" }
    if templates.ready || !templates.templates.isEmpty { return "ready" }
    if templates.error != nil { return "error" }
    return "loading"
  }

  /// The shelves the dialog lists, with their counts and how their reads are going.
  public var shelves: [LibraryShelfSummary] {
    let shelves = shelfItems
    return Library.shelvesFor(replying: replying).map { shelf in
      func summary(_ e: LibraryEntry, _ items: [LibraryItem], total: Int? = nil) -> LibraryShelfSummary {
        LibraryShelfSummary(
          id: shelf.id, label: shelf.label, count: e.data != nil || e.status == "ready" ? items.count : nil, total: total,
          status: e.status, error: e.error, refreshing: e.refreshing, loadingMore: e.loadingMore,
          loadMoreError: e.loadMoreError?.isEmpty == false ? e.loadMoreError : nil)
      }
      switch shelf.id {
      case "suggested":
        let s = suggested
        var out = summary(LibraryEntry(status: s.status), s.items)
        out.count = s.status == "ready" ? s.items.count : nil
        return out
      case "templates":
        let status = templatesStatus
        let items = templateData.items
        var out = summary(LibraryEntry(status: status, error: templates.error), items)
        out.count = status == "ready" ? items.count : nil
        out.refreshing = status == "ready" && templates.loading
        return out
      case "search":
        let r = remoteSearch
        return summary(
          LibraryEntry(status: r.status, error: r.error, loadingMore: r.loadingMore, loadMoreError: r.loadMoreError),
          r.posts)
      case "posts", "replies":
        let e = postsFrom == "feed" ? entryOf(shelf.id) : entryOf("archive")
        return summary(e, shelves[shelf.id]?.items ?? [], total: shelves[shelf.id]?.total)
      default:
        return summary(entryOf(shelf.id), shelves[shelf.id]?.items ?? [])
      }
    }
  }

  /// A shelf's items ('search' is the Bluesky search results).
  public func items(_ shelfId: String) -> [LibraryItem] {
    switch shelfId {
    case "suggested": return suggested.items
    case "templates": return templateData.items
    case "search": return remoteSearch.posts
    case "posts", "replies", "saved", "links", "feeds", "lists": return shelfItems[shelfId]?.items ?? []
    default: return []
    }
  }

  /// The Templates shelf under its group headings.
  public func templateSections() -> [LibrarySection] { templateData.sections }

  // MARK: - Effects

  /// The web's effects, each run when what it depends on moved.
  func runEffects() {
    guard started else { return }
    // "For this reply" reads its sources once the dialog opens on a reply.
    let suggestedKey = [isOpen ? "1" : "0", replying ? "1" : "0", did ?? "", openId.map(String.init) ?? ""]
    if suggestedKey != suggestedEffect {
      suggestedEffect = suggestedKey
      if isOpen && replying && did != nil { ensure("suggested") }
    }
    // Your posts and Your replies read the author feed only when the archive is empty.
    let feedKey = [postsFrom ?? "", wantsFeed.joined(separator: ","), openId.map(String.init) ?? ""]
    if feedKey != feedEffect {
      feedEffect = feedKey
      if postsFrom == "feed" { wantsFeed.forEach(ensureStoreShelf) }
    }
    // What the templates quote.
    let list = templates.templates
    let embedsKey = [isOpen ? "1" : "0", did ?? "", handle ?? "", openId.map(String.init) ?? ""]
    if embedsEffect.map({ $0.key != embedsKey || $0.templates != list }) ?? true {
      embedsEffect = (embedsKey, list)
      if isOpen, let did, !list.isEmpty {
        let store = self.store
        let sources = self.sources
        startedLoads.append(Task { await store.hydrateTemplateEmbeds(did: did, sources: sources, templates: list) })
      }
    }
    // Search: the store's shelves and Bluesky, a moment after typing stops.
    let searchKey = [query, isOpen ? "1" : "0", did ?? ""]
    if searchKey != searchEffect {
      searchEffect = searchKey
      runSearchEffect()
    }
    freezeIfReady()
  }

  private func runSearchEffect() {
    // The cleanup of the effect's last run.
    searchTimer?.cancel()
    searchTimer = nil
    searchPending = false
    let trimmed = query.jsTrimmed()
    let remoteQuery = LibraryStore.remoteQueryFor(query)
    if !isOpen || did == nil || remoteQuery.isEmpty {
      searchPending = false
      stopSearch()
    }
    if !isOpen || did == nil || trimmed.isEmpty || trimmed.utf16.first == 0x2F { return }
    searchPending = !remoteQuery.isEmpty
    searchTimer = environment.schedule(Self.searchDebounceMs) { [weak self] in
      guard let self else { return }
      self.searchPending = false
      self.searchTimer = nil
      Self.searchShelves.forEach(self.ensureStoreShelf)
      if !remoteQuery.isEmpty { self.runSearch(remoteQuery) }
    }
  }

  // MARK: - Using an item

  /// The item read again (LibrarySources.hydratePick).
  public func hydrate(_ item: LibraryItem) async throws -> LibraryItem {
    guard let sources else { throw LibrarySourcesError(message: "Not signed in") }
    return try await sources.hydrate(item)
  }

  /// A LibraryPlan for the pick, its attachment read again (cid, view).
  public func planFor(_ item: LibraryItem, answers: JSONValue = .object([:])) async throws -> LibraryPlan {
    var plan = Library.applyPlanFor(
      item, context: .template(context), answers: answers, quoteSlotLocked: quoteSlotLocked, clock: clock)
    if let attach = plan.attach, !attach.isLink {
      guard let sources else { throw LibrarySourcesError(message: "Not signed in") }
      plan.attach = try await sources.hydrateAttachment(attach)
    }
    return plan
  }

  /// planFor with answers typed as text.
  public func planFor(_ item: LibraryItem, answers: [String: String]) async throws -> LibraryPlan {
    try await planFor(item, answers: .object(answers.mapValues(JSONValue.string)))
  }

  /// A pasted link as an item, or nil.
  public func resolveLink(_ text: String) async throws -> LibraryItem? {
    guard let sources else { return nil }
    return try await sources.resolveLink(text)
  }
}
