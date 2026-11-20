// What the fixtures can't show: the transports, deadlines and cancellation,
// the caches shared between callers, the pool's concurrency, pagination,
// and the key order JSON.parse gives. Ported from the web modules' own tests
// where they apply.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaNetwork

@Suite struct MockTransportBehaviour {
  @Test func answersByRouteAndRecordsEveryRequest() async throws {
    let transport = MockTransport()
    transport.on("GET", .path("/xrpc/app.bsky.actor.getProfile"), respond: .json(["did": "did:plc:a"]))
    transport.on(.urlPrefix("https://c.example/"), times: 1, respond: .status(429))
    transport.on(.urlPrefix("https://c.example/"), respond: .text("ok"))
    let profile = try await transport.send(HTTPRequest(url: "https://appview.example/xrpc/app.bsky.actor.getProfile?actor=a"))
    #expect(try profile.json()["did"] == "did:plc:a")
    #expect(profile.headers.get("content-type") == "application/json")
    #expect(try await transport.send(HTTPRequest(url: "https://c.example/x")).status == 429)
    #expect(try await transport.send(HTTPRequest(url: "https://c.example/x")).text() == "ok")
    #expect(try await transport.send(HTTPRequest(url: "https://c.example/y")).text() == "ok")
    #expect(transport.requests.count == 4)
    #expect(transport.unexpected.isEmpty)
  }

  @Test func failsLoudlyOnAnUnexpectedRequest() async {
    let transport = MockTransport()
    transport.on("POST", .url("https://a.example/x"), respond: .status(200))
    await #expect(throws: MockTransport.MockTransportError.self) {
      _ = try await transport.send(HTTPRequest(url: "https://a.example/x"))
    }
    #expect(transport.unexpected.map(\.url) == ["https://a.example/x"])
    do {
      _ = try await transport.send(HTTPRequest(url: "https://b.example/"))
    } catch {
      #expect(jsMessage(error).contains("no route answers GET https://b.example/"))
      #expect(jsMessage(error).contains("POST url https://a.example/x"))
    }
  }

  @Test func failuresAndHangs() async throws {
    let transport = MockTransport()
    transport.on(.path("/offline"), respond: .networkError())
    transport.on(.path("/timeout"), respond: .timeout)
    transport.on(.path("/hang"), respond: .hang)
    transport.on(.regex("/closure$"), respond: { request in .json(.string(request.method)) })
    await #expect(throws: HTTPTransportError.network("fetch failed")) {
      _ = try await transport.send(HTTPRequest(url: "https://a.example/offline"))
    }
    await #expect(throws: HTTPTransportError.timedOut) {
      _ = try await transport.send(HTTPRequest(url: "https://a.example/timeout"))
    }
    // A hang ends at the request's deadline.
    await #expect(throws: HTTPTransportError.timedOut) {
      _ = try await transport.send(HTTPRequest(url: "https://a.example/hang", timeoutMs: 20))
    }
    #expect(try await transport.send(HTTPRequest(method: "post", url: "https://a.example/closure")).json() == "POST")
  }
}

@Suite struct DeadlineBehaviour {
  @Test func passesAResultThrough() async throws {
    #expect(try await withDeadline(ms: 1000) { 42 } == 42)
    #expect(try await withDeadline(ms: nil) { "none" } == "none")
  }

  @Test func timesOutAndCancelsTheOperation() async throws {
    let cancelled = Locked(false)
    await #expect(throws: HTTPTransportError.timedOut) {
      try await withDeadline(ms: 20) {
        do {
          try await Task.sleep(nanoseconds: 5_000_000_000)
        } catch {
          cancelled.set(true)
          throw error
        }
        return 0
      }
    }
    #expect(cancelled.withLock { $0 })
  }

  @Test func theCallersCancellationWins() async {
    let task = Task {
      try await withDeadline(ms: 5000) {
        try await Task.sleep(nanoseconds: 5_000_000_000)
        return 0
      }
    }
    task.cancel()
    await #expect(throws: CancellationError.self) { _ = try await task.value }
  }

  @Test func invalidAddressesAreRefusedBeforeSending() async {
    await #expect(throws: HTTPTransportError.invalidURL("not a url")) {
      _ = try await URLSessionTransport().send(HTTPRequest(url: "not a url"))
    }
  }
}

