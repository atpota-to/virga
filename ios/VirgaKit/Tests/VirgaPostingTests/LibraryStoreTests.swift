// Parity for src/posting/library/store.js's pure helpers (fixture
// library.store), and its store (createLibraryStore) held to store.test.js
// by behaviour tests. Reads finish when a test releases them (Gate), and
// each test waits on the load the store hands back; nothing waits on yields
// or sleeps.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaPosting

/// A store entry as a fixture writes one (`{ status, data: { items, saved } }`).
func libraryEntry(_ value: JSONValue?) -> LibraryEntry? {
  guard let value, value.isTruthy else { return nil }
  let data = value["data"].flatMap { d -> LibraryEntryData? in
    guard d.isTruthy else { return nil }
    return LibraryEntryData(items: d["items"]?.arrayValue ?? [], saved: d["saved"]?.arrayValue)
  }
  return LibraryEntry(status: value["status"]?.stringValue ?? "idle", data: data)
}

/// The generator's `short`: items by id, shelf, label, group and embedView.
func shortShelf(_ items: [LibraryItem], sections: [LibrarySection]? = nil, total: Int?? = nil) -> JSONValue {
  var out: [String: JSONValue] = [
    "items": .array(
      items.map { item -> JSONValue in
        var out: [String: JSONValue] = [
          "id": .string(item.id), "shelf": .string(item.shelf), "label": .string(item.label),
          "embedView": item.embedView ?? "$undefined",
        ]
        if let group = item.group { out["group"] = .string(group) }
        return .object(out)
      })
  ]
  if let sections {
    out["sections"] = .array(
      sections.map {
        [
          "id": .string($0.id), "heading": $0.heading.map(JSONValue.string) ?? .null, "muted": .bool($0.muted),
          "items": json($0.items.map(\.id)),
        ]
      })
  }
  if let total { out["total"] = total.map { .number(Double($0)) } ?? .null }
  return .object(out)
}

@Suite struct LibraryStoreParity {
  static let f = "library.store"

  @Test func constants() throws {
    check(.number(LibraryStore.staleMs), try cases(Self.f, "STALE_MS")[0])
    check(json(LibraryStore.storeShelves), try cases(Self.f, "STORE_SHELVES")[0])
    let idle = LibraryEntry.idle
    let idleJSON: JSONValue = [
      "status": .string(idle.status), "error": .null, "data": .null, "cursor": .null,
      "fetchedAt": .number(idle.fetchedAt), "refreshing": .bool(idle.refreshing), "loadingMore": .bool(idle.loadingMore),
      "loadMoreError": .null, "seq": .number(Double(idle.seq)),
    ]
    check(idleJSON, try cases(Self.f, "IDLE_ENTRY")[0], strictNulls: true)
  }

  @Test func postsSource() throws {
    for c in try cases(Self.f, "postsSource") {
      check(json(LibraryStore.postsSource(libraryEntry(c.input["entry"]))), c)
    }
  }

  @Test func buildShelfItems() throws {
    for c in try cases(Self.f, "buildShelfItems") {
      let shelfId = c.string("shelfId") ?? ""
      let postsShelf = shelfId == "posts" || shelfId == "replies"
      let out = LibraryStore.buildShelfItems(
        shelfId, entry: libraryEntry(postsShelf ? c.input["feed"] : c.input["entry"]), archive: libraryEntry(c.input["archive"]),
        did: c.string("did"), sort: c.string("sort") ?? "date", query: c.string("query") ?? "",
        limit: c.input["limit"]?.doubleValue ?? 50, clock: libraryCase)
      check(shortShelf(out.items, total: .some(out.total)), c, strictNulls: true)
    }
  }

  @Test func templateShelf() throws {
    for c in try cases(Self.f, "templateShelf") {
      var embeds: LibraryEmbedViews?
      if let given = c.input["embeds"]?.objectValue {
        var views = LibraryEmbedViews()
        for (uri, view) in given { views[uri] = view }
        embeds = views
      }
      let shelf = LibraryStore.templateShelf(
        c.input["templates"]?.arrayValue, usage: c.input["usage"], context: TemplateContext(json: c.input["context"]),
        embeds: embeds, replying: c.input["replying"]?.isTruthy == true)
      check(shortShelf(shelf.items, sections: shelf.sections), c, strictNulls: true)
    }
  }

