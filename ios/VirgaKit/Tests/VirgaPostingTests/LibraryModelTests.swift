// Behaviour of LibraryModel (src/posting/library/useLibrary.js): the cases
// of useLibrary.test.js, then the effects the hook runs (the reply's
// sources, the author-feed fallback, template quotes, the debounced
// search) and the frozen suggestions. The store's reads finish when the
// test awaits the loads it hands back or releases a gate; the search's
// debounce fires when the test fires it.

import Foundation
import Testing
import VirgaArchive
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaPosting

/// The session as the library needs it: no agent, and the accounts' handles.
final class FakeLibrarySession: LibrarySession, @unchecked Sendable {
  let handles: [String: String]
  init(_ handles: [String: String] = [selfDid: "me.example"]) { self.handles = handles }
  func libraryAgent(for did: String) async throws -> XRPCAgent? { nil }
  func libraryHandle(for did: String) -> String? { handles[did] }
}

/// setTimeout the test fires itself.
@MainActor final class ManualTimers {
  private(set) var pending: [(id: Int, ms: Double, action: @MainActor () -> Void)] = []
  private var next = 0

  var schedule: LibrarySchedule {
    { [weak self] ms, action in
      guard let self else { return LibraryTimerHandle {} }
      let id = self.next
      self.next += 1
      self.pending.append((id, ms, action))
      return LibraryTimerHandle { [weak self] in
        MainActor.assumeIsolated { self?.pending.removeAll { $0.id == id } }
      }
    }
  }

  /// Runs every timer that is due, in the order they were set.
  func fire() {
    let due = pending
    pending = []
    for timer in due { timer.action() }
  }
}

let libraryRows: [JSONValue] = [
  [
    "uri": "at://did:plc:self/app.bsky.feed.post/a", "at": "2026-10-01T00:00:00Z", "text": "Clouds over the ridge",
    "replyTo": .null, "likes": 9,
  ],
  [
    "uri": "at://did:plc:self/app.bsky.feed.post/b", "at": "2026-10-03T00:00:00Z", "text": "A reply",
    "replyTo": "did:plc:other", "likes": 1,
  ],
]

/// useLibrary.test.js's sources.
func hookSources() -> FakeShelfSources {
  let sources = FakeShelfSources()
  sources.onArchive = { libraryRows }
  sources.onPosts = { _ in LibraryPage() }
  sources.onSaved = { _ in LibraryPage() }
  sources.onLinks = { _, _ in LibraryPage(items: [["url": "https://docs.example/a", "title": "Docs"]]) }
  sources.onFeeds = { _ in LibraryPage() }
  sources.onSavedFeeds = { [] }
  sources.onHydrateEmbeds = { _ in LibraryEmbedViews() }
  sources.onHydrateAttachment = { attach in
    var out = attach
    out.cid = "fresh"
    out.view = ["uri": .string(attach.uri ?? "")]
    return out
  }
  return sources
}

let wrenReply: JSONValue = [
  "uri": "at://did:plc:other/app.bsky.feed.post/p", "cid": "c",
  "author": ["handle": "wren.example", "displayName": "Wren"], "text": "Why does stamina drain so fast on moth walks?",
]

@MainActor @Suite struct LibraryModelBehaviour {
  let usage = InMemoryKeyValueStore()
  let service = TemplateService(store: nil, target: nil, locale: "en-US")
  let templateSession = FakeTemplatesSession()
  let timers = ManualTimers()

  func environment() -> LibraryEnvironment {
    LibraryEnvironment(
      openStore: { _ in throw ArchiveUnreadable() }, usageStore: usage, now: { fixtureDate(.string(libraryNow)) },
      locale: "en-US", timeZone: TimeZone(identifier: "UTC")!, schedule: timers.schedule)
  }

  func model(
    did: String? = selfDid, reply: JSONValue? = nil, sources: FakeShelfSources? = nil, store: LibraryStore = LibraryStore(),
    quoteSlotLocked: Bool = false
  ) -> LibraryModel {
    LibraryModel(
      session: FakeLibrarySession(), templates: TemplatesModel(session: templateSession, did: did, service: service),
      did: did, reply: reply, quoteSlotLocked: quoteSlotLocked, sources: sources, store: store,
      environment: environment())
  }

