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

  @Test func blobTypesAsNodeReadsThem() {
    let cases: [(String?, String)] = [
      ("image/png", "image/png"), ("IMAGE/PNG", "image/png"), ("image/png; charset=binary", "image/png;charset=binary"),
      ("image/png;Charset=\"UTF-8\"", "image/png;charset=utf-8"), ("text/html, image/png", "image/png"),
      ("image/png, text/html", "text/html"), ("*/*", ""), ("image", ""), ("image/png; q", "image/png"),
      (" image/webp ", "image/webp"), (nil, ""),
    ]
    for (header, expected) in cases {
      #expect(LinkCard.blobType(header) == expected, "\(header ?? "nil")")
    }
  }
}
