// Ports src/posting/library/store.js
//
// What the library's shelves hold, kept outside the views so reopening the
// library shows what was there at once. One store for the app, keyed by the
// account the post is written as.
//
// Shelves load when the dialog asks for them (`ensure`), never all at once.
// Within one opening of the dialog an entry is looked at once: an error
// stays until `retry`, and an entry older than five minutes is shown and its
// first page read again in the background. `reset()` (on sign-out, or
// removing an account) empties it; reads still in flight then land nowhere.
//
// Your posts and Your replies come from the account's archive (`archive`,
// every row at once, paged and sorted here). Only when that archive is empty
// do the `posts` and `replies` entries read the public author feed instead.
//
// The web keeps this in memory too (no IndexedDB or localStorage), so the
// port does: one LibraryStore.shared for the app, which the session's
// sign-out resets. Its reads run as tasks on the main actor; `ensure`
// hands back the load it started so a caller (or a test) can wait on it.
//
// LibraryStore+Shelves.swift has the pure helpers (postsSource,
// buildShelfItems, templateShelf, remoteQueryFor).

import Foundation
import Observation
import VirgaCore
import VirgaNetwork

/// A shelf's data: its views (or links) and, for feeds, the saved ones.
public struct LibraryEntryData: Sendable {
  public var items: [JSONValue]
  public var saved: [JSONValue]?

  public init(items: [JSONValue] = [], saved: [JSONValue]? = nil) {
    self.items = items
    self.saved = saved
  }
}

/// One shelf's state in the store (the web's entry object).
public struct LibraryEntry: Sendable {
  /// 'idle' | 'loading' | 'ready' | 'error'.
  public var status: String
  public var error: (any Error)?
  public var data: LibraryEntryData?
  public var cursor: String?
  /// When it was last read, in epoch ms.
  public var fetchedAt: Double
  public var refreshing: Bool
  public var loadingMore: Bool
  public var loadMoreError: String?
  public var seq: Int

  public init(
    status: String = "idle", error: (any Error)? = nil, data: LibraryEntryData? = nil, cursor: String? = nil,
    fetchedAt: Double = 0, refreshing: Bool = false, loadingMore: Bool = false, loadMoreError: String? = nil,
    seq: Int = 0
  ) {
    self.status = status
    self.error = error
    self.data = data
    self.cursor = cursor
    self.fetchedAt = fetchedAt
    self.refreshing = refreshing
    self.loadingMore = loadingMore
    self.loadMoreError = loadMoreError
    self.seq = seq
  }

  /// IDLE_ENTRY.
  public static let idle = LibraryEntry()
}

/// The loads failed with nothing to say: the web's `new Error('Load failed')`.
public struct LibraryLoadFailed: Error, LocalizedError, Hashable, Sendable {
  public var errorDescription: String? { "Load failed" }
}

@MainActor
@Observable
public final class LibraryStore {
  public nonisolated static let staleMs: Double = 5 * 60 * 1000
  public nonisolated static let storeShelves = ["archive", "posts", "replies", "saved", "links", "feeds", "lists"]
  nonisolated static let recordEmbed = "app.bsky.embed.record"

  /// The app's library store.
  public static let shared = LibraryStore()

  /// Bumped on every change: what the views watch (useSyncExternalStore's version).
  public private(set) var version = 0

  final class Account {
    var shelves: [String: LibraryEntry] = [:]
    var embeds = LibraryEmbedViews()
    var embedsAt: [JSKey: Double] = [:]
    var embedsPending = Set<JSKey>()
    var checked: [String: Int?] = [:]
  }

  struct Generation: Equatable {
    var all: Int
    var account: Int
  }

  @ObservationIgnored private var accounts: [JSKey: Account] = [:]
  // Bumped by reset() for everyone and by reset(did) for that account alone,
  // so a read in flight for one account isn't stranded by another's reset.
  @ObservationIgnored private var generation = 0
  @ObservationIgnored private var accountGenerations: [JSKey: Int] = [:]
  @ObservationIgnored private var openCounter = 0
  @ObservationIgnored private var listeners: [Int: @MainActor () -> Void] = [:]
  @ObservationIgnored private var nextListener = 0
  @ObservationIgnored private let now: @MainActor () -> Double
  @ObservationIgnored private let staleAfter: Double

