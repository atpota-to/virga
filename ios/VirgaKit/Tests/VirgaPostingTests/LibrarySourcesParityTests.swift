// Parity for src/posting/library/sources.js (fixture library.sources, its
// network calls replayed from the recorded exchanges) and
// src/posting/library/libraryUi.js (fixture library.ui).

import Foundation
import Testing
import VirgaArchive
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaPosting

/// An archive store holding `rows` in its posts store, read only.
final class FakeArchiveStore: AnalyticsStoreHandle, @unchecked Sendable {
  let rows: [JSONValue]
  init(_ rows: [JSONValue]) { self.rows = rows }
  var persistent: Bool { true }
  var blocked: Bool { false }
  func all(_ store: String) async -> [JSONValue] { store == "posts" ? rows : [] }
  func putAll(_ store: String, _ rows: [JSONValue]) async { Issue.record("the library wrote to the archive") }
  func remove(_ store: String, _ keys: [JSONValue]) async { Issue.record("the library wrote to the archive") }
  func clear(_ store: String) async { Issue.record("the library wrote to the archive") }
  func getMeta(_ key: String) async -> JSONValue? { nil }
  func setMeta(_ key: String, _ facts: JSONValue) async { Issue.record("the library wrote to the archive") }
}

struct ArchiveUnreadable: Error {}

/// A stand-in for publish/linkCard.js's fetchLinkCard (another chain's
/// port), as far as these fixtures need it: the card service's answer as
/// `{ url, title, description, thumb }`, or nil.
func fetchLinkCardStandIn(_ transport: any HTTPTransport) -> FetchLinkCard {
  { url in
    guard RichText.safeExternalUrl(url) != nil else { return nil }
    do {
      let res = try await transport.send(
        HTTPRequest(url: "https://cardyb.bsky.app/v1/extract?url=\(JSURI.encodeURIComponent(url))", timeoutMs: 10_000))
      guard res.ok, let data = try? res.json(), data.isTruthy, data["error"]?.isTruthy != true else { return nil }
      return [
        "url": .string(url), "title": .string(TemplateJS.orEmpty(data["title"]).jsSlice(0, 200)),
        "description": .string(TemplateJS.orEmpty(data["description"]).jsSlice(0, 500)),
        "thumb": RichText.safeExternalUrl(data["image"]).map(JSONValue.string) ?? .null,
      ]
    } catch {
      if Task.isCancelled { throw error }
      return nil
    }
  }
}

/// The generator's `recorded`: a value, or the error's message, code and status.
func libraryOutcome(_ body: () async throws -> JSONValue) async -> JSONValue {
  do {
    return ["value": try await body()]
  } catch {
    var code: JSONValue = .null
    var status: JSONValue = .null
    if let e = error as? LibraryPickError { code = .string(e.code) }
    if let e = error as? PublicXrpcError { status = .number(Double(e.status)) }
    if let e = error as? XRPCError { status = .number(Double(e.status)) }
    return ["error": ["message": .string(jsMessage(error)), "code": code, "status": status]]
  }
}

/// Replays a recorded case: `run` gets the transport answering the
/// recorded requests and gives the result as the generator recorded it.
func expectLibraryReplay(
  _ c: ParityCase, ordered: Bool = true, sourceLocation: SourceLocation = #_sourceLocation,
  _ run: (MockTransport) async -> JSONValue
) async {
  let recording = RecordedFetch(c.output)
  let transport = recording.transport()
  let result = await run(transport)
  let d = recording.check(sent: transport.requests, result: result, ordered: ordered)
  #expect(d == nil, "\(c): \(d ?? "")", sourceLocation: sourceLocation)
}

let libraryService = "https://pds.example"
let libraryCase = LibraryClock(
  now: fixtureDate(.string(libraryNow)), locale: "en-US", timeZone: TimeZone(identifier: "UTC")!)

@Suite struct LibrarySourcesParity {
  static let f = "library.sources"

  @Test func readArchivePosts() async throws {
    for c in try cases(Self.f, "readArchivePosts") {
      let read = Locked<[String]>([])
      let rows = c.input["rows"]?.arrayValue ?? []
      let fails = c.input["fails"]?.isTruthy == true
      let out = await LibrarySources.readArchivePosts(c.string("did")) { did in
        read.withLock { $0.append(did) }
        if fails { throw ArchiveUnreadable() }
        return FakeArchiveStore(rows)
      }
      check(["out": .array(out), "read": json(read.wrappedValue)], c)
    }
  }

  @Test func archiveShelf() throws {
    for c in try cases(Self.f, "archiveShelf") {
      let shelf = LibrarySources.archiveShelf(
        c.input["rows"]?.arrayValue, did: c.string("did"), replies: c.input["replies"]?.isTruthy == true,
        sort: c.string("sort") ?? "date", query: c.string("query") ?? "", limit: c.input["limit"]?.doubleValue ?? 50,
        clock: LibraryClock(now: libraryCase.now, locale: "en-US", timeZone: TimeZone(identifier: c.string("zone") ?? "UTC")!))
      check(shelf.json, c, strictNulls: true)
    }
  }