@Suite struct HeadersBehaviour {
  @Test func readLikeFetchHeaders() {
    var headers: HTTPHeaders = ["Content-Type": " text/plain\t", "X-A": "1"]
    headers.append("x-a", "2")
    #expect(headers.get("content-type") == "text/plain")
    #expect(headers.get("X-A") == "1, 2")
    headers.set("x-A", "3")
    #expect(headers.canonical == ["content-type": "text/plain", "x-a": "3"])
    headers.delete("CONTENT-TYPE")
    #expect(!headers.has("content-type"))
  }

  @Test func responsesReadAsFetchReadsThem() throws {
    let bom = HTTPResponse(body: Data([0xEF, 0xBB, 0xBF]) + Data("{\"a\":1}".utf8))
    #expect(try bom.json() == ["a": 1])
    #expect(bom.text() == "{\"a\":1}")
    #expect(HTTPResponse(body: Data([0xFF])).text() == "\u{FFFD}")
    #expect(HTTPResponse(body: Data("x".utf8)).jsonOrNull() == nil)
    #expect(!HTTPResponse(status: 302).ok && HTTPResponse(status: 204).ok)
  }

  @Test func stringifiesAsJavaScriptDoes() {
    #expect(JSONStringify.stringify(["a": 1.0, "b": [true, .null, 2.5], "c": "x/\"y\"\n\u{1}"]) == #"{"a":1,"b":[true,null,2.5],"c":"x/\"y\"\n\u0001"}"#)
    #expect(JSONStringify.stringify(.number(.infinity)) == "null")
    #expect(JSONStringify.stringify(.number(-0.0)) == "0")
    #expect(JSONStringify.stringify(.number(1e21)) == "1e+21")
  }
}

@Suite struct AgentBehaviour {
  @Test func eachCallCarriesTheHandlersDeadline() async throws {
    let transport = MockTransport()
    transport.on(.any, respond: .json(["success": true, "data": ["blob": ["$type": "blob"]]]))
    let handler = BackendFetchHandler(backendUrl: Fixed.server, token: { Fixed.token }, did: Fixed.did, transport: transport)
    let agent = XRPCAgent(did: Fixed.did, fetchHandler: handler)
    _ = try await agent.query("app.bsky.actor.getPreferences")
    #expect(transport.requests.last?.timeoutMs == 60_000)
    // An upload with no signal of its own gets the ten-minute fallback…
    _ = try await agent.procedure("com.atproto.repo.uploadBlob", input: .bytes(Data([1])), options: .init(encoding: "image/png"))
    #expect(transport.requests.last?.timeoutMs == 600_000)
    // …and one whose caller keeps its own deadline gets none here.
    _ = try await agent.procedure(
      "com.atproto.repo.uploadBlob", input: .bytes(Data([1])), options: .init(encoding: "image/png", hasSignal: true))
    #expect(transport.requests.last?.timeoutMs == nil)
  }

