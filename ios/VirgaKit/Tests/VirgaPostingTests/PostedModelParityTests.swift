// pages/postedModel.js held to scheduling.postedModel: the Posted page's
// filters, seeds and intents, and its reads and writes replayed through
// MockTransport (the public AppView, the repo through Virga's server, the
// PDS's blobs).

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct PostedModelParity {
  static let f = "scheduling.postedModel"
  static let did = "did:plc:mira"

  @Test func constants() throws {
    for c in try cases(Self.f, "POSTED_FILTERS") { check(json(PostedModel.postedFilters), c) }
  }

  @Test func rows() throws {
    for c in try cases(Self.f, "isReplyRow") {
      check(.bool(PostedModel.isReplyRow(c.input["row"], Self.did)), c)
    }
    let rows = try cases(Self.f, "filterPostRows")
    // Every case filters the same rows: the generator's ROWS.
    let first = try #require(rows.first)
    _ = first
    for c in rows {
      let all: [JSONValue] = Self.rows
      let kept = PostedModel.filterPostRows(
        all, did: Self.did, filter: c.string("filter") ?? "all", query: c.input["query"]?.stringValue)
      check(.array(kept), c)
    }
  }

  /// The generator's ROWS.
  static let rows: [JSONValue] = [
    ["uri": "at://did:plc:mira/app.bsky.feed.post/1", "text": "A walk by the river", "replyTo": nil, "hasMedia": true],
    [
      "uri": "at://did:plc:mira/app.bsky.feed.post/2", "text": "Agreed, the river", "replyTo": "did:plc:other",
      "hasMedia": false,
    ],
    [
      "uri": "at://did:plc:mira/app.bsky.feed.post/3", "text": "continuing my thread", "replyTo": "did:plc:mira",
      "hasMedia": false,
    ],
    ["uri": "at://did:plc:mira/app.bsky.feed.post/4", "text": "ΟΔΟΣ İstanbul Straße", "hasMedia": 1],
    ["uri": "at://did:plc:mira/app.bsky.feed.post/5", "text": 42],
    ["text": "no uri"],
    nil,
  ]

  @Test func seeds() throws {
    for c in try cases(Self.f, "textForComposer") {
      check(.string(PostedModel.textForComposer(c.input["record"])), c)
    }
    for c in try cases(Self.f, "templateSeedFrom") {
      check(PostedModel.templateSeedFrom(c.input["record"]), c, strictNulls: true)
    }
    for c in try cases(Self.f, "postAgainSeed") {
      check(PostedModel.postAgainSeed(c.input["record"]).json, c, strictNulls: true)
    }
    for c in try cases(Self.f, "postAgainIntent") {
      let files = (c.input["files"]?.arrayValue ?? []).compactMap { entry -> PostedImageFile? in
        guard let file = ComposerFile(json: entry["file"]) else { return nil }
        return PostedImageFile(file: file, alt: entry["alt"]?.stringValue ?? "")
      }
      let intent = PostedModel.postAgainIntent(
        PostAgainSeed(json: c.input["seed"] ?? [:]), did: Self.did, files: files, missing: c.int("missing"))
      check(intent.json, c, strictNulls: true)
    }
    for c in try cases(Self.f, "postRowActions") {
      check(
        json(
          PostedModel.postRowActions(
            c.input["row"], canPost: c.input["canPost"]?.boolValue ?? false,
            canSchedule: c.input["canSchedule"]?.boolValue ?? false)), c)
    }
    for c in try cases(Self.f, "gatesQuotesOnlyFor") {
      let offer = c.input["offer"].flatMap { o -> PostRowActions? in
        guard o.isTruthy else { return nil }
        return PostRowActions(
          reply: false, quote: false, again: false, gates: false,
          gatesQuotesOnly: o["gatesQuotesOnly"]?.isTruthy ?? false, timer: false, template: false, delete: false)
      }
      check(.bool(PostedModel.gatesQuotesOnlyFor(offer, c.input["record"])), c)
    }
  }

  static func agent(_ transport: any HTTPTransport) -> XRPCAgent {
    XRPCAgent(
      did: did,
      fetchHandler: BackendFetchHandler(
        backendUrl: PublishFixture.server, token: PublishFixture.token, did: did, transport: transport))
  }

  static func value(_ body: () async throws -> JSONValue) async -> JSONValue {
    do { return ["value": try await body()] } catch {
      let object = ScheduledPostError.errorObject(error)
      return ["$error": ["message": object["message"] ?? .null, "code": object["code"] ?? .null]]
    }
  }

  @Test(arguments: ["readPostNow", "readPostGates", "deletePost", "fetchPostImages"])
  func network(_ fn: String) async throws {
    for c in try cases(Self.f, fn) {
      let transport = replayTransport(c.output)
      let agent = c.input["noAgent"] == .bool(true) ? nil : Self.agent(transport)
      let uri = c.string("uri") ?? ""
      let result = await Self.value {
        switch fn {
        case "readPostNow": return try await PostedModel.readPostNow(uri, agent: agent, transport: transport).json
        case "readPostGates": return try await PostedModel.readPostGates(uri, agent: agent!).json
        case "deletePost":
          try await PostedModel.deletePost(uri, agent: agent!)
          return .null
        default:
          let images = (c.input["images"]?.arrayValue ?? []).map {
            PostAgainSeed.Image(cid: $0["cid"] ?? .null, mime: $0["mime"]?.stringValue ?? "", alt: $0["alt"]?.stringValue ?? "")
          }
          var out = await PostedModel.fetchPostImages(
            images, did: c.string("did") ?? Self.did, pdsUrl: c.string("pdsUrl"), transport: transport,
            files: InMemoryComposerFiles()
          ).json
          let files = (out["files"]?.arrayValue ?? []).map { entry -> JSONValue in
            var e = entry
            e["file"]?["lastModified"] = nil
            e["file"]?["ref"] = nil
            return e
          }
          out["files"] = .array(files)
          return out
        }
      }
      checkReplay(c, sent: transport.requests, result: result, waits: nil, ordered: fn == "readPostNow" || fn == "fetchPostImages")
    }
  }
}