  /// `now` (epoch ms) is injectable for tests.
  public init(now: @escaping @MainActor () -> Double = { Date().timeIntervalSince1970 * 1000 }, staleMs: Double = LibraryStore.staleMs) {
    self.now = now
    staleAfter = staleMs
  }

  private func generationOf(_ did: String) -> Generation {
    Generation(all: generation, account: accountGenerations[JSKey(did)] ?? 0)
  }

  private func emit() {
    version += 1
    for (_, listener) in listeners.sorted(by: { $0.key < $1.key }) { listener() }
  }

  private func accountFor(_ did: String) -> Account {
    if let account = accounts[JSKey(did)] { return account }
    let account = Account()
    accounts[JSKey(did)] = account
    return account
  }

  // MARK: - Reading

  /// A shelf's entry, or the idle one.
  public func entry(_ did: String?, _ shelfId: String) -> LibraryEntry {
    _ = version
    guard let did else { return .idle }
    return accounts[JSKey(did)]?.shelves[shelfId] ?? .idle
  }

  /// Every shelf entry of an account, or nil before any.
  public func shelves(_ did: String?) -> [String: LibraryEntry]? {
    _ = version
    guard let did else { return nil }
    return accounts[JSKey(did)]?.shelves
  }

  /// The views of what an account's templates quote, or nil before any.
  public func embeds(_ did: String?) -> LibraryEmbedViews? {
    _ = version
    guard let did else { return nil }
    return accounts[JSKey(did)]?.embeds
  }

  /// `subscribe(listener)`: called after every change; returns the unsubscribe.
  @discardableResult
  public func subscribe(_ listener: @escaping @MainActor () -> Void) -> @MainActor () -> Void {
    let id = nextListener
    nextListener += 1
    listeners[id] = listener
    return { [weak self] in self?.listeners[id] = nil }
  }

  /// A fresh id for one opening of the dialog.
  public func nextOpen() -> Int {
    openCounter += 1
    return openCounter
  }

  /// Empties the store for one account, or for everyone; reads in flight
  /// for it land nowhere.
  public func reset(_ did: String? = nil) {
    if let did, !did.isEmpty {
      accountGenerations[JSKey(did), default: 0] += 1
      accounts[JSKey(did)] = nil
    } else {
      generation += 1
      accounts = [:]
    }
    emit()
  }

  // MARK: - Writing

  private func write(_ did: String, _ shelfId: String, _ gen: Generation, _ update: (inout LibraryEntry) -> Void) {
    guard gen == generationOf(did) else { return }
    let account = accountFor(did)
    var entry = account.shelves[shelfId] ?? .idle
    update(&entry)
    account.shelves[shelfId] = entry
    emit()
  }

  // MARK: - Loaders

  /// What a shelf's items are told apart by: a view's uri, a link's url.
  static func key(_ shelfId: String) -> String { shelfId == "links" ? "url" : "uri" }

  static func isLoader(_ shelfId: String) -> Bool { storeShelves.contains(shelfId) }

  static func hasMore(_ shelfId: String) -> Bool { isLoader(shelfId) && shelfId != "archive" }

  /// The first page of a shelf.
  static func first(_ shelfId: String, _ sources: any LibraryShelfSources) async throws -> LibraryPage {
    switch shelfId {
    case "archive": return LibraryPage(items: await sources.archive(), cursor: nil)
    case "posts": return try await sources.posts(cursor: nil)
    case "replies": return try await sources.replies(cursor: nil)
    case "saved": return try await sources.saved(cursor: nil)
    case "links": return try await sources.links(cursor: nil, seen: nil)
    case "feeds":
      // Saved feeds come with the first page only: one preferences read,
      // not a paged list.
      async let own = sources.feeds(cursor: nil)
      async let saved = sources.savedFeeds()
      let (page, list) = try await (own, saved)
      return LibraryPage(items: page.items, cursor: page.cursor, saved: list)
    default: return try await sources.lists(cursor: nil)
    }
  }