  @Test func readsTheTokenAtEachRequest() async throws {
    let current = Locked(Fixed.token)
    let transport = MockTransport()
    transport.on(.any, respond: .json(["success": true, "data": ["preferences": []]]))
    let agent = XRPCAgent(
      did: Fixed.did, fetchHandler: BackendFetchHandler(backendUrl: Fixed.server, token: { current.withLock { $0 } }, did: Fixed.did, transport: transport))
    let backend = VirgaBackend(backendUrl: Fixed.server, token: { current.withLock { $0 } }, did: Fixed.did, transport: transport)
    _ = try await agent.query("app.bsky.actor.getPreferences")
    try await backend.request("/api/schedule/list")
    let next = "vg_" + String(repeating: "cd", count: 32)
    current.set(next)
    _ = try await agent.query("app.bsky.actor.getPreferences")
    try await backend.request("/api/schedule/list")
    #expect(transport.requests.map { $0.headers.get("authorization") } == [
      "Bearer \(Fixed.token)", "Bearer \(Fixed.token)", "Bearer \(next)", "Bearer \(next)",
    ])
  }

  @Test func decodesTypedAnswers() async throws {
    let transport = MockTransport()
    transport.on(.path("/xrpc/com.atproto.identity.resolveHandle"), respond: .json(["did": "did:plc:mira"]))
    let agent = XRPCAgent(service: "https://pds.example", transport: transport)
    let output = try await agent.query("com.atproto.identity.resolveHandle", ["handle": "mira.example.com"], as: ResolveHandleOutput.self)
    #expect(output.did == "did:plc:mira")
    #expect(transport.requests[0].url == "https://pds.example/xrpc/com.atproto.identity.resolveHandle?handle=mira.example.com")
    #expect(transport.requests[0].headers.get("atproto-accept-labelers") == "did:plc:ar7c4by46qjdydhdevvrndac;redact")
  }

  @Test func aTimeoutIsAnUnknownXRPCError() async {
    let transport = MockTransport()
    transport.on(.any, respond: .timeout)
    let agent = XRPCAgent(service: "https://pds.example", transport: transport)
    do {
      _ = try await agent.query("app.bsky.actor.getPreferences")
      Issue.record("expected a failure")
    } catch let error as XRPCError {
      #expect(error.status == 1 && error.error == "Unknown" && error.message == "The operation was aborted due to timeout")
    } catch {
      Issue.record("not an XRPCError: \(error)")
    }
  }

  @Test func paramsEncodeAsTheSDKDoes() {
    let params: XRPCParams = [
      "actor": "did:plc:a", "limit": .integer(4_294_967_297), "includePins": true, "cursor": nil,
      "uris": .strings(["a b", "c&d"]), "f": .float(2.5),
    ]
    #expect(XRPCPath.methodCallURL("app.bsky.feed.getAuthorFeed", params)
      == "/xrpc/app.bsky.feed.getAuthorFeed?actor=did%3Aplc%3Aa&limit=1&includePins=true&uris=a+b&uris=c%26d&f=2.5")
    #expect(XRPCPath.methodCallURL("a.b.c", [:]) == "/xrpc/a.b.c")
    #expect(XRPCPath.methodCallURL("a.b.c", nil) == "/xrpc/a.b.c")
  }

  @Test func blueskyAppViewIsTheWebsProxy() {
    let agent = XRPCAgent(service: "https://pds.example", transport: MockTransport()).withBlueskyAppView()
    #expect(agent.proxy == "did:web:api.bsky.app#bsky_appview")
  }

  @Test func xrpcErrorDefaults() {
    #expect(XRPCError(statusCode: 404).json == ["status": 404, "error": "XRPCNotSupported", "message": "XRPCNotSupported"])
    #expect(XRPCError(statusCode: 418, error: "Teapot").status == 400)
    #expect(XRPCError(statusCode: 599, error: "", message: "").message == "Internal Server Error")
    #expect(XRPCError.from(HTTPTransportError.network("Failed to fetch")).json == ["status": 1, "error": "Unknown", "message": "Failed to fetch"])
  }
}

/// backendClient.test.js: a sign-in called off goes nowhere, and the
/// requester tells a timeout from an unreachable server and lets a caller's
/// own abort through.
@Suite struct BackendBehaviour {
  static let authUrl = "https://bsky.social/oauth/authorize?request_uri=z"

  /// Cancels the task the request is made in, as an AbortController's
  /// `abort()` called while the server is answering.
  static func cancelCurrentTask() { withUnsafeCurrentTask { $0?.cancel() } }