  @Test func showsTheShelvesAStoreAlreadyHoldsFromTheWriteAccountsArchive() async {
    let store = LibraryStore()
    let src = hookSources()
    await store.ensure(did: selfDid, shelfId: "archive", sources: src, openId: 0)?.value
    await store.ensure(did: selfDid, shelfId: "links", sources: src, openId: 0)?.value

    let lib = model(sources: src, store: store)
    #expect(lib.shelves.map(\.id) == ["templates", "posts", "replies", "saved", "links", "feeds", "lists", "search"])
    #expect(lib.postsFrom == "archive")
    #expect(lib.items("posts").map(\.uri) == ["at://did:plc:self/app.bsky.feed.post/a"])
    #expect(lib.items("replies").map(\.uri) == ["at://did:plc:self/app.bsky.feed.post/b"])
    #expect(lib.items("links").first?.kind == "link")
    #expect(lib.items("links").first?.url == "https://docs.example/a")
    let posts = lib.shelves.first { $0.id == "posts" }
    #expect(posts?.status == "ready")
    #expect(posts?.count == 1)
    #expect(posts?.total == 1)
    let saved = lib.shelves.first { $0.id == "saved" }
    #expect(saved?.status == "idle")
    #expect(saved?.count == nil)
    #expect(!lib.hasMore("posts"))
    #expect(lib.context.my?.handle == "me.example")
    #expect(lib.suggested == LibrarySuggestions(status: "ready", items: []))
  }

  @Test func opensOnForThisReplyWhileReplyingAndWaitsForItsSources() {
    let lib = model(reply: wrenReply, sources: hookSources())
    #expect(lib.shelves.first?.id == "suggested")
    #expect(lib.suggested.status == "loading")
    #expect(lib.context.their?.firstName == "Wren")
  }

  @Test func makesAPlanWhoseAttachmentIsReadAgainBeforeItsAttached() async throws {
    let src = hookSources()
    let seen = Locked<[LibraryAttachment]>([])
    let base = src.onHydrateAttachment
    src.onHydrateAttachment = { attach in
      seen.withLock { $0.append(attach) }
      return try await base(attach)
    }
    let lib = model(sources: src)
    let uri = "at://did:plc:self/app.bsky.feed.post/a"
    let plan = try await lib.planFor(LibraryItem(json: ["kind": "post", "uri": .string(uri), "cid": .null, "title": "Clouds"]))
    #expect(seen.wrappedValue == [LibraryAttachment(kind: "post", uri: uri, cid: nil)])
    #expect(plan.attach == LibraryAttachment(kind: "post", uri: uri, cid: "fresh", view: ["uri": .string(uri)]))
    #expect(plan.title == "Clouds")
  }

  @Test func leavesCountingATemplatesUseToTheComposerWhichAppliesThePlan() async throws {
    let lib = model(sources: hookSources())
    let plan = try await lib.planFor(
      LibraryItem(json: [
        "kind": "template", "title": "Thanks",
        "source": ["rkey": "t1", "name": "Thanks", "text": "Thanks for the follow!", "variables": []],
      ]))
    #expect(plan.templateRkey == "t1")
    #expect(plan.insertText == "Thanks for the follow!")
    #expect(usage.allKeys().isEmpty)
  }

  @Test func readsNothingWithoutAnAccount() async {
    let lib = model(did: nil)
    #expect(lib.items("posts").isEmpty)
    #expect(lib.shelves.first { $0.id == "templates" }?.status == "idle")
    #expect(lib.sources == nil)
    lib.start()
    lib.ensure("saved")
    lib.setQuery("clouds")
    #expect(timers.pending.isEmpty)
    // Using something needs the account's reads: the web's calls on null
    // sources throw, for a pasted link as for a pick.
    await #expect(throws: LibrarySourcesError.self) { try await lib.resolveLink("https://docs.example/a") }
    await #expect(throws: LibrarySourcesError.self) { try await lib.hydrate(LibraryItem(kind: "post")) }
    lib.stop()
  }

  @Test func asksForTheReplysSourcesOnceOpenAndFreezesWhatItSuggests() async throws {
    let store = LibraryStore()
    let src = hookSources()
    let repo = FakeRepo(did: selfDid)
    repo.onList = { _ in
      [
        "records": [
          [
            "uri": "at://did:plc:self/net.anisota.feed.template/stamina", "cid": "c",
            "value": [
              "$type": "net.anisota.feed.template", "name": "Why stamina?", "text": "It refills over time.",
              "keywords": ["stamina"], "use": "reply", "createdAt": "2026-09-01T00:00:00.000Z",
            ],
          ]
        ]
      ]
    }
    templateSession.repos[selfDid] = repo
    src.onArchive = {
      [
        [
          "uri": "at://did:plc:self/app.bsky.feed.post/m", "at": "2026-10-01T00:00:00Z",
          "text": "Moth walks need patience and stamina", "replyTo": .null,
        ]
      ]
    }
    let lib = model(reply: wrenReply, sources: src, store: store)
    lib.start()
    // The effect asked for what "For this reply" compares with.
    #expect(store.entry(selfDid, "archive").status == "loading")
    #expect(store.entry(selfDid, "feeds").status == "loading")
    #expect(store.entry(selfDid, "lists").status == "loading")
    #expect(lib.suggested.status == "loading")
    _ = await lib.templates.effectLoad?.value
    await lib.settled()
    let first = lib.suggested
    #expect(first.status == "ready")
    #expect(first.items.map(\.id) == ["template:stamina", "post:at://did:plc:self/app.bsky.feed.post/m"])
    #expect(first.items.allSatisfy { $0.shelf == "suggested" })
    #expect(first.items[0].reason == "Their post mentions “stamina”")
    #expect(first.items[1].reason == "Shares “moth”, “walk” and “stamina” with their post")

    // A refresh that lands now doesn't reshuffle what is shown.
    src.onArchive = { [] }
    await store.retry(did: selfDid, shelfId: "archive", sources: src)
    await lib.settled()
    #expect(lib.postsFrom == "feed")
    #expect(lib.suggested.items.map(\.id) == first.items.map(\.id))
    lib.stop()
  }

