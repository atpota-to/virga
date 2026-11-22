// adviser/style.js and adviser/styleSession.js's words held to adviser.style:
// the AppView pages and the server's reading replayed from their recorded
// exchanges.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaPosting

final class PageLog: Sendable {
  let seen = Locked<[Int]>([])
  var onPage: @Sendable (Int) -> Void { { [seen] n in seen.withLock { $0.append(n) } } }
  var json: JSONValue { .array(seen.withLock { $0 }.map { .number(Double($0)) }) }
}

@Suite struct AdviserStyleParity {
  static let f = "adviser.style"
  static let me = "did:plc:me"

  @Test func constants() throws {
    for c in try cases(Self.f, "styleConstants") {
      check(
        [
          "MIN_STYLE_POSTS": .number(Double(AdviserStyle.minStylePosts)),
          "MAX_STYLE_POSTS": .number(Double(AdviserStyle.maxStylePosts)),
          "STYLE_STAGES": json(StyleSessionWords.styleStages),
          "WRITE_STAGE_FLIP_MS": .number(StyleSessionWords.writeStageFlipMs),
          "INITIAL_STYLE_VIEW": StyleSessionWords.initialStyleView.json,
        ], c)
    }
  }

  @Test func feeds() throws {
    for c in try cases(Self.f, "extractStyleTexts") {
      check(json(AdviserStyle.extractStyleTexts(c.input["feed"], Self.me)), c)
    }
    for c in try cases(Self.f, "extractStyleTextsNoDid") {
      check(json(AdviserStyle.extractStyleTexts(c.input["feed"], nil as JSONValue?)), c)
    }
  }

  /// `{ value | error, store }` for a call, as the generator records it.
  static func run(_ store: CodeUnitKeyValueStore, _ body: () async throws -> JSONValue) async -> JSONValue {
    var out: JSONValue
    do { out = ["value": try await body()] } catch { out = ["error": aiErrorShape(error)] }
    out["store"] = storeSnapshot(store)
    return out
  }

  @Test func reading() async throws {
    let now: @Sendable () -> Double = { AdviserFixtureServer.now }
    for c in try cases(Self.f, "fetchStylePostTexts") {
      let recorded = RecordedFetch(c.output)
      let transport = recorded.transport()
      let store = CodeUnitKeyValueStore()
      let pages = PageLog()
      let did: String? = c.input["did"].map { $0.stringValue } ?? Self.me
      let result = await Self.run(store) {
        let texts = try await AdviserStyle.fetchStylePostTexts(
          did, sampleSize: c.input["sampleSize"], onPage: pages.onPage, transport: transport)
        return ["texts": json(texts), "pages": pages.json]
      }
      let d = recorded.check(sent: transport.requests, result: result)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
    for c in try cases(Self.f, "synthesizeStyleFromTexts") {
      let recorded = RecordedFetch(c.output)
      let transport = recorded.transport()
      let store = CodeUnitKeyValueStore()
      let req: (any AIRequester)? =
        c.string("requester") == "none" ? nil : AdviserFixtureServer.requester(transport, did: Self.me)
      let at = c.input["now"]?.doubleValue ?? AdviserFixtureServer.now
      // The reading is dated by the first read of the clock; the usage is
      // kept by the fixture's.
      let lock = Locked(true)
      let clock: @Sendable () -> Double = {
        lock.withLock { start in
          defer { start = false }
          return start ? at : AdviserFixtureServer.now
        }
      }
      let result = await Self.run(store) {
        try await AdviserStyle.synthesizeStyleFromTexts(
          req, texts: c.input["texts"]?.arrayValue?.compactMap(\.stringValue), guidance: c.string("guidance"),
          previousSummary: c.string("previousSummary"), now: clock, store: store
        ).json
      }
      let d = recorded.check(sent: transport.requests, result: result)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
    for c in try cases(Self.f, "learnWritingStyle") {
      let recorded = RecordedFetch(c.output)
      let transport = recorded.transport()
      let store = CodeUnitKeyValueStore()
      let pages = PageLog()
      let did: String? = c.input["did"].map { $0.stringValue } ?? Self.me
      let result = await Self.run(store) {
        let reading = try await AdviserStyle.learnWritingStyle(
          AdviserFixtureServer.requester(transport, did: did), sampleSize: c.input["sampleSize"],
          onPage: pages.onPage, guidance: c.string("guidance"), previousSummary: c.string("previousSummary"),
          now: now, store: store, transport: transport)
        return ["result": reading.json, "pages": pages.json]
      }
      let d = recorded.check(sent: transport.requests, result: result)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func profiles() throws {
    for c in try cases(Self.f, "styleProfileFrom") {
      let profile =
        c.input["guidance"] == nil
        ? AdviserStyle.styleProfileFrom(c.input["result"]) : AdviserStyle.styleProfileFrom(c.input["result"], c.input["guidance"])
      check(json(profile), c)
    }
    for c in try cases(Self.f, "forgetStyleProfile") {
      check(json(AdviserStyle.forgetStyleProfile(c.input["profile"])), c)
    }
  }

  @Test func words() throws {
    for c in try cases(Self.f, "styleErrorMessage") {
      check(.string(StyleSessionWords.styleErrorMessage(c.input["err"])), c)
    }
    for c in try cases(Self.f, "styleProfileLine") {
      let locale = c.string("locale")
      let line = StyleSessionWords.styleProfileLine(
        analyzedCount: c.input["analyzedCount"], updatedAt: c.input["updatedAt"], locale: locale,
        countLocale: c.string("active") ?? locale, timeZone: TimeZone(identifier: c.string("tz") ?? "UTC"))
      check(.string(line), c)
    }
  }
}