  @Test func templateShelfOverTypedTemplates() throws {
    // The app's path (PostTemplate and TemplateUsageCounts) sorts and groups
    // as the JSON one does.
    for c in try cases(Self.f, "templateShelf") where c.input["usage"] == nil && c.input["embeds"] == nil {
      let templates = (c.input["templates"]?.arrayValue ?? []).map { PostTemplate(json: $0) }
      let shelf = LibraryStore.templateShelf(
        c.input["templates"] == nil ? nil : templates, usage: nil, context: TemplateContext(json: c.input["context"]),
        embeds: nil, replying: c.input["replying"]?.isTruthy == true)
      check(shortShelf(shelf.items, sections: shelf.sections), c, strictNulls: true)
    }
  }

  @Test func remoteQueryFor() throws {
    for c in try cases(Self.f, "remoteQueryFor") {
      check(.string(LibraryStore.remoteQueryFor(jsText(c.input["query"]), minChars: c.input["minChars"]?.intValue ?? 2)), c)
    }
  }
}

// MARK: - The store's behaviour

/// Shelf sources whose reads the test scripts, counting every call.
final class FakeShelfSources: LibraryShelfSources, @unchecked Sendable {
  let did: String?
  let calls = Locked<[String]>([])
  var onArchive: @Sendable () async -> [JSONValue] = { [] }
  var onPosts: @Sendable (String?) async throws -> LibraryPage = { _ in
    LibraryPage(items: [storeView("at://did:plc:self/app.bsky.feed.post/p1")])
  }
  var onReplies: @Sendable (String?) async throws -> LibraryPage = { _ in LibraryPage() }
  var onSaved: @Sendable (String?) async throws -> LibraryPage = { _ in
    LibraryPage(items: [storeView("at://did:plc:other/app.bsky.feed.post/s1")], cursor: "next")
  }
  var onLinks: @Sendable (String?, [JSONValue]?) async throws -> LibraryPage = { _, _ in
    LibraryPage(items: [["url": "https://a.example"]])
  }
  var onFeeds: @Sendable (String?) async throws -> LibraryPage = { _ in
    LibraryPage(items: [["uri": "at://x/app.bsky.feed.generator/own"]])
  }
  var onSavedFeeds: @Sendable () async throws -> [JSONValue] = {
    [["uri": "at://x/app.bsky.feed.generator/own"], ["uri": "at://y/app.bsky.feed.generator/saved"]]
  }
  var onLists: @Sendable (String?) async throws -> LibraryPage = { _ in LibraryPage() }
  var onSearch: @Sendable (String, Bool, String?) async throws -> LibraryPage = { _, _, _ in LibraryPage() }
  var onHydrate: @Sendable (LibraryItem) async throws -> LibraryItem = { $0 }
  var onHydrateAttachment: @Sendable (LibraryAttachment) async throws -> LibraryAttachment = { $0 }
  var onHydrateEmbeds: @Sendable ([JSONValue]) async throws -> LibraryEmbedViews = { entries in
    var out = LibraryEmbedViews()
    for entry in entries { if let uri = entry.stringValue { out[uri] = ["uri": .string(uri)] } }
    return out
  }
  var onResolveLink: @Sendable (String) async throws -> LibraryItem? = { _ in nil }

  init(did: String? = "did:plc:self") { self.did = did }

  func count(_ name: String) -> Int { calls.wrappedValue.filter { $0 == name }.count }
  private func note(_ name: String) { calls.withLock { $0.append(name) } }