  @Test func readsTheAuthorFeedOnlyOnceTheArchiveTurnsOutEmpty() async {
    let store = LibraryStore()
    let src = hookSources()
    let gate = Gate()
    src.onArchive = {
      await gate.wait()
      return []
    }
    src.onPosts = { _ in LibraryPage(items: [storeView("at://did:plc:self/app.bsky.feed.post/f")]) }
    let lib = model(sources: src, store: store)
    lib.start()
    lib.ensure("posts")
    #expect(store.entry(selfDid, "archive").status == "loading")
    #expect(src.count("posts") == 0)
    #expect(lib.postsFrom == nil)
    await gate.release()
    // The archive landing told the model, whose effect asked for the feed.
    await lib.settled()
    #expect(lib.postsFrom == "feed")
    #expect(store.entry(selfDid, "posts").status == "ready")
    #expect(lib.items("posts").map(\.uri) == ["at://did:plc:self/app.bsky.feed.post/f"])
    #expect(src.count("posts") == 1)
    #expect(src.count("replies") == 0)
    lib.stop()
  }

  @Test func searchesAMomentAfterTypingStopsAndOnlyForTwoLettersOrMore() async {
    let store = LibraryStore()
    let src = hookSources()
    let asked = Locked<[String]>([])
    src.onSearch = { q, mine, cursor in
      asked.withLock { $0.append("\(q)|\(mine)|\(cursor ?? "-")") }
      if cursor == nil {
        return LibraryPage(
          items: [storeView("at://did:plc:other/app.bsky.feed.post/1"), storeView("at://did:plc:self/app.bsky.feed.post/a")],
          cursor: "c1")
      }
      return LibraryPage(
        items: [storeView("at://did:plc:other/app.bsky.feed.post/1"), storeView("at://did:plc:other/app.bsky.feed.post/2")],
        cursor: "c1")
    }
    let lib = model(sources: src, store: store)
    lib.start()
    lib.setQuery("c")
    #expect(timers.pending.count == 1)
    lib.setQuery("clouds")
    #expect(timers.pending.count == 1)
    #expect(lib.localStatus == "loading")
    timers.fire()
    // The shelves search reads were asked for, and Bluesky searched.
    for id in LibraryModel.searchShelves { #expect(store.entry(selfDid, id).status != "idle") }
    #expect(lib.remoteSearch.status == "loading")
    await lib.searchTask?.value
    #expect(asked.wrappedValue == ["clouds|false|-"])
    #expect(lib.remoteSearch.status == "ready")
    #expect(lib.remoteSearch.hasMore)

    // The archive's own post is a local result, so the remote list leaves it out.
    await lib.settled()
    #expect(lib.localStatus == "ready")
    #expect(lib.local.map(\.id) == ["post:at://did:plc:self/app.bsky.feed.post/a"])
    #expect(lib.remoteSearch.posts.map(\.id) == ["post:at://did:plc:other/app.bsky.feed.post/1"])

    lib.loadMoreSearch()
    await lib.searchTask?.value
    #expect(asked.wrappedValue.last == "clouds|false|c1")
    #expect(
      lib.remoteSearch.posts.map(\.id) == [
        "post:at://did:plc:other/app.bsky.feed.post/1", "post:at://did:plc:other/app.bsky.feed.post/2",
      ])
    // A cursor handed back unchanged ends the search's pages.
    #expect(!lib.remoteSearch.hasMore)

    lib.setMine(true)
    await lib.searchTask?.value
    #expect(asked.wrappedValue.last == "clouds|true|-")

    // A "/shortcut" searches templates only; Bluesky's results go.
    lib.setQuery("/idea")
    #expect(timers.pending.isEmpty)
    #expect(lib.remoteSearch.status == "idle")
    lib.stop()
  }