  static func signIn(_ transport: MockTransport, _ storage: InMemoryKeyValueStore, _ assigned: Locked<[String]>) async throws {
    try await BackendClient.startBackendSignIn(
      backendUrl: Fixed.server, handle: "mira.example.com", origin: "https://virga.example", returnPath: "/oauth/return",
      transport: transport, clock: .instant(now: 1_773_576_000_000), sessionStorage: storage,
      assign: { url in assigned.withLock { $0.append(url) } })
  }

  static func expectCalledOff(_ body: () async throws -> Void) async {
    do {
      try await body()
      Issue.record("expected the sign-in to be called off")
    } catch let error as BackendError {
      #expect(error.name == "AbortError" && error.codeString == "CANCELLED" && error.message == "The sign-in was called off")
    } catch {
      Issue.record("not a BackendError: \(error)")
    }
  }

  @Test func aSignInCalledOffGoesNowhere() async {
    // While the server was answering: the address it sent isn't gone to.
    let during = MockTransport()
    during.on(.any) { _ in
      BackendBehaviour.cancelCurrentTask()
      return .json(["success": true, "authUrl": .string(BackendBehaviour.authUrl)])
    }
    let storage = InMemoryKeyValueStore()
    let assigned = Locked<[String]>([])
    await Task {
      await Self.expectCalledOff { try await Self.signIn(during, storage, assigned) }
    }.value
    #expect(assigned.withLock { $0 }.isEmpty)
    #expect(storage.getItem(BackendClient.signinPendingKey) == nil)

    // While the request was in flight: the fetch itself is dropped.
    let inFlight = MockTransport()
    inFlight.on(.any) { _ in
      BackendBehaviour.cancelCurrentTask()
      throw CancellationError()
    }
    await Task {
      await Self.expectCalledOff { try await Self.signIn(inFlight, storage, assigned) }
    }.value
    #expect(assigned.withLock { $0 }.isEmpty)

    // Before it started: nothing is sent.
    let before = MockTransport()
    before.on(.any, respond: .json(["success": true, "authUrl": .string(BackendBehaviour.authUrl)]))
    await Task {
      Self.cancelCurrentTask()
      await Self.expectCalledOff { try await Self.signIn(before, storage, assigned) }
    }.value
    #expect(before.requests.isEmpty)
    #expect(assigned.withLock { $0 }.isEmpty)
    #expect(storage.getItem(BackendClient.signinPendingKey) == nil)
  }

  @Test func aSignInGoesToTheAddressTheServerSent() async throws {
    let transport = MockTransport()
    transport.on(.any, respond: .json(["success": true, "authUrl": .string(Self.authUrl)]))
    let storage = InMemoryKeyValueStore()
    let assigned = Locked<[String]>([])
    try await Self.signIn(transport, storage, assigned)
    #expect(assigned.withLock { $0 } == [Self.authUrl])
    #expect(transport.requests.first?.timeoutMs == BackendClient.sessionTimeoutMs)
    #expect(BackendClient.readSigninPending(storage)?["mode"] == "backend")
  }

  static func requestError(_ transport: MockTransport) async -> any Error {
    let backend = VirgaBackend(backendUrl: Fixed.server, token: { Fixed.token }, did: Fixed.did, transport: transport)
    do {
      try await backend.request("/api/x")
      return CancellationError()
    } catch {
      return error
    }
  }

  @Test func theRequesterTellsATimeoutFromAnUnreachableServer() async {
    let slow = MockTransport()
    slow.on(.any, respond: .timeout)
    let timedOut = await Self.requestError(slow) as? BackendError
    #expect(timedOut?.codeString == "TIMEOUT" && timedOut?.status == 0)
    #expect(timedOut?.message == "Virga’s server didn’t answer in time.")
    #expect(slow.requests.first?.timeoutMs == 30_000)

    let offline = MockTransport()
    offline.on(.any, respond: .networkError("Failed to fetch"))
    let unreachable = await Self.requestError(offline) as? BackendError
    #expect(unreachable?.codeString == "NETWORK_ERROR" && unreachable?.status == 0)
    #expect(unreachable?.message == "Couldn’t reach Virga’s server.")
    #expect(unreachable?.detail == nil && unreachable?.payload == nil)
  }