  @Test func fetchOwnPosts() async throws {
    for c in try cases(Self.f, "fetchOwnPosts") {
      await expectLibraryReplay(c) { transport in
        await libraryOutcome {
          try await LibrarySources.fetchOwnPosts(
            c.string("did"), cursor: c.string("cursor"), replies: c.input["replies"]?.isTruthy == true,
            transport: transport
          ).json
        }
      }
    }
  }

  @Test func signedInReads() async throws {
    for c in try cases(Self.f, "fetchBookmarks") {
      await expectLibraryReplay(c) { transport in
        await libraryOutcome {
          let agent = c.input["noAgent"]?.isTruthy == true ? nil : XRPCAgent(service: libraryService, transport: transport)
          return try await LibrarySources.fetchBookmarks(
            agent, cursor: c.string("cursor"), limit: c.input["limit"]?.intValue ?? LibrarySources.pageBookmarks
          ).json
        }
      }
    }
    for c in try cases(Self.f, "searchPosts") {
      await expectLibraryReplay(c) { transport in
        await libraryOutcome {
          let agent = c.input["noAgent"]?.isTruthy == true ? nil : XRPCAgent(service: libraryService, transport: transport)
          return try await LibrarySources.searchPosts(
            agent, c.string("query"), mine: c.input["mine"]?.isTruthy == true, handle: c.string("handle"),
            cursor: c.string("cursor")
          ).json
        }
      }
    }
    for c in try cases(Self.f, "fetchSavedFeeds") {
      await expectLibraryReplay(c, ordered: false) { transport in
        await libraryOutcome {
          let agent = c.input["noAgent"]?.isTruthy == true ? nil : XRPCAgent(service: libraryService, transport: transport)
          return .array(try await LibrarySources.fetchSavedFeeds(agent, transport: transport))
        }
      }
    }
  }

  @Test func links() async throws {
    for c in try cases(Self.f, "isMediaUrl") { check(.bool(LibrarySources.isMediaUrl(c.input["url"])), c) }
    for c in try cases(Self.f, "fetchRecentLinks") {
      await expectLibraryReplay(c) { transport in
        await libraryOutcome {
          try await LibrarySources.fetchRecentLinks(
            "did:plc:self", cursor: c.string("cursor"), seen: c.input["seen"]?.arrayValue, transport: transport
          ).json
        }
      }
    }
  }

  @Test func feedsAndLists() async throws {
    for c in try cases(Self.f, "fetchOwnFeeds") {
      await expectLibraryReplay(c) { transport in
        await libraryOutcome {
          try await LibrarySources.fetchOwnFeeds("did:plc:self", cursor: c.string("cursor"), transport: transport).json
        }
      }
    }
    for c in try cases(Self.f, "fetchOwnLists") {
      await expectLibraryReplay(c) { transport in
        await libraryOutcome {
          try await LibrarySources.fetchOwnLists("did:plc:self", cursor: c.string("cursor"), transport: transport).json
        }
      }
    }
    for c in try cases(Self.f, "savedFeedUris") {
      check(json(LibrarySources.savedFeedUris(c.input["preferences"])), c)
    }
  }

  @Test func picks() async throws {
    for c in try cases(Self.f, "quotesTurnedOff") {
      await expectLibraryReplay(c) { transport in
        await libraryOutcome {
          .bool(try await LibrarySources.quotesTurnedOff(c.string("uri"), selfDid: c.string("selfDid"), transport: transport))
        }
      }
    }
    for c in try cases(Self.f, "hydratePick") {
      await expectLibraryReplay(c) { transport in
        await libraryOutcome {
          try await LibrarySources.hydratePick(
            LibraryItem(json: c.input["item"] ?? .null), selfDid: c.string("selfDid"), transport: transport,
            clock: libraryCase
          ).json
        }
      }
    }
    for c in try cases(Self.f, "hydrateAttachment") {
      await expectLibraryReplay(c) { transport in
        await libraryOutcome {
          try await LibrarySources.hydrateAttachment(
            LibraryAttachment(json: c.input["attach"] ?? .null), selfDid: c.string("selfDid"), transport: transport
          ).json
        }
      }
    }
    for c in try cases(Self.f, "hydrateEmbedViews") {
      await expectLibraryReplay(c, ordered: false) { transport in
        await libraryOutcome {
          await LibrarySources.hydrateEmbedViews(c.input["entries"]?.arrayValue, transport: transport).json
        }
      }
    }
  }

