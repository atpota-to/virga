// Parity for src/posting/lib/linkCard.js (fixture publish.linkCard): the
// refs a card names, the card service's answers read, the thumbnail fetched
// and shrunk, and uploaded as the write account, every exchange replayed
// from MockTransport and every call to the re-encoder checked.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct LinkCardParity {
  static let f = "publish.linkCard"

  @Test func normalizeAssociatedRefs() throws {
    for c in try cases(Self.f, "normalizeAssociatedRefs") {
      check(LinkCard.normalizeAssociatedRefs(c.input["raw"]).map(JSONValue.array) ?? .null, c)
    }
  }

  @Test func fetchLinkCard() async throws {
    for c in try cases(Self.f, "fetchLinkCard") {
      let transport = replayTransport(c.output)
      let result = await publishOutcome {
        try await LinkCard.fetchLinkCard(
          c.string("url"), deadlineMs: c.input["deadlineMs"]?.doubleValue, transport: transport) ?? .null
      }
      checkReplay(c, sent: transport.requests, result: result, waits: nil)
    }
  }

  @Test func fetchCardThumbnail() async throws {
    for c in try cases(Self.f, "fetchCardThumbnail") {
      let transport = replayTransport(c.output)
      let timers = ScriptedTimers(nil)
      let encoder = PublishEncoder(c.input["script"])
      let media = publishMedia(transport, timers, encoder: encoder)
      let result = await publishOutcome {
        PublishEncoder.marker(
          try await LinkCard.fetchCardThumbnail(
            c.string("imageUrl"), media: media, deadlineMs: c.input["deadlineMs"]?.doubleValue))
      }
      checkReplay(c, sent: transport.requests, result: result, waits: timers.waits)
      checkPart(.array(await encoder.calls), c.output["calls"] ?? [], c, "calls")
    }
  }

  @Test func uploadCardThumb() async throws {
    for c in try cases(Self.f, "uploadCardThumb") {
      let transport = replayTransport(c.output)
      let timers = ScriptedTimers(nil)
      let encoder = PublishEncoder(c.input["script"])
      let media = publishMedia(transport, timers, encoder: encoder)
      let target = PublishTarget(did: PublishFixture.me, agent: PublishFixture.agent(transport))
      let result = await publishOutcome {
        try await LinkCard.uploadCardThumb(target, c.input["card"], media: media) ?? .null
      }
      checkReplay(c, sent: transport.requests, result: result, waits: timers.waits)
      checkPart(.array(await encoder.calls), c.output["calls"] ?? [], c, "calls")
    }
  }
}