  @Test func theRequesterLetsTheCallersAbortThrough() async {
    let aborting = MockTransport()
    aborting.on(.any) { _ in
      BackendBehaviour.cancelCurrentTask()
      throw CancellationError()
    }
    let error = await Task { await Self.requestError(aborting) }.value
    #expect(error is CancellationError)
  }
}

@Suite struct CacheBehaviour {
  @Test func sharesARead() async throws {
    let cache = PromiseCache<Int>()
    let reads = Locked(0)
    async let a = cache.value(for: "k", now: 0) {
      reads.withLock { $0 += 1 }
      try await Task.sleep(nanoseconds: 20_000_000)
      return 7
    }
    async let b = cache.value(for: "k", now: 0) {
      reads.withLock { $0 += 1 }
      return 8
    }
    let (x, y) = try await (a, b)
    #expect(x == y)
    #expect(reads.withLock { $0 } == 1)
  }

  @Test func forgetsAFailureAndExpires() async throws {
    let cache = PromiseCache<Int>()
    struct Offline: Error {}
    await #expect(throws: Offline.self) { try await cache.value(for: "k", now: 0) { throw Offline() } }
    #expect(try await cache.value(for: "k", ttl: 600_000, now: 1) { 1 } == 1)
    #expect(try await cache.value(for: "k", ttl: 600_000, now: 600_000) { 2 } == 1)
    #expect(try await cache.value(for: "k", ttl: 600_000, now: 600_001) { 3 } == 3)
  }

  @Test func didDocumentsAreHeldTenMinutes() async throws {
    let transport = MockTransport()
    transport.on(.urlPrefix("https://plc.directory/"), respond: .json(["id": "did:plc:a"]))
    let cache = PromiseCache<JSONValue>()
    for now in [0.0, 599_999, 600_000] {
      _ = try await Atproto.getDidDocument("did:plc:a", transport: transport, clock: .instant(now: now), cache: cache)
    }
    #expect(transport.requests.count == 2)
    #expect(transport.requests[0].timeoutMs == 15_000)
  }

  @Test func pdsResolverSharesALookup() async throws {
    let reads = Locked(0)
    let resolver = PDS.createPdsResolver { did in
      reads.withLock { $0 += 1 }
      try await Task.sleep(nanoseconds: 10_000_000)
      return ["service": [["id": "#atproto_pds", "serviceEndpoint": "https://pds.example/"]]]
    }
    async let a = resolver.resolvePdsUrl(Fixed.did)
    async let b = resolver.resolvePdsUrl(Fixed.did)
    #expect(try await [a, b] == ["https://pds.example", "https://pds.example"])
    _ = try await resolver.resolvePdsUrl(Fixed.did)
    #expect(reads.withLock { $0 } == 1)
  }
}

@Suite struct ConstellationBehaviour {
  @Test func eachAttemptHasItsOwnDeadline() async {
    let transport = MockTransport()
    transport.on(.any, respond: .json(["records": []]))
    _ = await Constellation.getBacklinks("did:plc:me", "app.bsky.graph.block:subject", transport: transport, clock: .instant(now: 0))
    #expect(transport.requests[0].timeoutMs == 15_000)
    #expect(transport.requests[0].headers.get("accept") == "application/json")
  }

  @Test func aCancelledReadAnswersNil() async {
    let transport = MockTransport()
    transport.on(.any, respond: .status(503))
    let task = Task {
      await Constellation.getBacklinkCount("at://x", "a:b", transport: transport, clock: .live)
    }
    try? await Task.sleep(nanoseconds: 50_000_000)
    task.cancel()
    #expect(await task.value == nil)
    #expect(transport.requests.count < 5)
  }

  @Test func flattensInTheAnswersOrder() throws {
    let text = #"{"links":{"z":{".a":{"records":1}},"a":{".b":{"records":2},".a":{"records":1}}}}"#
    let rows = Constellation.flattenSources(try OrderedJSON.parse(text)) ?? []
    #expect(rows.map(\.source) == ["a:b", "z:a", "a:a"])
    #expect(rows.first?.countNumber == 2)
  }
}

