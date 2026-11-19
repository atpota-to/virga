// src/lib/atproto.js, src/session/pds.js and src/lib/activity.js against
// their fixtures (ios/parity/cases/network.{atproto,pds,activity}.js).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaNetwork

@Suite struct AtprotoParity {
  @Test func didWebDocumentUrl() throws {
    for c in try Parity.cases("network.atproto", fn: "didWebDocumentUrl") {
      let actual = Atproto.didWebDocumentUrl(c["did"].stringValue).map(JSONValue.string) ?? .null
      #expect(Parity.diff(actual, c.output) == nil, "\(c) \(c["did"])")
    }
  }

  @Test func rkeyFromAtUri() throws {
    for c in try Parity.cases("network.atproto", fn: "rkeyFromAtUri") {
      let actual = Atproto.rkeyFromAtUri(c["uri"].stringValue).map(JSONValue.string) ?? .null
      #expect(Parity.diff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func tidToTimestamp() throws {
    for c in try Parity.cases("network.atproto", fn: "tidToTimestamp") {
      let actual = Atproto.tidToTimestamp(c["rkey"].stringValue).map(JSONValue.string) ?? .null
      #expect(Parity.diff(actual, c.output) == nil, "\(c) \(c["rkey"])")
    }
  }

  static func settle(_ body: () async throws -> JSONValue) async -> JSONValue {
    do {
      return ["value": try await body()]
    } catch {
      let http = error as? AtprotoHTTPError
      return [
        "error": [
          "message": .string(jsMessage(error)),
          "status": http.map { .number(Double($0.status)) } ?? .null,
          "url": http.map { .string($0.url) } ?? .null,
        ]
      ]
    }
  }

  @Test func getDidDocument() async throws {
    for c in try Parity.cases("network.atproto", fn: "getDidDocument") {
      await expectReplay(c) { transport, recorder in
        let cache = PromiseCache<JSONValue>()
        let did = c["did"].stringValue
        let read = { try await Atproto.getDidDocument(did, transport: transport, clock: recorder.clock, cache: cache) }
        let first = await Self.settle(read)
        if c["twice"].boolValue != true { return first }
        return [first, await Self.settle(read)]
      }
    }
  }

  @Test func resolvePds() async throws {
    for c in try Parity.cases("network.atproto", fn: "resolvePds") {
      await expectReplay(c) { transport, recorder in
        .string(try await Atproto.resolvePds(c["did"].stringValue, transport: transport, clock: recorder.clock, cache: PromiseCache()))
      }
    }
  }

  @Test func getProfile() async throws {
    for c in try Parity.cases("network.atproto", fn: "getProfile") {
      await expectReplay(c) { transport, _ in
        try await Atproto.getProfile(
          c["actor"].stringValue ?? "", appview: c["appview"].stringValue ?? AppConfig.appview, transport: transport)
      }
    }
  }

  @Test func resolveProfiles() async throws {
    for c in try Parity.cases("network.atproto", fn: "resolveProfiles") {
      await expectReplay(c) { transport, recorder in
        let dids = c["dids"].arrayValue.map { $0.map(\.stringValue) }
        let out = await Atproto.resolveProfiles(
          dids, appview: c["appview"].stringValue ?? AppConfig.appview, transport: transport, clock: recorder.clock)
        return .of(out)
      }
    }
  }

  @Test func getPlcHistory() async throws {
    for c in try Parity.cases("network.atproto", fn: "getPlcHistory") {
      await expectReplay(c) { transport, _ in
        guard let history = await Atproto.getPlcHistory(c["did"].stringValue, transport: transport) else { return .null }
        return .of(history)
      }
    }
  }

  @Test func fetchWithTimeout() async throws {
    for c in try Parity.cases("network.atproto", fn: "fetchWithTimeout") {
      await expectReplay(c) { transport, _ in
        let initValue = c["init"]
        var headers = HTTPHeaders()
        for (name, value) in initValue["headers"]?.objectValue ?? [:] { headers.set(name, value.stringValue ?? "") }
        let request = HTTPRequest(
          method: initValue["method"]?.stringValue ?? "GET", url: c["url"].stringValue ?? "", headers: headers,
          body: initValue["body"]?.stringValue.map { Data($0.utf8) })
        let response = try await Atproto.fetchWithTimeout(request, transport: transport)
        return ["status": .number(Double(response.status)), "body": try response.json()]
      }
    }
  }
}

@Suite struct PDSParity {
  @Test func pdsFromDidDocument() throws {
    for c in try Parity.cases("network.pds", fn: "pdsFromDidDocument") {
      let doc: JSONValue? = c.input["doc"]
      let actual: String?
      if let did = c.input["did"] {
        actual = PDS.pdsFromDidDocument(doc, did: did.stringValue)
      } else {
        actual = PDS.pdsFromDidDocument(doc)
      }
      #expect(Parity.diff(actual.map(JSONValue.string) ?? .null, c.output) == nil, "\(c) \(c["doc"])")
    }
  }