  func archive() async -> [JSONValue] {
    note("archive")
    return await onArchive()
  }
  func posts(cursor: String?) async throws -> LibraryPage {
    note("posts")
    return try await onPosts(cursor)
  }
  func replies(cursor: String?) async throws -> LibraryPage {
    note("replies")
    return try await onReplies(cursor)
  }
  func saved(cursor: String?) async throws -> LibraryPage {
    note("saved")
    return try await onSaved(cursor)
  }
  func links(cursor: String?, seen: [JSONValue]?) async throws -> LibraryPage {
    note("links")
    return try await onLinks(cursor, seen)
  }
  func feeds(cursor: String?) async throws -> LibraryPage {
    note("feeds")
    return try await onFeeds(cursor)
  }
  func savedFeeds() async throws -> [JSONValue] {
    note("savedFeeds")
    return try await onSavedFeeds()
  }
  func lists(cursor: String?) async throws -> LibraryPage {
    note("lists")
    return try await onLists(cursor)
  }
  func search(_ query: String, mine: Bool, cursor: String?) async throws -> LibraryPage {
    note("search")
    return try await onSearch(query, mine, cursor)
  }
  func hydrate(_ item: LibraryItem) async throws -> LibraryItem {
    note("hydrate")
    return try await onHydrate(item)
  }
  func hydrateAttachment(_ attach: LibraryAttachment) async throws -> LibraryAttachment {
    note("hydrateAttachment")
    return try await onHydrateAttachment(attach)
  }
  func hydrateEmbeds(_ entries: [JSONValue]) async throws -> LibraryEmbedViews {
    note("hydrateEmbeds")
    return try await onHydrateEmbeds(entries)
  }
  func resolveLink(_ input: String) async throws -> LibraryItem? {
    note("resolveLink")
    return try await onResolveLink(input)
  }
}

func storeView(_ uri: String, _ extra: [String: JSONValue] = [:]) -> JSONValue {
  var out: [String: JSONValue] = [
    "uri": .string(uri), "cid": .string("cid-\(uri.split(separator: "/").last ?? "")"),
    "author": ["did": .string(String(uri.split(separator: "/")[1])), "handle": "h.example"],
    "record": ["text": "x", "createdAt": "2026-10-01T00:00:00Z"],
  ]
  for (key, value) in extra { out[key] = value }
  return .object(out)
}

struct Offline: Error, LocalizedError {
  var message = "offline"
  var errorDescription: String? { message }
}

/// A value a test hands a read once it chooses to.
actor Handoff<Value: Sendable> {
  private var value: Value?
  private var waiters: [CheckedContinuation<Value, Never>] = []

  func take() async -> Value {
    if let value { return value }
    return await withCheckedContinuation { waiters.append($0) }
  }

  func give(_ v: Value) {
    value = v
    for waiter in waiters { waiter.resume(returning: v) }
    waiters = []
  }
}

let selfDid = "did:plc:self"
let otherDid = "did:plc:other"

@MainActor @Suite struct LibraryStoreBehaviour {
  @Test func loadsAShelfTheFirstTimeItIsAskedForAndTellsSubscribers() async {
    let store = LibraryStore()
    let sources = FakeShelfSources()
    var heard = 0
    store.subscribe { heard += 1 }
    let open = store.nextOpen()
    let load = store.ensure(did: selfDid, shelfId: "saved", sources: sources, openId: open)
    #expect(store.entry(selfDid, "saved").status == "loading")
    await load?.value
    #expect(store.entry(selfDid, "saved").status == "ready")
    #expect(store.entry(selfDid, "saved").cursor == "next")
    #expect(store.entry(selfDid, "saved").data?.items.count == 1)
    #expect(heard > 0)
    #expect(store.ensure(did: selfDid, shelfId: "saved", sources: sources, openId: open) == nil)
    #expect(sources.count("saved") == 1)
  }

  @Test func keepsEachAccountsShelvesApart() async {
    let store = LibraryStore()
    let mine = FakeShelfSources()
    let theirs = FakeShelfSources(did: otherDid)
    theirs.onLinks = { _, _ in LibraryPage(items: [["url": "https://b.example"]]) }
    let a = store.ensure(did: selfDid, shelfId: "links", sources: mine, openId: 1)
    let b = store.ensure(did: otherDid, shelfId: "links", sources: theirs, openId: 1)
    await a?.value
    await b?.value
    #expect(store.entry(selfDid, "links").data?.items.first?["url"] == "https://a.example")
    #expect(store.entry(otherDid, "links").data?.items.first?["url"] == "https://b.example")
  }