  /// The page after `entry`.
  static func more(_ shelfId: String, _ sources: any LibraryShelfSources, _ entry: LibraryEntry) async throws -> LibraryPage {
    switch shelfId {
    case "posts": return try await sources.posts(cursor: entry.cursor)
    case "replies": return try await sources.replies(cursor: entry.cursor)
    case "saved": return try await sources.saved(cursor: entry.cursor)
    case "links":
      return try await sources.links(cursor: entry.cursor, seen: (entry.data?.items ?? []).map { $0["url"] ?? .null })
    case "feeds": return try await sources.feeds(cursor: entry.cursor)
    default: return try await sources.lists(cursor: entry.cursor)
    }
  }

  /// `appendUnique(existing, added, key)`: items without a key, or with one
  /// already there, are left out.
  static func appendUnique(_ existing: [JSONValue], _ added: [JSONValue], key: String) -> [JSONValue] {
    var seen = LibrarySources.SeenLinks()
    for item in existing {
      if let k = item[key] { seen.insert(k) } else { seen.insert(.null) }
    }
    var out = existing
    for item in added {
      guard let k = item[key], k.isTruthy, !seen.contains(k) else { continue }
      seen.insert(k)
      out.append(item)
    }
    return out
  }

  // What a failed Load more reports: the failure's own message, or the fallback.
  static func failureMessage(_ error: any Error, _ fallback: String) -> String {
    let message = jsMessage(error)
    return message.isEmpty ? fallback : message
  }

  /// The first page of a shelf; `background` keeps what is shown while it reads.
  @discardableResult
  func load(_ did: String?, _ shelfId: String, _ sources: (any LibraryShelfSources)?, background: Bool = false) -> Task<Void, Never>? {
    guard Self.isLoader(shelfId), let did, !did.isEmpty, let sources else { return nil }
    let gen = generationOf(did)
    let seq = entry(did, shelfId).seq + 1
    // The new seq turns away any page still in flight, so its loadingMore goes too.
    write(did, shelfId, gen) { e in
      if background {
        e.refreshing = true
        e.loadingMore = false
        e.seq = seq
      } else {
        e.status = "loading"
        e.error = nil
        e.refreshing = false
        e.loadingMore = false
        e.loadMoreError = nil
        e.seq = seq
      }
    }
    return Task { @MainActor [weak self] in
      let result: Result<LibraryPage, any Error>
      do { result = .success(try await Self.first(shelfId, sources)) } catch { result = .failure(error) }
      guard let self, gen == self.generationOf(did), self.entry(did, shelfId).seq == seq else { return }
      switch result {
      case .success(let page):
        let items = Self.appendUnique([], page.items, key: Self.key(shelfId))
        let stamp = self.now()
        self.write(did, shelfId, gen) { e in
          var data = e.data ?? LibraryEntryData()
          data.items = items
          if let saved = page.saved { data.saved = saved }
          e.status = "ready"
          e.error = nil
          e.data = data
          e.cursor = page.cursor?.isEmpty == false ? page.cursor : nil
          e.fetchedAt = stamp
          e.refreshing = false
          e.loadingMore = false
          e.loadMoreError = nil
        }
      case .failure(let error):
        // A failed refresh keeps the copy on screen; the next open tries again.
        self.write(did, shelfId, gen) { e in
          if background {
            e.refreshing = false
          } else {
            e.status = "error"
            e.error = error
            e.refreshing = false
          }
        }
      }
    }
  }

