// StyleSession (adviser/styleSession.js createStyleSession), ported from
// adviserUi.test.js's styleSession suite and extended: the stages, the
// running count, the timer, refining against the same posts, failures, a
// late answer after the dialog closed.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
@testable import VirgaPosting

@MainActor @Suite struct StyleSessionBehaviour {
  static let posts = ["one", "two", "three", "four", "five", "six"]

  final class Harness {
    let timers = ManualMainTimers()
    var views: [StyleView] = []
    var fetches: [(did: String?, sampleSize: JSONValue?)] = []
    var syntheses: [(texts: [String], guidance: String, previousSummary: String)] = []
    var signals: [AdviserAbortSignal] = []
    var session: StyleSession!
  }

  static func reading(_ previous: String) -> StyleReading {
    StyleReading(
      summary: previous.isEmpty ? "Writes in lowercase." : "\(previous) Refined.", analyzedCount: 6,
      updatedAt: "2026-11-12T10:00:00.000Z", usage: ["used": 1, "limit": 3])
  }

  static func harness(
    profile: AdviserStyleProfile? = nil,
    fetchTexts: StyleSession.FetchTexts? = nil,
    synthesize: StyleSession.Synthesize? = nil
  ) -> Harness {
    let h = Harness()
    let fetch: StyleSession.FetchTexts =
      fetchTexts ?? { [unowned h] did, sampleSize, signal, onPage in
        h.fetches.append((did, sampleSize))
        h.signals.append(signal)
        onPage(3)
        onPage(6)
        return posts
      }
    let synth: StyleSession.Synthesize =
      synthesize ?? { [unowned h] _, texts, guidance, previous, signal in
        h.syntheses.append((texts, guidance, previous))
        h.signals.append(signal)
        return reading(previous)
      }
    h.session = StyleSession(
      did: "did:plc:me", requester: nil, profile: profile, onChange: { [unowned h] in h.views.append($0) },
      fetchTexts: fetch, synthesize: synth, setTimer: h.timers.set, clearTimer: h.timers.clear)
    return h
  }

  @Test func startsOnTheSavedDescription() {
    let h = Self.harness(
      profile: AdviserStyleProfile(summary: "Saved.", analyzedCount: 40, updatedAt: "2026-10-01T00:00:00Z", guidance: ""))
    #expect(h.session.view.phase == "result")
    #expect(h.session.view.summary == "Saved.")
    #expect(h.session.view.analyzedCount == 40)
    #expect(h.session.view.fresh == false)
    let blank = StyleSession(did: nil, requester: nil)
    #expect(blank.view == StyleSessionWords.initialStyleView)
    let empty = StyleSession(
      did: nil, requester: nil, profile: AdviserStyleProfile(summary: "", analyzedCount: 9, updatedAt: "x", guidance: "g"))
    #expect(empty.view == StyleSessionWords.initialStyleView)
  }

  @Test func gathersReadsAndWritesCountingPostsAsTheyCome() async {
    let h = Self.harness()
    await h.session.start(sampleSize: 250, guidance: "i skip capitals")
    #expect(h.fetches.count == 1)
    #expect(h.fetches[0].did == "did:plc:me")
    #expect(h.fetches[0].sampleSize == 250)
    #expect(h.views.map(\.postCount).contains(3))
    #expect(h.views.map(\.postCount) == [0, 3, 6, 6, 6])
    #expect(h.views.map(\.stage) == ["gather", "gather", "gather", "read", "write"])
    #expect(h.timers.timers.first?.ms == StyleSessionWords.writeStageFlipMs)
    #expect(h.timers.live == 0)
    #expect(h.syntheses.first?.texts == Self.posts)
    #expect(h.syntheses.first?.guidance == "i skip capitals")
    let view = h.session.view
    #expect(view.phase == "result")
    #expect(view.summary == "Writes in lowercase.")
    #expect(view.analyzedCount == 6)
    #expect(view.usage == ["used": 1, "limit": 3])
    #expect(view.fresh)
    #expect(h.session.hasPosts)
  }

  @Test func refinesAgainstTheSamePostsWithoutGatheringAgain() async {
    let h = Self.harness()
    await h.session.start()
    await h.session.start(guidance: "shorter", previousSummary: h.session.view.summary)
    #expect(h.fetches.count == 1)
    #expect(h.syntheses.count == 2)
    #expect(h.session.view.summary == "Writes in lowercase. Refined.")
    // A refine starts at 'read' with the posts it has.
    #expect(h.views.contains { $0.phase == "working" && $0.stage == "read" && $0.postCount == 6 })
    await h.session.start(again: true)
    #expect(h.fetches.count == 2)
  }

  @Test func showsAnErrorForAFirstReading() async {
    let h = Self.harness(fetchTexts: { _, _, _, _ in
      throw AIServiceError(message: "nope", code: "not_enough_posts")
    })
    await h.session.start()
    #expect(h.session.view.phase == "error")
    #expect(h.session.view.error?.message.contains("at least 5") == true)
    #expect(h.session.view.error?.code == "not_enough_posts")
  }