@Suite struct OrderedJSONBehaviour {
  @Test func keepsJSONParsesOrder() throws {
    let parsed = try OrderedJSON.parse(#"{"b":1,"10":2,"a":{"y":1,"x":2},"2":3,"b":4,"-1":5,"01":6}"#)
    #expect(parsed.entries.map(\.0) == ["2", "10", "b", "a", "-1", "01"])
    #expect(parsed["b"]?.value == 4)
    #expect(parsed["a"]?.entries.map(\.0) == ["y", "x"])
    #expect(parsed.value == ["b": 4, "10": 2, "a": ["y": 1, "x": 2], "2": 3, "-1": 5, "01": 6])
  }

  @Test func readsScalarsAsJSONParseDoes() throws {
    let parsed = try OrderedJSON.parse(#"[1e400, -0, "\ud800x", "é\n", true, null, {"":[]}]"#)
    #expect(parsed.value == [.number(.infinity), .number(-0.0), "\u{FFFD}x", "é\n", true, .null, ["": []]])
    #expect(throws: JSONParseError.self) { try OrderedJSON.parse("{\"a\":1,}") }
    #expect(OrderedJSON.isArrayIndex("4294967294") && !OrderedJSON.isArrayIndex("4294967295"))
  }

  @Test func entriesOfOtherValues() {
    #expect(OrderedJSON.scalar("ab").entries.map(\.0) == ["0", "1"])
    #expect(OrderedJSON.scalar(5).entries.isEmpty)
    #expect(OrderedJSON(["k": [1, 2]])["k"]?.entries.map(\.0) == ["0", "1"])
  }
}

@Suite struct JSSortBehaviour {
  @Test func isStable() {
    let items: [[Int]] = (0..<200).map { [$0 % 3, $0] }
    let sorted: [[Int]] = JSSort.sort(items) { a, b in Double(a[0] - b[0]) }
    let expected: [[Int]] = items.sorted { a, b in a[0] < b[0] || (a[0] == b[0] && a[1] < b[1]) }
    #expect(sorted == expected)
  }

  /// V8's answer for a comparator that is inconsistent (NaN reads as 0):
  /// `[1, NaN, 3, 2].sort((a, b) => b - a)` is `[1, NaN, 3, 2]` in Node.
  @Test func followsV8WithNaN() {
    let sorted = JSSort.sort([1.0, .nan, 3, 2]) { $1 - $0 }
    #expect(sorted.map { $0.isNaN ? -1 : $0 } == [1, -1, 3, 2])
    let descending = JSSort.sort([5.0, 4, 3, 1, 2]) { $1 - $0 }
    #expect(descending == [5, 4, 3, 2, 1])
  }
}

@Suite struct AsyncPoolBehaviour {
  @Test func neverExceedsTheLimitAndKeepsOrder() async throws {
    let state = Locked((now: 0, peak: 0))
    let out = try await AsyncPool.mapWithConcurrency(Array(0..<10), 3) { item, index -> Int in
      state.withLock { s in
        s.now += 1
        s.peak = max(s.peak, s.now)
      }
      try await Task.sleep(nanoseconds: UInt64((10 - item) * 2_000_000))
      state.withLock { $0.now -= 1 }
      return item * 10 + index
    }
    #expect(out == (0..<10).map { $0 * 11 })
    #expect(state.withLock { $0.peak } == 3)
  }

  @Test func coercesABadLimit() async throws {
    #expect(AsyncPool.poolSize(0, count: 3) == 1)
    #expect(AsyncPool.poolSize(-.infinity, count: 3) == 1)
    #expect(AsyncPool.poolSize(.infinity, count: 3) == 3)
    #expect(AsyncPool.poolSize(.nan, count: 3) == 1)
    #expect(try await AsyncPool.mapWithConcurrency([1, 2, 3], 0) { item, _ in item * 2 } == [2, 4, 6])
    #expect(try await AsyncPool.mapWithConcurrency([Int](), 4) { item, _ in item }.isEmpty)
  }

  @Test func cancellingTheCallerCancelsTheCalls() async {
    let started = Locked(0)
    let finished = Locked(0)
    let task = Task {
      try await AsyncPool.mapWithConcurrency(Array(0..<6), 2) { item, _ -> Int in
        started.withLock { $0 += 1 }
        try await Task.sleep(nanoseconds: 2_000_000_000)
        finished.withLock { $0 += 1 }
        return item
      }
    }
    try? await Task.sleep(nanoseconds: 50_000_000)
    task.cancel()
    _ = try? await task.value
    #expect(finished.withLock { $0 } == 0)
  }
}

@Suite struct BlobsBehaviour {
  @Test func timesOut() async {
    let transport = MockTransport()
    transport.on(.any, respond: .hang)
    let agent = XRPCAgent(did: Fixed.did, fetchHandler: BackendFetchHandler(backendUrl: Fixed.server, token: Fixed.token, transport: transport))
    await #expect(throws: BlobUploadError.timeout) {
      _ = try await Blobs.uploadBlob(agent: agent, data: Data([1]), encoding: "image/jpeg", timeoutMs: 20)
    }
  }

  @Test func stopsOnCancel() async {
    let transport = MockTransport()
    transport.on(.any, respond: .hang)
    let agent = XRPCAgent(did: Fixed.did, fetchHandler: BackendFetchHandler(backendUrl: Fixed.server, token: Fixed.token, transport: transport))
    let task = Task { try await Blobs.uploadBlob(agent: agent, data: Data([1]), encoding: "image/jpeg") }
    try? await Task.sleep(nanoseconds: 30_000_000)
    task.cancel()
    do {
      _ = try await task.value
      Issue.record("expected a cancellation")
    } catch {
      #expect(error as? BlobUploadError == .cancelled)
      #expect((error as? BlobUploadError)?.name == "AbortError")
    }
  }
}

@Suite struct PaginationBehaviour {
  static func pages(_ cursors: [String?], sizes: [Int]) -> @Sendable (String?) async throws -> Pagination.Page<Int> {
    let calls = Locked(0)
    return { _ in
      let n = calls.withLock { c -> Int in
        defer { c += 1 }
        return c
      }
      return Pagination.Page(items: Array(repeating: n, count: sizes[min(n, sizes.count - 1)]), cursor: cursors[min(n, cursors.count - 1)])
    }
  }