  @Test func triesAFailedSearchAgainOnlyWhenAskedAndNotWhileTypingIsPending() async {
    let src = hookSources()
    let fail = Locked(true)
    let asked = Locked(0)
    src.onSearch = { _, _, _ in
      asked.withLock { $0 += 1 }
      if fail.wrappedValue { throw Offline(message: "Search is down") }
      return LibraryPage(items: [storeView("at://did:plc:other/app.bsky.feed.post/1")])
    }
    let lib = model(sources: src)
    lib.start()
    lib.setQuery("moths")
    timers.fire()
    await lib.searchTask?.value
    #expect(lib.remoteSearch.status == "error")
    #expect(lib.remoteSearch.error.map(jsMessage) == "Search is down")
    #expect(lib.shelves.first { $0.id == "search" }?.status == "error")
    fail.set(false)
    lib.setQuery("moths ")
    // The query still trims to "moths", but a new debounce is pending.
    lib.retrySearch()
    #expect(asked.wrappedValue == 1)
    timers.fire()
    await lib.searchTask?.value
    #expect(asked.wrappedValue == 2)
    #expect(lib.remoteSearch.status == "ready")
    lib.retrySearch()
    #expect(asked.wrappedValue == 2)
    lib.stop()
  }

  @Test func readsWhatTheTemplatesQuoteOncePerOpening() async {
    let store = LibraryStore()
    let src = hookSources()
    let asked = Locked<[[JSONValue]]>([])
    src.onHydrateEmbeds = { entries in
      asked.withLock { $0.append(entries) }
      var out = LibraryEmbedViews()
      for entry in entries { out[entry.stringValue!] = ["uri": entry, "author": ["handle": "me.example"]] }
      return out
    }
    let quoted = "at://did:plc:self/app.bsky.feed.post/q"
    let repo = FakeRepo(did: selfDid)
    repo.onList = { _ in
      [
        "records": [
          [
            "uri": "at://did:plc:self/net.anisota.feed.template/q", "cid": "c",
            "value": [
              "$type": "net.anisota.feed.template", "name": "Q", "text": "See this",
              "embed": ["$type": "app.bsky.embed.record", "record": ["uri": .string(quoted), "cid": "c"]],
              "createdAt": "2026-09-01T00:00:00.000Z",
            ],
          ]
        ]
      ]
    }
    templateSession.repos[selfDid] = repo
    let lib = model(sources: src, store: store)
    lib.start()
    _ = await lib.templates.effectLoad?.value
    await lib.settled()
    #expect(asked.wrappedValue == [[.string(quoted)]])
    #expect(lib.items("templates").first?.label == "Template · quotes a post")
    #expect(lib.items("templates").first?.embedView?["uri"] == .string(quoted))
    #expect(Library.effectFor(lib.items("templates").first, lib.context) == "Adds text and quotes your post")
    lib.stop()
  }

  @Test func showsMoreArchiveRowsWithLoadMoreAndSortsByEngagement() async {
    let store = LibraryStore()
    let src = hookSources()
    let rows: [JSONValue] = (0..<60).map { i in
      [
        "uri": .string("at://did:plc:self/app.bsky.feed.post/r\(i)"), "at": .string("2026-09-\(String(format: "%02d", i % 28 + 1))T00:00:00Z"),
        "text": .string("Row \(i)"), "likes": .number(Double(i % 7)),
      ]
    }
    src.onArchive = { rows }
    await store.ensure(did: selfDid, shelfId: "archive", sources: src, openId: 0)?.value
    let lib = model(sources: src, store: store)
    #expect(lib.items("posts").count == 50)
    #expect(lib.hasMore("posts"))
    lib.loadMore("posts")
    #expect(lib.items("posts").count == 60)
    #expect(!lib.hasMore("posts"))
    lib.setSort("engagement")
    #expect(lib.items("posts").first.map { Library.engagementScore($0.source) } == 6)
    lib.setSort("nonsense")
    #expect(lib.sort == "date")
  }

  @Test func aNewOpeningGetsANewIdAndAClosedOneNone() {
    let store = LibraryStore()
    let lib = model(store: store)
    let first = lib.openId
    #expect(first != nil)
    lib.setOpen(true)
    #expect(lib.openId == first)
    lib.setOpen(false)
    #expect(lib.openId == nil)
    lib.setOpen(true)
    #expect(lib.openId != nil)
    #expect(lib.openId != first)
  }
}

@Suite struct LibraryTypedRows {
  @Test func aTypedArchiveRowIsOnTheShelfItsJSONIsOn() throws {
    for c in try LibraryModelParity.cases("isOwnThreadRow") {
      guard let json = c.input["row"], let row = PostRow(json: json) else { continue }
      check(.bool(Library.isOwnThreadRow(row, c.string("selfDid"))), c)
    }
  }
}