  @Test func pastedLinks() async throws {
    for c in try cases(Self.f, "resolveRecordLink") {
      await expectLibraryReplay(c) { transport in
        await libraryOutcome {
          await LibrarySources.resolveRecordLink(c.string("url"), transport: transport)?.json ?? .null
        }
      }
    }
    for c in try cases(Self.f, "resolveExternalLink") {
      await expectLibraryReplay(c) { transport in
        await libraryOutcome {
          try await LibrarySources.resolveExternalLink(c.string("url"), fetchLinkCard: fetchLinkCardStandIn(transport))?.json
            ?? .null
        }
      }
    }
    for c in try cases(Self.f, "resolvePastedLink") {
      await expectLibraryReplay(c) { transport in
        await libraryOutcome {
          try await LibrarySources.resolvePastedLink(
            c.string("input"), selfDid: c.string("selfDid"), transport: transport,
            fetchLinkCard: fetchLinkCardStandIn(transport), clock: libraryCase
          )?.json ?? .null
        }
      }
    }
  }

  @Test func librarySources() async throws {
    for c in try cases(Self.f, "librarySources") {
      await expectLibraryReplay(c) { transport in
        await libraryOutcome {
          let asked = Locked<[String]>([])
          let noAgent = c.input["noAgent"]?.isTruthy == true
          let bound = LibrarySources.librarySources(
            did: "did:plc:self",
            agent: { did in
              asked.withLock { $0.append(did ?? "") }
              return noAgent ? nil : XRPCAgent(service: libraryService, transport: transport)
            }, handle: c.string("handle"), transport: transport, openStore: { _ in throw ArchiveUnreadable() },
            fetchLinkCard: fetchLinkCardStandIn(transport), clock: { libraryCase })
          let out: JSONValue
          do {
            switch c.string("call") {
            case "search": out = try await bound.search("moths", mine: true).json
            case "saved": out = try await bound.saved().json
            case "posts": out = try await bound.posts().json
            case "replies": out = try await bound.replies().json
            case "links": out = try await bound.links().json
            case "feeds": out = try await bound.feeds().json
            case "lists": out = try await bound.lists().json
            case "savedFeeds": out = .array(try await bound.savedFeeds())
            case "hydrate":
              out = try await bound.hydrate(
                LibraryItem(json: ["kind": "post", "uri": "at://did:plc:other/app.bsky.feed.post/h"])
              ).json
            default: out = try await bound.resolveLink("https://docs.example/a")?.json ?? .null
            }
          } catch {
            return ["error": .string(jsMessage(error)), "asked": json(asked.wrappedValue)]
          }
          return ["out": out, "asked": json(asked.wrappedValue)]
        }
      }
    }
  }
}

@Suite struct LibraryUIParity {
  static let f = "library.ui"

  @Test func copy() throws {
    check(json(LibraryUI.shelfEmpty), try cases(Self.f, "SHELF_EMPTY")[0])
    check(json(LibraryUI.shelfHint), try cases(Self.f, "SHELF_HINT")[0])
    for shelf in Library.libraryShelves {
      #expect(LibraryUI.shelfEmpty[shelf.id] != nil)
      #expect(LibraryUI.shelfHint[shelf.id] != nil)
    }
  }

  @Test func looksLikeLink() throws {
    for c in try cases(Self.f, "looksLikeLink") { check(.bool(LibraryUI.looksLikeLink(jsText(c.input["text"]))), c) }
  }

  @Test func moveActive() throws {
    for c in try cases(Self.f, "moveActive") {
      let move: LibraryUI.Move
      switch c.input["delta"] {
      case .string("first")?: move = .first
      case .string("last")?: move = .last
      default: move = .by(c.input["delta"]?.doubleValue ?? .nan)
      }
      let ids = c.input["ids"]?.arrayValue?.map(\.stringValue)
      check(json(LibraryUI.moveActive(ids, c.string("activeId"), move)), c)
    }
  }

  @Test func templateContextFrom() throws {
    for c in try cases(Self.f, "templateContextFrom") {
      let context = c.input["context"].map { LibraryContextInput(json: $0) }
      check(json(LibraryUI.templateContextFrom(context, selfHandle: c.string("selfHandle"), clock: libraryCase)), c)
    }
  }

  @Test func initialShelf() throws {
    for c in try cases(Self.f, "initialShelf") {
      check(.string(LibraryUI.initialShelf(c.input["context"]?["shelf"]?.stringValue, replying: c.input["replying"]?.isTruthy == true)), c)
    }
  }

  @Test func sectionsFor() throws {
    for c in try cases(Self.f, "sectionsFor") {
      let items = (c.input["items"]?.arrayValue ?? []).map { LibraryItem(json: $0) }
      let given = c.input["templateSections"]?.arrayValue?.map { s in
        LibrarySection(
          id: s["id"]?.stringValue ?? "", heading: s["heading"]?.stringValue, muted: s["muted"]?.boolValue ?? false,
          items: (s["items"]?.arrayValue ?? []).map { LibraryItem(json: $0) })
      }
      let sections = LibraryUI.sectionsFor(c.string("shelfId") ?? "", items, templateSections: given)
      let out: [JSONValue] = sections.map {
        ["id": .string($0.id), "heading": $0.heading.map(JSONValue.string) ?? .null, "muted": .bool($0.muted), "items": json($0.items.map(\.id))]
      }
      check(.array(out), c, strictNulls: true)
    }
  }
}