  /// Reads the page after what a shelf holds, deduping; a failure keeps
  /// the cursor so Load more can be tried again.
  public func loadMore(did: String?, shelfId: String, sources: (any LibraryShelfSources)?) async {
    guard let did, !did.isEmpty, Self.hasMore(shelfId), let sources else { return }
    let e = entry(did, shelfId)
    guard e.status == "ready", e.cursor?.isEmpty == false, !e.loadingMore, !e.refreshing else { return }
    let gen = generationOf(did)
    let seq = e.seq
    write(did, shelfId, gen) {
      $0.loadingMore = true
      $0.loadMoreError = nil
    }
    let result: Result<LibraryPage, any Error>
    do { result = .success(try await Self.more(shelfId, sources, e)) } catch { result = .failure(error) }
    guard gen == generationOf(did), entry(did, shelfId).seq == seq else { return }
    switch result {
    case .success(let page):
      write(did, shelfId, gen) { prev in
        var data = prev.data ?? LibraryEntryData()
        data.items = Self.appendUnique(prev.data?.items ?? [], page.items, key: Self.key(shelfId))
        prev.data = data
        prev.cursor = page.cursor?.isEmpty == false && !page.cursor.jsEquals(prev.cursor) ? page.cursor : nil
        prev.loadingMore = false
        prev.loadMoreError = nil
      }
    case .failure(let error):
      write(did, shelfId, gen) {
        $0.loadingMore = false
        $0.loadMoreError = Self.failureMessage(error, "Load failed")
      }
    }
  }

  /// Loads what isn't loaded. Within one open (`openId`) an entry is looked
  /// at once: an error stays until `retry` (a dialog that ensures on every
  /// render must not hammer a failing read), and a stale entry is refreshed
  /// in the background. An error from an earlier open is tried again.
  /// Gives the load it started, if any.
  @discardableResult
  public func ensure(did: String?, shelfId: String, sources: (any LibraryShelfSources)?, openId: Int?) -> Task<Void, Never>? {
    guard let did, !did.isEmpty, let sources, Self.isLoader(shelfId) else { return nil }
    let account = accountFor(did)
    let key = "shelf:\(shelfId)"
    let e = entry(did, shelfId)
    let seenThisOpen = account.checked[key].map { $0 == openId } ?? false
    account.checked[key] = .some(openId)
    if e.status == "loading" || e.refreshing { return nil }
    if e.status == "idle" { return load(did, shelfId, sources) }
    if seenThisOpen { return nil }
    if e.status == "error" { return load(did, shelfId, sources) }
    if !e.loadingMore && now() - e.fetchedAt >= staleAfter { return load(did, shelfId, sources, background: true) }
    return nil
  }

  /// Reads a shelf again: in the background when it has something to show.
  public func retry(did: String?, shelfId: String, sources: (any LibraryShelfSources)?) async {
    let e = entry(did, shelfId)
    guard Self.isLoader(shelfId), e.status != "loading", !e.refreshing else { return }
    await load(did, shelfId, sources, background: e.status == "ready")?.value
  }

  /// Reads the views of what `templates` quote, at most once per five
  /// minutes per URI, and keeps them under `embeds(did)`. A URI the read
  /// couldn't settle keeps what it had.
  public func hydrateTemplateEmbeds<T: TemplateFields>(
    did: String?, sources: (any LibraryShelfSources)?, templates: [T]?
  ) async {
    guard let did, !did.isEmpty, let sources else { return }
    let account = accountFor(did)
    let at = now()
    var uris: [String] = []
    for template in templates ?? [] {
      let embed = template.templateField("embed")
      guard Library.isString(embed?["$type"], Self.recordEmbed), let uri = embed?["record"]?["uri"]?.stringValue,
        !uri.isEmpty, !uris.contains(where: { $0.jsEquals(uri) }), !account.embedsPending.contains(JSKey(uri))
      else { continue }
      if let seen = account.embedsAt[JSKey(uri)], at - seen < staleAfter { continue }
      uris.append(uri)
    }
    if uris.isEmpty { return }
    let gen = generationOf(did)
    for uri in uris { account.embedsPending.insert(JSKey(uri)) }
    let found: LibraryEmbedViews
    do {
      found = try await sources.hydrateEmbeds(uris.map(JSONValue.string))
    } catch {
      if gen == generationOf(did) { for uri in uris { account.embedsPending.remove(JSKey(uri)) } }
      return
    }
    guard gen == generationOf(did) else { return }
    for uri in uris { account.embedsPending.remove(JSKey(uri)) }
    if found.isEmpty { return }
    let stamp = now()
    for entry in found.entries { account.embedsAt[JSKey(entry.uri)] = stamp }
    account.embeds = account.embeds.merging(found)
    emit()
  }
}