  @Test func readsAStaleShelfAgainInTheBackgroundOnTheNextOpenKeepingWhatIsShown() async {
    let t = Locked<Double>(0)
    let store = LibraryStore(now: { t.wrappedValue })
    let gate = Gate()
    let calls = Locked(0)
    let sources = FakeShelfSources()
    sources.onLinks = { _, _ in
      let n = calls.withLock { $0 += 1; return $0 }
      if n == 2 { await gate.wait() }
      return LibraryPage(items: [["url": .string("https://v\(n).example")]])
    }
    await store.ensure(did: selfDid, shelfId: "links", sources: sources, openId: 1)?.value
    // Fresh: a new open doesn't read it again.
    #expect(store.ensure(did: selfDid, shelfId: "links", sources: sources, openId: 2) == nil)
    #expect(sources.count("links") == 1)

    t.set(LibraryStore.staleMs)
    let refresh = store.ensure(did: selfDid, shelfId: "links", sources: sources, openId: 3)
    #expect(store.entry(selfDid, "links").status == "ready")
    #expect(store.entry(selfDid, "links").refreshing)
    #expect(store.entry(selfDid, "links").data?.items.first?["url"] == "https://v1.example")
    await gate.release()
    await refresh?.value
    #expect(!store.entry(selfDid, "links").refreshing)
    #expect(store.entry(selfDid, "links").data?.items.first?["url"] == "https://v2.example")
  }

  @Test func keepsAnErrorUntilRetriedWithinAnOpenAndTriesAgainOnTheNext() async {
    let store = LibraryStore()
    let sources = FakeShelfSources()
    sources.onLists = { _ in throw Offline() }
    await store.ensure(did: selfDid, shelfId: "lists", sources: sources, openId: 1)?.value
    #expect(store.entry(selfDid, "lists").status == "error")
    #expect(store.entry(selfDid, "lists").error.map(jsMessage) == "offline")
    #expect(store.ensure(did: selfDid, shelfId: "lists", sources: sources, openId: 1) == nil)
    #expect(sources.count("lists") == 1)
    await store.ensure(did: selfDid, shelfId: "lists", sources: sources, openId: 2)?.value
    #expect(sources.count("lists") == 2)
    await store.retry(did: selfDid, shelfId: "lists", sources: sources)
    #expect(sources.count("lists") == 3)
  }

  @Test func anOpenWithNoIdHasSeenAShelfThatWasOnlyRetried() async {
    // `account.checked[key] === openId`: a shelf never ensured reads as
    // undefined, and so does an open with no id, so it counts as looked at.
    let store = LibraryStore()
    let sources = FakeShelfSources()
    sources.onLists = { _ in throw Offline() }
    await store.retry(did: selfDid, shelfId: "lists", sources: sources)
    #expect(store.entry(selfDid, "lists").status == "error")
    #expect(store.ensure(did: selfDid, shelfId: "lists", sources: sources, openId: nil) == nil)
    #expect(sources.count("lists") == 1)
    // A numbered open tries the error again.
    await store.ensure(did: selfDid, shelfId: "lists", sources: sources, openId: 1)?.value
    #expect(sources.count("lists") == 2)
  }

  @Test func keepsTheCopyOnScreenWhenABackgroundRefreshFails() async {
    let t = Locked<Double>(0)
    let store = LibraryStore(now: { t.wrappedValue })
    let fail = Locked(false)
    let sources = FakeShelfSources()
    sources.onLinks = { _, _ in
      if fail.wrappedValue { throw Offline() }
      return LibraryPage(items: [["url": "https://kept.example"]])
    }
    await store.ensure(did: selfDid, shelfId: "links", sources: sources, openId: 1)?.value
    fail.set(true)
    t.set(LibraryStore.staleMs)
    await store.ensure(did: selfDid, shelfId: "links", sources: sources, openId: 2)?.value
    #expect(store.entry(selfDid, "links").status == "ready")
    #expect(!store.entry(selfDid, "links").refreshing)
    #expect(store.entry(selfDid, "links").error == nil)
    #expect(store.entry(selfDid, "links").data?.items.first?["url"] == "https://kept.example")
  }