  @Test func readsUntilThereIsNoCursor() async throws {
    let out = try await Pagination.collect(fetch: Self.pages(["a", "b", nil], sizes: [2, 2, 1]))
    #expect(out.items == [0, 0, 1, 1, 2] && out.pages == 3 && out.stop == .complete && out.complete)
  }

  @Test func stopsOnAnEmptyPageOrAnEmptyCursor() async throws {
    #expect(try await Pagination.collect(fetch: Self.pages(["a", "b"], sizes: [2, 0])).stop == .complete)
    #expect(try await Pagination.collect(fetch: Self.pages(["a", ""], sizes: [2, 2])).pages == 2)
    let keepsGoing = try await Pagination.collect(maxPages: 3, stopOnEmptyPage: false, fetch: Self.pages(["a", "b", "c", "d"], sizes: [2, 0]))
    #expect(keepsGoing.stop == .pageLimit && keepsGoing.pages == 3 && keepsGoing.cursor == "c")
  }

  @Test func stopsOnARepeatedCursor() async throws {
    let previous = try await Pagination.collect(repeatedCursor: .stopOnPrevious, fetch: Self.pages(["a", "a"], sizes: [1]))
    #expect(previous.stop == .repeatedCursor && previous.pages == 2)
    let any = try await Pagination.collect(repeatedCursor: .stopOnAny, fetch: Self.pages(["a", "b", "a"], sizes: [1]))
    #expect(any.stop == .repeatedCursor && any.pages == 3)
    let follows = try await Pagination.collect(maxPages: 4, repeatedCursor: .follow, fetch: Self.pages(["a"], sizes: [1]))
    #expect(follows.stop == .pageLimit && follows.pages == 4)
  }

