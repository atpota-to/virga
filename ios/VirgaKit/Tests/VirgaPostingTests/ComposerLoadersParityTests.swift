// composer/loaders.js held to composer.loaders: the public reads replayed
// through PublicAppView over MockTransport, the draft and scheduled calls
// scripted, and the candidates to continue.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct ComposerLoadersParity {
  static let f = "composer.loaders"

  /// An error as the generator records it.
  static func failure(_ error: any Error) -> JSONValue {
    let code: JSONValue = (error as? ComposerLoadError).map { .string($0.code) } ?? .null
    let status: JSONValue = (error as? PublicXrpcError).map { .number(Double($0.status)) }
      ?? JSErrorFields(error)?.status.map { .number(Double($0)) } ?? .null
    return ["$throws": .string(jsMessage(error)), "code": code, "status": status]
  }

  static func run(_ body: () async throws -> JSONValue) async -> JSONValue {
    do { return ["value": try await body()] } catch { return failure(error) }
  }

  @Test func readers() throws {
    for c in try cases(Self.f, "loadError") {
      let e = ComposerLoaders.loadError(c.string("code") ?? "", c.string("message") ?? "")
      check(["message": .string(e.message), "code": .string(e.code)], c)
    }
    for c in try cases(Self.f, "replyFromView") { check(ComposerLoaders.replyFromView(c.input["view"]) ?? .null, c) }
  }

  @Test func publicReads() async throws {
    for fn in ["refUri", "loadReplyTarget", "loadRecordTarget"] {
      for c in try cases(Self.f, fn) {
        let recorded = RecordedFetch(c.output)
        let transport = recorded.transport()
        let reads = ComposerReads.network(transport: transport)
        let ref = c.input["ref"]
        let result = await Self.run {
          switch fn {
          case "refUri": return try await ComposerLoaders.refUri(ref, reads: reads).map(JSONValue.string) ?? .null
          case "loadReplyTarget": return try await ComposerLoaders.loadReplyTarget(ref, reads: reads)
          default: return try await ComposerLoaders.loadRecordTarget(ref, reads: reads)
          }
        }
        let d = recorded.check(sent: transport.requests, result: result)
        #expect(d == nil, "\(c): \(d ?? "")")
      }
    }
  }

  @Test func drafts() async throws {
    for c in try cases(Self.f, "loadDraftTarget") {
      let s = c.input["script"] ?? [:]
      let calls = Locked<[JSONValue]>([])
      func record(_ entry: [JSONValue]) { calls.withLock { $0.append(.array(entry)) } }
      var out = await Self.run {
        try await ComposerLoaders.loadDraftTarget(
          draftId: "d1", ownerDid: "did:plc:mira",
          agentFor: { (did: String) -> String in
            record(["agentFor", .string(did)])
            if s["agentThrows"]?.isTruthy == true { throw JSError(message: "reauth") }
            return "agent"
          },
          listAllDrafts: { agent in
            record(["listAllDrafts", .string(agent)])
            if s["listThrows"]?.isTruthy == true { throw JSError(message: "down") }
            return s["list"]?.arrayValue
          },
          openDraft: { view, asDid in
            record(["openDraft", view, ["asDid": .string(asDid), "defaults": ["langs": ["en"]]]])
            if s["openThrows"]?.isTruthy == true { throw JSError(message: "cannot open") }
            return ["state": ["opened": view["id"] ?? .null], "missing": []]
          })
      }
      out["calls"] = .array(calls.withLock { $0 })
      check(out, c)
    }
  }

  @Test func scheduled() async throws {
    for c in try cases(Self.f, "loadScheduledTarget") {
      let s = c.input["script"] ?? [:]
      let calls = Locked<[JSONValue]>([])
      func record(_ entry: [JSONValue]) { calls.withLock { $0.append(.array(entry)) } }
      var out = await Self.run {
        let target = try await ComposerLoaders.loadScheduledTarget(
          id: "s1", asDid: "did:plc:mira", req: s["noReq"]?.isTruthy == true ? nil : "req",
          getScheduled: { (req: String, id: JSONValue) -> JSONValue? in
            record(["getScheduled", .string(req), id])
            switch s["getThrows"] {
            case "offline"?: throw JSError(name: "TypeError", message: "fetch failed")
            case .number(let status)?: throw JSError(message: "nope", status: Int(status))
            default: return s["row"]
            }
          },
          getScheduledMedia: { req, id in
            record(["getScheduledMedia", .string(req), id])
            if s["mediaThrows"]?.isTruthy == true { throw JSError(message: "down") }
            return s["media"] ?? .null
          },
          reconstructFromScheduled: { row, media, asDid -> JSONValue in
            record(["reconstruct", row["id"] ?? .null, media, ["asDid": .string(asDid)]])
            return ["rebuilt": row["id"] ?? .null, "media": media]
          })
        return ["state": target.state, "row": target.row]
      }
      out["calls"] = .array(calls.withLock { $0 })
      check(out, c)
    }
  }

  @Test func continueCandidates() throws {
    for c in try cases(Self.f, "continueCandidates") {
      check(
        .array(
          ComposerLoaders.continueCandidates(
            c.input["rows"]?.arrayValue, c.string("did") ?? "", limit: c.input["limit"]?.intValue ?? 5,
            timeZone: ComposerFixtures.zone(c))), c)
    }
  }
}