  @Test func loadsMoreDedupingAndKeepsTheCursorToTryAgainAfterAFailure() async {
    let store = LibraryStore()
    let pages = Locked(0)
    let sources = FakeShelfSources()
    let a = "at://did:plc:other/app.bsky.feed.post/a"
    let b = "at://did:plc:other/app.bsky.feed.post/b"
    sources.onSaved = { cursor in
      pages.withLock { $0 += 1 }
      if cursor == "c2" { throw Offline(message: "Rate limited") }
      if cursor == nil { return LibraryPage(items: [storeView(a)], cursor: "c1") }
      return LibraryPage(items: [storeView(a), storeView(b)], cursor: "c2")
    }
    await store.ensure(did: selfDid, shelfId: "saved", sources: sources, openId: 1)?.value
    await store.loadMore(did: selfDid, shelfId: "saved", sources: sources)
    #expect(store.entry(selfDid, "saved").data?.items.compactMap { $0["uri"]?.stringValue } == [a, b])
    #expect(store.entry(selfDid, "saved").cursor == "c2")
    await store.loadMore(did: selfDid, shelfId: "saved", sources: sources)
    let e = store.entry(selfDid, "saved")
    #expect(!e.loadingMore)
    #expect(e.loadMoreError == "Rate limited")
    #expect(e.cursor == "c2")
    #expect(pages.wrappedValue == 3)
    // The archive has no further pages.
    await store.loadMore(did: selfDid, shelfId: "archive", sources: sources)
    #expect(sources.count("archive") == 0)
  }

  @Test func aCursorHandedBackUnchangedEndsTheShelf() async {
    let store = LibraryStore()
    let sources = FakeShelfSources()
    sources.onSaved = { _ in LibraryPage(items: [storeView("at://did:plc:other/app.bsky.feed.post/a")], cursor: "same") }
    await store.ensure(did: selfDid, shelfId: "saved", sources: sources, openId: 1)?.value
    #expect(store.entry(selfDid, "saved").cursor == "same")
    await store.loadMore(did: selfDid, shelfId: "saved", sources: sources)
    #expect(store.entry(selfDid, "saved").cursor == nil)
    #expect(store.entry(selfDid, "saved").data?.items.count == 1)
  }

  @Test func readsFeedsWithTheSavedOnesBesideThem() async {
    let store = LibraryStore()
    let sources = FakeShelfSources()
    await store.ensure(did: selfDid, shelfId: "feeds", sources: sources, openId: 1)?.value
    #expect(store.entry(selfDid, "feeds").data?.saved?.count == 2)
    #expect(sources.count("feeds") == 1)
    #expect(sources.count("savedFeeds") == 1)
  }

  @Test func letsNothingLandAfterAReset() async {
    let store = LibraryStore()
    let handoff = Handoff<LibraryPage>()
    let sources = FakeShelfSources()
    sources.onLinks = { _, _ in await handoff.take() }
    let load = store.ensure(did: selfDid, shelfId: "links", sources: sources, openId: 1)
    store.reset()
    await handoff.give(LibraryPage(items: [["url": "https://late.example"]]))
    await load?.value
    #expect(store.entry(selfDid, "links").status == "idle")
    #expect(store.shelves(selfDid) == nil)
  }

  @Test func resetsOneAccountWithoutStrandingAnothersReadsInFlight() async {
    let store = LibraryStore()
    let mine = Handoff<LibraryPage>()
    let theirs = Handoff<LibraryPage>()
    let embeds = Handoff<LibraryEmbedViews>()
    let quoted = "at://did:plc:self/app.bsky.feed.post/q"
    let sources = FakeShelfSources()
    sources.onLinks = { _, _ in await mine.take() }
    sources.onHydrateEmbeds = { _ in await embeds.take() }
    let others = FakeShelfSources(did: otherDid)
    others.onLinks = { _, _ in await theirs.take() }

    let myLoad = store.ensure(did: selfDid, shelfId: "links", sources: sources, openId: 1)
    let template: JSONValue = ["embed": ["$type": "app.bsky.embed.record", "record": ["uri": .string(quoted), "cid": "c"]]]
    let hydrating = Task { await store.hydrateTemplateEmbeds(did: selfDid, sources: sources, templates: [template]) }
    let theirLoad = store.ensure(did: otherDid, shelfId: "links", sources: others, openId: 1)

    store.reset(otherDid)
    await mine.give(LibraryPage(items: [["url": "https://mine.example"]]))
    await theirs.give(LibraryPage(items: [["url": "https://theirs.example"]]))
    var found = LibraryEmbedViews()
    found[quoted] = ["uri": .string(quoted)]
    await embeds.give(found)
    await hydrating.value
    await myLoad?.value
    await theirLoad?.value

    #expect(store.entry(selfDid, "links").status == "ready")
    #expect(store.entry(selfDid, "links").data?.items.first?["url"] == "https://mine.example")
    #expect(store.embeds(selfDid)?[quoted] == ["uri": .string(quoted)])
    #expect(store.entry(otherDid, "links").status == "idle")
    // The reset account loads again when next asked.
    await store.ensure(did: otherDid, shelfId: "links", sources: FakeShelfSources(did: otherDid), openId: 2)?.value
    #expect(store.entry(otherDid, "links").status == "ready")
  }