@Suite struct LinkCardBehaviour {
  /// A caller's deadline that runs out is the caller's abort: it is thrown,
  /// where the service's own ten seconds running out reads as no card.
  @Test func aCallersDeadlineIsThrown() async throws {
    let transport = MockTransport()
    transport.on(.any, respond: .timeout)
    await #expect(throws: HTTPTransportError.self) {
      _ = try await LinkCard.fetchLinkCard("https://e.com", deadlineMs: 5000, transport: transport)
    }
    let none = try await LinkCard.fetchLinkCard("https://e.com", deadlineMs: 20000, transport: transport)
    #expect(none == nil)
    let alsoNone = try await LinkCard.fetchLinkCard("https://e.com", transport: transport)
    #expect(alsoNone == nil)
  }

  /// The library's injected fetcher is fetchLinkCard itself.
  @Test func theLibrarysFetcher() async throws {
    let transport = MockTransport()
    transport.on(.any, respond: .json(["title": "T"]))
    let fetch = LinkCard.fetchLinkCard(transport: transport)
    let card = try await fetch("https://e.com/x")
    #expect(card?["title"] == "T")
    #expect(card?["url"] == "https://e.com/x")
  }

  /// `(await new Response(bytes, { headers: { 'content-type': header } }).blob()).type`,
  /// as Node 22's fetch gave it for each header.
  @Test func blobTypesAsNodeReadsThem() {
    let cases: [(String?, String)] = [
      ("image/png", "image/png"), ("IMAGE/PNG", "image/png"), ("image/png; charset=binary", "image/png;charset=binary"),
      ("image/png;Charset=\"UTF-8\"", "image/png;charset=utf-8"), ("text/html, image/png", "image/png"),
      ("image/png, text/html", "text/html"), ("*/*", ""), ("image", ""), ("image/png; q", "image/png"),
      (" image/webp ", "image/webp"), (nil, ""), ("", ""),
      ("image/png;charset=\"a\\\"b\"", "image/png;charset=\"a\\\"b\""),
      ("image/png;charset=\"a\\\\b\"", "image/png;charset=\"a\\\\b\""), ("image/png, */*", "image/png"),
      ("image/png;charset=a, image/png", "image/png;charset=a"),
      ("image/png;charset=a, image/png;x=1", "image/png;x=1;charset=a"),
      ("image/png;charset=a, image/jpeg", "image/jpeg"), ("image/png ; q=1", "image/png;q=1"),
      ("image/png;=x", "image/png"), ("image/png;a=", "image/png"), ("image/png;a=\"", "image/png;a=\"\""),
      ("image/png;a=\"b\"c", "image/png;a=b"), ("image/png;a=b;A=c", "image/png;a=b"),
      ("IMAGE/PNG;CHARSET=X", "image/png;charset=x"), ("image/png;a=b c", "image/png;a=\"b c\""),
      ("image/png;a=b\t", "image/png;a=b"), ("image/png,", "image/png"), (",image/png", "image/png"),
      ("image/png;;b=1", "image/png;b=1"), ("image /png", ""), ("image/ png", ""), ("image/png;a", "image/png"),
      ("image/webp;a=\"x;y\"", "image/webp;a=\"x;y\""), ("image/png;charset=\",\",image/gif", "image/gif"),
      ("image/png;a=\"x,y\"", "image/png;a=\"x,y\""), ("image/png`", ""), ("image/png;a=`", "image/png;a=\"`\""),
      ("image/png;a`=1", "image/png"), ("image/png;a=b\\c", "image/png;a=\"b\\\\c\""),
      ("image/png;a=\"b\\", "image/png;a=\"b\\\\\""), ("image/png;a=\"\u{e9}\"", ""), ("image/png;\u{e9}=1", "image/png"),
      ("image/png;a=\"b\",image/gif;x=\"1,2\"", "image/gif;x=\"1,2\""),
      ("image/png;charset=a, image/png;charset=b", "image/png;charset=b"),
      ("image/png;charset=A, IMAGE/PNG", "image/png;charset=a"),
      ("text/plain;charset=a, image/png, image/png", "image/png"),
      ("image/png;charset=a, */*, image/png", "image/png;charset=a"), ("image/png;a=\"b\"   ;c=d", "image/png;a=b;c=d"),
      ("image/png;a=b;charset=", "image/png;a=b"), ("image/png;charset=\"\", image/png", "image/png;charset=\"\""),
    ]
    for (header, expected) in cases {
      #expect(LinkCard.blobType(header) == expected, "\(header ?? "nil")")
    }
  }

  /// linkCard.js's `if (signal?.aborted) throw err`: a caller's deadline that
  /// runs out while the page's image is fetched is thrown; the image service
  /// failing within the card service's own ten seconds reads as no image.
  @Test func uploadCardThumbThrowsTheCallersDeadline() async throws {
    let transport = MockTransport()
    transport.on("GET", .urlPrefix("https://img.example/"), respond: .timeout)
    let media = PublishMedia(
      files: InMemoryComposerFiles(), encoder: PublishEncoder(nil), transport: transport,
      clock: ScriptedTimers(nil).clock)
    let target = PublishTarget(did: PublishFixture.me, agent: PublishFixture.agent(transport))
    let card: JSONValue = ["url": "https://e.com", "thumb": "https://img.example/x.png"]
    await #expect(throws: HTTPTransportError.self) {
      _ = try await LinkCard.uploadCardThumb(target, card, media: media, deadlineMs: 3000)
    }
    #expect(try await LinkCard.uploadCardThumb(target, card, media: media, deadlineMs: 20000) == nil)
    #expect(try await LinkCard.uploadCardThumb(target, card, media: media) == nil)
    let fetched = transport.requests.map(\.timeoutMs)
    #expect(fetched == [3000, 10000, 10000])
  }
}