  @Test func pagesAnAgentQuery() async throws {
    let transport = MockTransport()
    transport.on(.any, times: 1, respond: .json(["records": [1, 2], "cursor": "c1"]))
    transport.on(.any, respond: .json(["records": [3]]))
    let agent = XRPCAgent(service: "https://pds.example", transport: transport)
    let out = try await agent.collect("com.atproto.repo.listRecords", ["repo": "did:plc:a", "limit": 100], itemsKey: "records")
    #expect(out.items == [1, 2, 3])
    #expect(transport.requests.map(\.url) == [
      "https://pds.example/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc%3Aa&limit=100",
      "https://pds.example/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc%3Aa&limit=100&cursor=c1",
    ])
  }
}

@Suite struct WebURLBehaviour {
  @Test func canParseAndSearchParams() throws {
    #expect(WebURL.canParse("https://a.example") && !WebURL.canParse("nope") && WebURL.canParse("/x", base: "https://a.example"))
    var url = try WebURL("https://s.example/api?b=1&a=2&b=3")
    #expect(url.searchParams.map(\.0) == ["b", "a", "b"])
    url.appendSearchParam("c", "x y")
    #expect(url.href == "https://s.example/api?b=1&a=2&b=3&c=x+y")
    url.setSearch("")
    #expect(url.href == "https://s.example/api")
  }
}

@Suite struct JSSortParity {
  /// V8's own sort over keys that include ones `Number` reads as NaN
  /// (ios/parity/cases/network.jssort.js). Below 64 rows the order with
  /// such keys is V8's exactly; at 64 and more only consistent comparators
  /// are in the fixture, as only those are promised.
  @Test func sort() throws {
    for c in try Parity.cases("network.jssort", fn: "sort") {
      let keys = c["keys"].arrayValue ?? []
      let rows = keys.enumerated().map { (index: $0.offset, key: $0.element) }
      let sorted = JSSort.sort(rows) { a, b in b.key.jsNumber - a.key.jsNumber }
      let actual: JSONValue = .array(sorted.map { .number(Double($0.index)) })
      #expect(Parity.diff(actual, c.output) == nil, "\(c) \(keys.count) keys")
    }
  }
}

/// JSON.parse's SyntaxError, in V8's words (network.jsonSyntax).
@Suite struct JSONSyntaxParity {
  @Test func v8() throws {
    let cases = try Parity.cases("network.jsonSyntax", fn: "v8")
    #expect(cases.count > 700)
    for c in cases {
      let text = c["text"].stringValue ?? ""
      let actual = JSONSyntaxError.v8(text).map { JSONValue.string($0.message) } ?? .null
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(text.debugDescription): \(d ?? "")")
      // What VirgaCore's parser accepts, V8 accepts.
      #expect((try? JSONValue.parse(text)) == nil || c.output == .null, "\(c) \(text.debugDescription)")
    }
  }

  /// A body that isn't JSON fails `res.json()` and the SDK with V8's words.
  @Test func responsesSayWhatV8Says() throws {
    let html = HTTPResponse(status: 200, body: Data("<!DOCTYPE html><html><head>".utf8))
    #expect(throws: JSONSyntaxError(message: "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON")) { try html.json() }
    #expect(html.jsonOrNull() == nil)
    let bom = HTTPResponse(status: 200, body: Data("\u{FEFF}{".utf8))
    #expect(throws: JSONSyntaxError(message: "Expected property name or '}' in JSON at position 1 (line 1 column 2)")) { try bom.json() }
    let empty = HTTPResponse(status: 200, body: Data())
    #expect(throws: JSONSyntaxError(message: "Unexpected end of JSON input")) { try empty.json() }
  }
}