  @Test func keepsTheDescriptionOnAFailedRefineAndCountsTheLimit() async {
    let h = Self.harness(
      profile: AdviserStyleProfile(summary: "Saved.", analyzedCount: 0, updatedAt: "", guidance: ""),
      synthesize: { _, _, _, _, _ in
        throw AIServiceError(message: "used", status: 429, code: "monthly_limit", payload: ["limit": 3, "used": 3])
      })
    await h.session.start(previousSummary: "Saved.")
    let view = h.session.view
    #expect(view.phase == "result")
    #expect(view.summary == "Saved.")
    #expect(view.usage == ["used": 3, "limit": 3])
    #expect(view.error?.code == "monthly_limit")
    #expect(h.timers.live == 0)
  }

  @Test func countsTheLimitFromWhatTheServerSaid() async {
    let h = Self.harness(synthesize: { _, _, _, _, _ in
      throw AIServiceError(message: "used", status: 429, code: "monthly_limit", payload: ["limit": 0])
    })
    await h.session.start()
    // `limit || 3`, `used ?? limit`.
    #expect(h.session.view.usage == ["used": 3, "limit": 3])
    #expect(h.session.view.phase == "error")
  }

  @Test func flipsToWritingAFewSecondsIntoTheReading() async {
    let answers = AdviserScript<StyleReading>()
    let h = Self.harness(synthesize: { _, _, _, _, _ in await answers.next() })
    let running = Task { await h.session.start() }
    await answers.called(0)
    #expect(h.session.view.stage == "read")
    h.timers.run(upTo: StyleSessionWords.writeStageFlipMs)
    #expect(h.session.view.stage == "write")
    #expect(h.session.view.phase == "working")
    answers.answer(0, Self.reading(""))
    await running.value
    #expect(h.session.view.phase == "result")
  }

  @Test func dropsAnAnswerThatComesAfterTheDialogClosed() async {
    let answers = AdviserScript<StyleReading>()
    let h = Self.harness(synthesize: { [answers] _, _, _, _, signal in
      let reading = await answers.next()
      #expect(signal.aborted)
      return reading
    })
    let running = Task { await h.session.start() }
    await answers.called(0)
    h.session.dispose()
    answers.answer(0, StyleReading(summary: "late", analyzedCount: 1, updatedAt: ""))
    await running.value
    #expect(h.session.view.summary == "")
    #expect(h.session.hasPosts == false)
    #expect(h.timers.live == 0)
  }

  @Test func aNewStartAbortsTheOneBefore() async {
    let answers = AdviserScript<StyleReading>()
    let h = Self.harness(synthesize: { [answers] _, _, _, previous, _ in
      let reading = await answers.next()
      return StyleReading(summary: reading.summary + previous, analyzedCount: 1, updatedAt: "")
    })
    let first = Task { await h.session.start() }
    await answers.called(0)
    let second = Task { await h.session.start(previousSummary: "!") }
    await answers.called(1)
    #expect(h.signals.first?.aborted == true)
    answers.answer(1, StyleReading(summary: "second", analyzedCount: 1, updatedAt: ""))
    await second.value
    answers.answer(0, StyleReading(summary: "first", analyzedCount: 1, updatedAt: ""))
    await first.value
    #expect(h.session.view.summary == "second!")
  }

  @Test func anAbortIsNoError() async {
    let h = Self.harness(fetchTexts: { _, _, _, _ in throw CancellationError() })
    await h.session.start()
    #expect(h.session.view.phase == "working")
    #expect(h.session.view.error == nil)
  }

  @Test func takesHandEdits() {
    let h = Self.harness(profile: AdviserStyleProfile(summary: "Saved.", analyzedCount: 0, updatedAt: "", guidance: ""))
    h.session.edit("Mine now.")
    #expect(h.session.view.summary == "Mine now.")
    #expect(h.session.view.fresh)
    #expect(h.views.count == 1)
  }

  @Test func theDefaultWorkReadsTheAppViewAndTheServer() async throws {
    let transport = MockTransport()
    let feed: JSONValue = [
      "feed": .array((0..<6).map { i in ["post": ["author": ["did": "did:plc:me"], "record": ["text": .string("p\(i)")]]] })
    ]
    transport.on(.path("/xrpc/app.bsky.feed.getAuthorFeed"), times: 1, respond: .json(feed))
    transport.on("POST", .urlPrefix("https://server.example/api/ai/synthesize-style"), times: 1,
      respond: .json(["summary": " Short. ", "analyzedCount": 6, "usage": ["used": 1, "limit": 3]]))
    let store = InMemoryKeyValueStore()
    let timers = ManualMainTimers()
    let session = StyleSession(
      did: "did:plc:me", requester: AdviserFixtureServer.requester(transport, did: "did:plc:me"), store: store,
      transport: transport, now: { AdviserFixtureServer.now }, setTimer: timers.set, clearTimer: timers.clear)
    await session.start()
    #expect(session.view.phase == "result")
    #expect(session.view.summary == "Short.")
    #expect(session.view.postCount == 6)
    #expect(session.view.updatedAt == "2026-11-12T10:00:00.000Z")
    #expect(transport.requests.count == 2)
    let body = try JSONValue.parse(transport.requests[1].body ?? Data())
    #expect(body["posts"]?.arrayValue?.count == 6)
    #expect(AdviserUsageStore.readAdviserUsage(
      "did:plc:me", feature: .style, now: AdviserFixtureServer.now, store: store)?.used == 1)
  }
}