  @Test func readsWhatTemplatesQuoteOncePerFiveMinutesKeepingWhatAFailedReadHad() async {
    let t = Locked<Double>(0)
    let store = LibraryStore(now: { t.wrappedValue })
    let quoted = "at://did:plc:self/app.bsky.feed.post/q"
    let templates: [JSONValue] = [
      ["embed": ["$type": "app.bsky.embed.record", "record": ["uri": .string(quoted), "cid": "c"]]],
      ["embed": ["$type": "app.bsky.embed.external", "external": ["uri": "https://a"]]],
    ]
    let asked = Locked<[[JSONValue]]>([])
    let empty = Locked(false)
    let sources = FakeShelfSources()
    sources.onHydrateEmbeds = { entries in
      asked.withLock { $0.append(entries) }
      if empty.wrappedValue { return LibraryEmbedViews() }
      var out = LibraryEmbedViews()
      for entry in entries { out[entry.stringValue!] = ["uri": entry] }
      return out
    }
    await store.hydrateTemplateEmbeds(did: selfDid, sources: sources, templates: templates)
    #expect(asked.wrappedValue == [[.string(quoted)]])
    #expect(store.embeds(selfDid)?[quoted] == ["uri": .string(quoted)])
    await store.hydrateTemplateEmbeds(did: selfDid, sources: sources, templates: templates)
    #expect(asked.wrappedValue.count == 1)
    t.set(LibraryStore.staleMs)
    empty.set(true)
    await store.hydrateTemplateEmbeds(did: selfDid, sources: sources, templates: templates)
    #expect(asked.wrappedValue.count == 2)
    #expect(store.embeds(selfDid)?[quoted] == ["uri": .string(quoted)])
  }

  @Test func aShelfStillLoadingIsNotAskedForAgainAndAnUnknownShelfIsNeverRead() async {
    let store = LibraryStore()
    let gate = Gate()
    let sources = FakeShelfSources()
    sources.onLists = { _ in
      await gate.wait()
      return LibraryPage()
    }
    let load = store.ensure(did: selfDid, shelfId: "lists", sources: sources, openId: 1)
    #expect(store.ensure(did: selfDid, shelfId: "lists", sources: sources, openId: 2) == nil)
    await store.retry(did: selfDid, shelfId: "lists", sources: sources)
    #expect(store.ensure(did: selfDid, shelfId: "search", sources: sources, openId: 1) == nil)
    #expect(store.ensure(did: nil, shelfId: "lists", sources: sources, openId: 1) == nil)
    #expect(store.ensure(did: selfDid, shelfId: "lists", sources: nil, openId: 1) == nil)
    await gate.release()
    await load?.value
    // Started before the gate opened, the one load is the only read.
    let reads = sources.count("lists")
    #expect(reads == 1)
  }

  @Test func aRefreshOfAShownShelfReadsInTheBackgroundAndLoadMoreWaitsForIt() async {
    let store = LibraryStore()
    let gate = Gate()
    let calls = Locked(0)
    let sources = FakeShelfSources()
    sources.onSaved = { cursor in
      let n = calls.withLock { $0 += 1; return $0 }
      if n == 2 { await gate.wait() }
      return LibraryPage(items: [storeView("at://did:plc:other/app.bsky.feed.post/\(n)")], cursor: "c\(n)")
    }
    await store.ensure(did: selfDid, shelfId: "saved", sources: sources, openId: 1)?.value
    // retry's load: the entry is marked refreshing before the read begins.
    let refresh = store.load(selfDid, "saved", sources, background: true)
    #expect(store.entry(selfDid, "saved").refreshing)
    #expect(store.entry(selfDid, "saved").status == "ready")
    await store.loadMore(did: selfDid, shelfId: "saved", sources: sources)
    await store.retry(did: selfDid, shelfId: "saved", sources: sources)
    await gate.release()
    await refresh?.value
    #expect(calls.wrappedValue == 2)
    #expect(store.entry(selfDid, "saved").cursor == "c2")
    #expect(store.entry(selfDid, "saved").status == "ready")
  }
}
