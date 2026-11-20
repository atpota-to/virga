// src/lib/constellation.js, src/posting/lib/blobs.js, asyncPool.js and the
// public AppView reads of src/posting/library/sources.js against their
// fixtures.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaNetwork

@Suite struct ConstellationParity {
  @Test func backlinkRows() throws {
    for c in try Parity.cases("network.constellation", fn: "backlinkRows") {
      #expect(Parity.diff(Constellation.backlinkRows(c.input["page"]), c.output) == nil, "\(c)")
    }
  }

  @Test func flattenSources() throws {
    for c in try Parity.cases("network.constellation", fn: "flattenSources") {
      let raw = try OrderedJSON.parse(c["text"].stringValue ?? "null")
      let actual = Constellation.flattenSources(raw).map { JSONValue.of($0) } ?? .null
      let d = Parity.diff(actual, c.output, strictNulls: true)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func getBacklinkSources() async throws {
    for c in try Parity.cases("network.constellation", fn: "getBacklinkSources") {
      await expectReplay(c) { transport, recorder in
        let raw = await Constellation.getBacklinkSources(c["target"].stringValue, transport: transport, clock: recorder.clock)
        return ["raw": raw?.value ?? .null, "flat": Constellation.flattenSources(raw).map { JSONValue.of($0) } ?? .null]
      }
    }
  }

  @Test func getBacklinkCount() async throws {
    for c in try Parity.cases("network.constellation", fn: "getBacklinkCount") {
      await expectReplay(c) { transport, recorder in
        await Constellation.getBacklinkCount(c["target"].stringValue, c["source"].stringValue, transport: transport, clock: recorder.clock)
          ?? .null
      }
    }
  }

  @Test func getBacklinks() async throws {
    for c in try Parity.cases("network.constellation", fn: "getBacklinks") {
      await expectReplay(c) { transport, recorder in
        let options = c.input["options"]
        return await Constellation.getBacklinks(
          c["target"].stringValue, c["source"].stringValue,
          limit: options?["limit"]?.intValue ?? 25,
          cursor: options?["cursor"]?.stringValue,
          dids: options?["dids"]?.arrayValue?.compactMap(\.stringValue),
          transport: transport, clock: recorder.clock) ?? .null
      }
    }
  }

  @Test func getManyToMany() async throws {
    for c in try Parity.cases("network.constellation", fn: "getManyToMany") {
      await expectReplay(c) { transport, recorder in
        let options = c.input["options"]
        return await Constellation.getManyToMany(
          c["subject"].stringValue, c["source"].stringValue, c["pathToOther"].stringValue,
          limit: options?["limit"]?.intValue ?? 100,
          cursor: options?["cursor"]?.stringValue,
          otherSubject: options?["otherSubject"]?.stringValue,
          transport: transport, clock: recorder.clock) ?? .null
      }
    }
  }
}

@Suite struct BlobsParity {
  @Test func constants() throws {
    let c = try Parity.cases("network.blobs", fn: "constants")[0]
    let actual: JSONValue = [
      "BLOB_UPLOAD_BASE_MS": .number(Blobs.blobUploadBaseMs),
      "BLOB_UPLOAD_MIN_BYTES_PER_SECOND": .number(Blobs.blobUploadMinBytesPerSecond),
    ]
    #expect(Parity.diff(actual, c.output) == nil)
  }

  @Test func blobUploadTimeoutMs() throws {
    for c in try Parity.cases("network.blobs", fn: "blobUploadTimeoutMs") {
      // A string isn't a number to Number.isFinite, so it reads as none.
      let actual = Blobs.blobUploadTimeoutMs(c.input["bytes"]?.doubleValue)
      #expect(Parity.diff(.number(actual), c.output) == nil, "\(c)")
    }
  }

  @Test func blobCid() throws {
    for c in try Parity.cases("network.blobs", fn: "blobCid") + Parity.cases("network.blobs", fn: "blobCidOfBlobRef") {
      #expect(Parity.diff(Blobs.blobCid(c.input["blob"]) ?? .null, c.output) == nil, "\(c)")
    }
  }

  @Test func isBlob() throws {
    for c in try Parity.cases("network.blobs", fn: "isBlob") {
      #expect(Parity.diff(.bool(Blobs.isBlob(c.input["blob"])), c.output) == nil, "\(c)")
    }
  }

  /// The web's upload races a timer of blobUploadTimeoutMs; the fixture
  /// records that timer as its one wait, which the port's deadline must
  /// equal.
  @Test func uploadBlob() async throws {
    for c in try Parity.cases("network.blobs", fn: "uploadBlob") {
      let bytes = Data((c["bytes"].arrayValue ?? []).compactMap { $0.intValue.map(UInt8.init) })
      await expectReplay(c, checkWaits: false) { transport, _ in
        let agent = XRPCAgent(
          did: Fixed.did, fetchHandler: BackendFetchHandler(backendUrl: Fixed.server, token: Fixed.token, did: Fixed.did, transport: transport))
        return .of(
          try await Blobs.uploadBlob(agent: agent, data: bytes, encoding: c["encoding"].stringValue, timeoutMs: c["timeoutMs"].doubleValue))
      }
      let waits = RecordedFetch(c.output).waits
      if !waits.isEmpty {
        #expect(waits == [c["timeoutMs"].doubleValue ?? Blobs.blobUploadTimeoutMs(Double(bytes.count))], "\(c)")
      }
    }
  }
}

@Suite struct AsyncPoolParity {
  @Test func mapWithConcurrency() async throws {
    for c in try Parity.cases("network.asyncPool", fn: "mapWithConcurrency") {
      let items = (c["items"].arrayValue ?? []).compactMap(\.stringValue)
      // `Math.floor(limit) || 1`: null and "x" are NaN to it, as nil is here.
      let limit = c.input["limit"]?.doubleValue ?? .nan
      let called = Locked([Int]())
      let inFlight = Locked((now: 0, peak: 0))
      var actual: JSONValue
      do {
        let results = try await AsyncPool.mapWithConcurrency(items, limit) { item, index -> String in
          called.withLock { $0.append(index) }
          inFlight.withLock { s in
            s.now += 1
            s.peak = max(s.peak, s.now)
          }
          // Later items take longer, so the first failure is the first item's.
          try? await Task.sleep(nanoseconds: UInt64(index + 1) * 3_000_000)
          inFlight.withLock { $0.now -= 1 }
          if item.hasPrefix("fail") { throw BackendError(message: "boom \(item)") }
          return "\(index):\(item)"
        }
        let peak = inFlight.withLock { $0.peak }
        let size = items.isEmpty ? 0 : AsyncPool.poolSize(limit, count: items.count)
        #expect(peak <= size, "\(c): \(peak) calls at once with a pool of \(size)")
        actual = [
          "results": .array(results.map(JSONValue.string)), "peak": .number(Double(size)),
          "called": .array(called.withLock { $0 }.sorted().map { .number(Double($0)) }),
        ]
      } catch {
        // The workers still running finish their items, as the web's do.
        try await Task.sleep(nanoseconds: 60_000_000)
        actual = ["error": .string(jsMessage(error)), "called": .array(called.withLock { $0 }.sorted().map { .number(Double($0)) })]
      }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }
}

@Suite struct PublicAppViewParity {
  @Test func constants() throws {
    let c = try Parity.cases("network.publicAppView", fn: "GET_POSTS_MAX")[0]
    #expect(Parity.diff(.number(Double(PublicAppView.getPostsMax)), c.output) == nil)
  }

  @Test func chunk() throws {
    for c in try Parity.cases("network.publicAppView", fn: "chunk") {
      let list = c["list"].arrayValue ?? []
      let parts = c.input["size"]?.intValue.map { PublicAppView.chunk(list, $0) } ?? PublicAppView.chunk(list)
      #expect(Parity.diff(.array(parts.map(JSONValue.array)), c.output) == nil, "\(c)")
    }
  }

  @Test func publicXrpc() async throws {
    for c in try Parity.cases("network.publicAppView", fn: "publicXrpc") {
      await expectReplay(c) { transport, _ in
        let params = QueryParams((c.input["params"] ?? [:]).ordered(by: c.input["keys"]))
        do {
          let body = try await PublicAppView.publicXrpc(
            c["nsid"].stringValue ?? "", params, appview: c["appview"].stringValue ?? AppConfig.appview, transport: transport)
          return ["body": body]
        } catch let error as PublicXrpcError {
          return ["error": ["message": .string(error.message), "status": .number(Double(error.status)), "error": error.error ?? .null]]
        } catch {
          return ["error": ["message": .string(jsMessage(error)), "status": .null, "error": .null]]
        }
      }
    }
  }

  @Test func getPosts() async throws {
    for c in try Parity.cases("network.publicAppView", fn: "getPosts") {
      await expectReplay(c, ordered: false) { transport, _ in
        let uris = c["uris"].arrayValue.map { $0.map(\.stringValue) }
        return await PublicAppView.getPosts(uris, transport: transport).json
      }
    }
  }

  @Test func resolveHandle() async throws {
    for c in try Parity.cases("network.publicAppView", fn: "resolveHandle") {
      await expectReplay(c) { transport, _ in
        await PublicAppView.resolveHandle(c["handle"].stringValue, transport: transport).map(JSONValue.string) ?? .null
      }
    }
  }
}