  @Test func resolver() async throws {
    for c in try Parity.cases("network.pds", fn: "resolver") {
      await expectReplay(c) { transport, recorder in
        let cache = PromiseCache<JSONValue>()
        let clock = recorder.clock
        let resolver = PDS.createPdsResolver { did in
          try await Atproto.getDidDocument(did, transport: transport, clock: clock, cache: cache)
        }
        func settle(_ body: () async throws -> JSONValue) async -> JSONValue {
          do { return ["value": try await body()] } catch { return ["error": .string(jsMessage(error))] }
        }
        var out: [JSONValue] = []
        for step in c["steps"].arrayValue ?? [] {
          let op = step[0]?.stringValue
          let did = step[1]?.stringValue
          switch op {
          case "resolve":
            out.append(await settle { .string(try await resolver.resolvePdsUrl(did)) })
          case "resolveTwiceAtOnce":
            out.append(
              await settle {
                async let a = resolver.resolvePdsUrl(did)
                async let b = resolver.resolvePdsUrl(did)
                return [.string(try await a), .string(try await b)]
              })
          case "remember":
            await resolver.remember(did, step[2]?.stringValue)
            out.append(.null)
          case "forget":
            await resolver.forget(did)
            out.append(.null)
          default:
            Issue.record("unknown step \(step)")
          }
        }
        return .array(out)
      }
    }
  }
}

@Suite struct ActivityParity {
  @Test func feedItemTime() throws {
    for c in try Parity.cases("network.activity", fn: "feedItemTime") {
      let actual = Activity.feedItemTime(c.input["item"]).map(JSONValue.string) ?? .null
      #expect(Parity.diff(actual, c.output) == nil, "\(c) \(c["item"])")
    }
  }

  /// The web lists results in the order its reads finished; the port in the
  /// order of the DIDs. The results are compared as a set, the progress in
  /// order.
  @Test func checkActivity() async throws {
    for c in try Parity.cases("network.activity", fn: "checkActivity") {
      var recording = RecordedFetch(c.output)
      let transport = recording.transport()
      let progress = Locked([JSONValue]())
      let dids = c["dids"].arrayValue.map { $0.map(\.stringValue) }
      let results = await Activity.checkActivity(
        dids,
        onProgress: { p in progress.withLock { $0.append(["done": .number(Double(p.done)), "total": .number(Double(p.total))]) } },
        transport: transport)
      func byDid(_ value: JSONValue) -> JSONValue {
        .array((value.arrayValue ?? []).sorted { ($0["did"]?.stringValue ?? "") < ($1["did"]?.stringValue ?? "") })
      }
      recording.expected["results"] = byDid(recording.expected["results"] ?? [])
      let actual: JSONValue = ["results": byDid(.of(results)), "progress": .array(progress.withLock { $0 })]
      let d = recording.check(sent: transport.requests, result: actual, waits: [], ordered: false)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }
}
