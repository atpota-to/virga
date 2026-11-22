// Ports harness/fakeXrpc.js
//
// A signed-in agent for one of the harness's accounts. It stands where the
// account's signed-in session would: `handle(nsid, input, opts)` answers
// with `{ success, headers, data }` or throws an XRPC-shaped error
// (HarnessRepo.XrpcError: `status`, `error`, `message`). The methods it
// answers are those of harness/fakeXrpc.js (FakeXrpc.methods); anything
// else fails loudly with MethodNotImplemented.
//
// It answers from the account's world (DemoWorld) and writes back to it
// (HarnessRepo), so what the app writes shows up in the public feed, the
// repo download and the next read. What is checked is what a real account
// would refuse: writing to another repo, a create over an existing record,
// a swap that doesn't match, and a call the account's granted scope
// doesn't cover (with the PDS's "Missing required scope" wording, so the
// app's re-consent path can be seen).
//
// On iOS every signed-in call goes through Virga's server (VirgaNetwork's
// BackendFetchHandler), so the demo's agents are reached through the fake
// server's /api/oauth/proxy (FakeServer.swift). `FakeXrpcFetchHandler`
// points VirgaNetwork's XRPCAgent at an agent directly, for previews and
// tests that want no server in between.
//
// Where the web reads the clock (`Date.now()`, `new Date()`, `nextTid()`)
// the agent reads the `clock` and `tids` it was given.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

public enum FakeXrpc {
  /// How many drafts Bluesky keeps for an account here (`DRAFT_LIMIT`).
  public static let draftLimit = 50

  /// The audience a signed-in AppView call names in its scope
  /// (`APPVIEW_AUD`).
  public static let appviewAud = "did:web:api.bsky.app%23bsky_appview"

  /// The proxy a call to Bluesky's AppView names (`withProxy('bsky_appview',
  /// 'did:web:api.bsky.app')`).
  public static let appviewProxy = "did:web:api.bsky.app#bsky_appview"

  /// Bluesky's own server, which keeps drafts and bookmarks whatever the
  /// agent was pointed at (`APPVIEW_ONLY`).
  public static let appviewOnly = [
    "app.bsky.draft.getDrafts",
    "app.bsky.draft.createDraft",
    "app.bsky.draft.updateDraft",
    "app.bsky.draft.deleteDraft",
    "app.bsky.bookmark.getBookmarks",
    "app.bsky.bookmark.createBookmark",
    "app.bsky.bookmark.deleteBookmark",
  ]

  /// `REPO_WRITES`.
  public static let repoWrites = [
    "com.atproto.repo.createRecord",
    "com.atproto.repo.putRecord",
    "com.atproto.repo.deleteRecord",
    "com.atproto.repo.applyWrites",
  ]

  /// Read without a session on any PDS, so a scope never covers them
  /// (`PUBLIC_REPO_READS`).
  public static let publicRepoReads = [
    "com.atproto.repo.getRecord",
    "com.atproto.repo.listRecords",
    "com.atproto.repo.describeRepo",
  ]

  /// The methods an agent answers (`methodsFor`'s keys), in the web's order.
  public static let methods = [
    "app.bsky.graph.getFollowers",
    "app.bsky.notification.listNotifications",
    "com.atproto.repo.listRecords",
    "com.atproto.repo.getRecord",
    "com.atproto.repo.describeRepo",
    "com.atproto.repo.createRecord",
    "com.atproto.repo.putRecord",
    "com.atproto.repo.deleteRecord",
    "com.atproto.repo.applyWrites",
    "com.atproto.repo.uploadBlob",
    "com.atproto.server.getServiceAuth",
    "app.bsky.actor.getProfiles",
    "app.bsky.actor.getPreferences",
    "app.bsky.actor.putPreferences",
    "app.bsky.bookmark.getBookmarks",
    "app.bsky.bookmark.createBookmark",
    "app.bsky.bookmark.deleteBookmark",
    "app.bsky.feed.searchPosts",
    "app.bsky.draft.getDrafts",
    "app.bsky.draft.createDraft",
    "app.bsky.draft.updateDraft",
    "app.bsky.draft.deleteDraft",
  ]

  static func listed(_ list: [String], _ nsid: String) -> Bool { list.contains { $0.jsEquals(nsid) } }

  /// `${value}` in a template literal: `undefined` for a value that isn't
  /// there, else `String(value)`.
  static func text(_ value: JSONValue?) -> String { value.map(\.jsString) ?? "undefined" }

  /// `String(value || '')`.
  static func textOrEmpty(_ value: JSONValue?) -> String { value.jsTruthy.map(\.jsString) ?? "" }

  /// `String(w.$type || '').split('#')[1]`: what kind of write an
  /// applyWrites entry is, or nil (`undefined`).
  static func writeKind(_ write: JSONValue?) -> String? {
    let parts = textOrEmpty(write?["$type"]).jsSplit("#")
    return parts.count > 1 ? parts[1] : nil
  }

  /// `w.collection`, as reading it off an entry does: a TypeError for an
  /// entry that is null.
  static func member(_ value: JSONValue, _ key: String) throws -> JSONValue? {
    if value.isNull { throw HarnessJSError.typeError("Cannot read properties of null (reading '\(key)')") }
    return value[key]
  }

  /// `scopesFor(nsid, input, opts)`: the scope tokens a call needs: one per
  /// record written for repo writes, the blob's type for an upload, the
  /// minted method for a service-auth token, and the method itself
  /// (addressed to Bluesky's AppView) for everything else. `input` and
  /// `opts` are the call's, as the web has them (nil for `undefined`).
  /// Throws the web's TypeError for an applyWrites whose `writes` can't be
  /// mapped.
  public static func scopesFor(_ nsid: String, _ input: JSONValue?, _ opts: JSONValue? = nil) throws -> [String] {
    if listed(publicRepoReads, nsid) { return [] }
    if listed(repoWrites, nsid) {
      var writes: [(JSONValue?, String?)] = []
      if nsid == "com.atproto.repo.applyWrites" {
        // `(input?.writes || []).map(...)`
        switch input?["writes"].jsTruthy {
        case nil: break
        case .array(let list)?:
          for w in list { writes.append((try member(w, "collection"), writeKind(w))) }
        default:
          throw HarnessJSError.typeError("((intermediate value) || []).map is not a function")
        }
      } else {
        let action: String
        switch nsid.jsSplit(".").last ?? "" {
        case "createRecord": action = "create"
        case "putRecord": action = "update"
        default: action = "delete"
        }
        writes = [(input?["collection"], action)]
      }
      return writes.map { "repo:\(text($0.0))?action=\($0.1 ?? "undefined")" }
    }
    // Without a type the upload is refused for that, before any scope is asked.
    if nsid == "com.atproto.repo.uploadBlob" {
      guard let encoding = opts?["encoding"].jsTruthy else { return [] }
      return ["blob:\(encoding.jsString)"]
    }
    if nsid == "com.atproto.server.getServiceAuth" {
      guard let lxm = input?["lxm"].jsTruthy else { return [] }
      return ["rpc:\(lxm.jsString)?aud=*"]
    }
    return ["rpc:\(nsid)?aud=\(appviewAud)"]
  }

  /// `mintServiceToken({ iss, aud, lxm, exp })`: a service-auth token
  /// anyone can read back, as the fake video service does. A member that
  /// isn't there is left out, as JSON.stringify leaves out `undefined`.
  /// Throws btoa's InvalidCharacterError for a character past U+00FF.
  public static func mintServiceToken(iss: JSONValue?, aud: JSONValue?, lxm: JSONValue?, exp: JSONValue?) throws -> String {
    var members: [String] = []
    func add(_ key: String, _ value: JSONValue?) {
      guard let value else { return }
      members.append("\(JSONStringify.quote(key)):\(JSONStringify.stringify(value))")
    }
    add("iss", iss)
    add("aud", aud)
    add("lxm", lxm.jsTruthy ?? .null)
    add("exp", exp)
    return "harness.\(try JSBase64.btoa("{\(members.joined(separator: ","))}")).unsigned"
  }

  /// `mintServiceToken` with the fields an agent mints.
  public static func mintServiceToken(iss: String, aud: String, lxm: String?, exp: Double) throws -> String {
    try mintServiceToken(iss: .string(iss), aud: .string(aud), lxm: lxm.map(JSONValue.string), exp: .number(exp))
  }

  /// `readServiceToken(token)`: the claims of a token minted here (an
  /// Authorization header's `Bearer ` is taken off first), or nil.
  public static func readServiceToken(_ token: String?) -> JSONValue? {
    var units = Array((token ?? "").utf16)
    // `.replace(/^Bearer\s+/i, '')`
    let bearer = Array("bearer".utf16)
    if units.count > bearer.count,
      zip(units.prefix(bearer.count), bearer).allSatisfy({ ($0.0 | 0x20) == $0.1 && ($0.0 < 0x80) }),
      let scalar = Unicode.Scalar(units[bearer.count]), JSWhitespace.contains(scalar)
    {
      var i = bearer.count
      while i < units.count, let s = Unicode.Scalar(units[i]), JSWhitespace.contains(s) { i += 1 }
      units = Array(units[i...])
    }
    // `/^harness\.([^.]+)\.unsigned$/`
    let head = Array("harness.".utf16)
    let tail = Array(".unsigned".utf16)
    guard units.count > head.count + tail.count, Array(units.prefix(head.count)) == head,
      Array(units.suffix(tail.count)) == tail
    else { return nil }
    let middle = Array(units[head.count..<(units.count - tail.count)])
    guard !middle.isEmpty, !middle.contains(0x2E) else { return nil }
    guard let bytes = try? JSBase64.atob(String(decoding: middle, as: UTF16.self)) else { return nil }
    return try? JSONValue.parse(JSBase64.latin1(bytes))
  }

  /// What counts the follower sweeps (Mira's churn): `{ next(): number }`.
  public struct SweepCounter: Sendable {
    public var next: @Sendable () -> Double

    public init(next: @escaping @Sendable () -> Double) {
      self.next = next
    }
  }

  /// The key the sweep count is kept under (`localStorageCounter`'s).
  public static let sweepCountKey = "virga-harness:follower-sweeps"

  /// `localStorageCounter(key)`: the sweep count in a key-value store (the
  /// web's localStorage), so it outlives a launch as the archive does. A
  /// store that refuses counts 1 each time.
  public static func localStorageCounter(_ storage: (any KeyValueStore)?, key: String = sweepCountKey) -> SweepCounter {
    SweepCounter {
      let held = storage?.getItem(key) ?? ""
      let n = (held.isEmpty ? 0 : JSNumber.toNumber(held)) + 1
      do {
        try storage?.setItem(key, JSNumber.format(n))
      } catch {
        return 1
      }
      return n
    }
  }

  /// A counter in memory, for tests and previews.
  public static func memoryCounter(start: Double = 0) -> SweepCounter {
    let count = Locked(start)
    return SweepCounter { count.withLock { $0 += 1; return $0 } }
  }

  /// A call's input: its params or body as JSON, an upload's bytes, or
  /// nothing (`undefined`).
  public enum Input: Sendable, Hashable {
    case none
    case json(JSONValue)
    case bytes([UInt8])

    var json: JSONValue? {
      if case .json(let value) = self { return value }
      return nil
    }
  }

  /// What a call resolves to: `{ success, headers, data }`.
  public struct Answer: Sendable, Hashable {
    public var success: Bool
    public var headers: [String: String]
    public var data: JSONValue
  }
}

/// Mira's followers change between syncs, as they do: from the second sweep
/// on, a dozen people have left and three have arrived, so the Unfollow
/// tracker has something to find (`followerChurn`).
final class FollowerChurn: Sendable {
  let counter: FakeXrpc.SweepCounter
  let arrivals: [WorldFollower]
  private let churned = Locked(false)

  init(_ world: AccountWorld, counter: FakeXrpc.SweepCounter) {
    self.counter = counter
    let handles = ["tove.example.org", "quentin.example.net", "zadie.example.com"]
    let names = ["Tove Haddad", "Quentin Abara", ""]
    arrivals = (0..<3).map { i in
      let at = world.now - Double(3 + i * 5) * 3_600_000
      let did = "did:plc:virgaharnessnew\(String.zeroPadded(i, 4))"
      return WorldFollower(
        did: did, handle: handles[i], displayName: names[i], avatar: "",
        viewer: .init(followedBy: "at://\(did)/app.bsky.graph.follow/\(World.tid(at, 900 + i))"))
    }
  }

  func startSweep() {
    let n = counter.next()
    churned.set(!(n < 2))
  }

  func list(_ followers: [WorldFollower]) -> [WorldFollower] {
    guard churned.wrappedValue else { return followers }
    return arrivals + followers.enumerated().filter { $0.offset % 397 != 11 }.map(\.element)
  }
}

/// An agent for one account's world (`createFakeAgent`).
public final class FakeAgent: Sendable {
  /// The account.
  public let did: String
  /// The service calls are proxied to (`did#service`), or nil for the PDS's
  /// default.
  public let proxy: String?
  public let world: DemoWorld
  let core: Core

  final class Core: Sendable {
    let latency: Double
    let scope: @Sendable () -> String?
    let appview: String
    let churn: FollowerChurn?
    let clock: NetworkClock
    let tids: TIDClock
    let asked = Locked<Set<JSKey>>([])

    init(
      latency: Double, scope: @escaping @Sendable () -> String?, appview: String, churn: FollowerChurn?,
      clock: NetworkClock, tids: TIDClock
    ) {
      self.latency = latency
      self.scope = scope
      self.appview = appview
      self.churn = churn
      self.clock = clock
      self.tids = tids
    }
  }

  /// - Parameters:
  ///   - world: every account's world, so posts and people resolve across them
  ///   - did: the account (one of `world`'s)
  ///   - latency: simulated delay per call, in ms (writes take four times as long)
  ///   - scope: reads the scope the session was granted now (a sign-in can
  ///     change it, as turning Defense on does); the world's own by default
  ///   - appview: 'ok', 'failopen' or 'flaky': whether getProfiles counts
  ///     known followers
  ///   - sweepCounter: counts follower sweeps (Mira's churn); one in memory
  ///     by default (the web's is localStorage: pass
  ///     `FakeXrpc.localStorageCounter(store)` for that)
  ///   - clock: `Date.now()` and the waits
  ///   - tids: `nextTid()`
  public init(
    world: DemoWorld,
    did: String,
    latency: Double = 0,
    scope: (@Sendable () -> String?)? = nil,
    appview: String = "ok",
    sweepCounter: FakeXrpc.SweepCounter? = nil,
    clock: NetworkClock = .live,
    tids: TIDClock = .shared
  ) {
    self.did = did
    self.world = world
    proxy = nil
    let churn: FollowerChurn? =
      did.jsEquals(World.me.did) ? world.world(did).map { FollowerChurn($0, counter: sweepCounter ?? FakeXrpc.memoryCounter()) } : nil
    core = Core(
      latency: latency, scope: scope ?? { [world] in world.world(did)?.scope ?? AppConfig.oauthScope }, appview: appview,
      churn: churn, clock: clock, tids: tids)
  }

  init(_ other: FakeAgent, proxy: String?) {
    did = other.did
    world = other.world
    core = other.core
    self.proxy = proxy
  }

  /// `withProxy(serviceType, aud)`: the same account's agent, with its calls
  /// proxied to `aud#serviceType`.
  public func withProxy(_ serviceType: String, _ aud: String) -> FakeAgent {
    FakeAgent(self, proxy: "\(aud)#\(serviceType)")
  }

  /// `handle(nsid, input, opts)`: the call the web makes by the method's
  /// path. `opts` is the call's options object (`encoding`, `headers`).
  /// Cancelling the task is the web's aborted signal.
  public func handle(_ nsid: String, _ input: FakeXrpc.Input = .none, _ opts: JSONValue? = nil) async throws -> FakeXrpc.Answer {
    try Task.checkCancellation()
    let slow = FakeXrpc.listed(FakeXrpc.repoWrites, nsid) || nsid == "com.atproto.repo.uploadBlob"
    let wait = slow ? core.latency * 4 : core.latency
    if wait > 0 { await core.clock.sleep(wait) }
    try Task.checkCancellation()
    guard FakeXrpc.listed(FakeXrpc.methods, nsid) else {
      throw HarnessRepo.XrpcError(501, "MethodNotImplemented", "Method Not Implemented: \(nsid)")
    }
    if FakeXrpc.listed(FakeXrpc.appviewOnly, nsid) && !proxy.jsEquals(FakeXrpc.appviewProxy) {
      throw HarnessRepo.XrpcError(
        501, "MethodNotImplemented",
        "\(nsid) is only answered by Bluesky's AppView; call it through withProxy('bsky_appview', 'did:web:api.bsky.app')")
    }
    let missing = Scopes.missingScopes(core.scope(), try FakeXrpc.scopesFor(nsid, input.json, opts))
    if let first = missing.first {
      throw HarnessRepo.XrpcError(403, "ScopeMissingError", "Missing required scope \"\(first)\"")
    }
    // `input ?? {}`: a null input is an empty one.
    var params: JSONValue = input.json ?? [:]
    if params.isNull { params = [:] }
    let data = try await answer(nsid, params, input, opts ?? [:])
    return FakeXrpc.Answer(success: true, headers: [:], data: data)
  }

  /// `handle(nsid, params)` with JSON params or a JSON body.
  public func handle(_ nsid: String, _ params: JSONValue, _ opts: JSONValue? = nil) async throws -> FakeXrpc.Answer {
    try await handle(nsid, .json(params), opts)
  }

  /// An XRPCAgent (VirgaNetwork) whose calls this agent answers, with no
  /// server in between.
  public func xrpcAgent() -> XRPCAgent {
    XRPCAgent(did: did, fetchHandler: FakeXrpcFetchHandler(agent: self))
  }
}

/// Points VirgaNetwork's XRPCAgent at a fake agent: a query's params are
/// read from the address as Virga's server reads them for its proxy
/// (`FakeServer.forwardedQuery`), a procedure's input is its JSON body (an
/// upload's, its bytes and type), the `atproto-proxy` header is the agent's
/// `withProxy`, and the answer is the XRPC response a PDS would give: the
/// data, or `{ error, message }` with the error's status. An error that
/// isn't an XRPC one (the web's TypeErrors) is thrown as it is.
public struct FakeXrpcFetchHandler: XRPCFetchHandler {
  public var agent: FakeAgent

  public init(agent: FakeAgent) {
    self.agent = agent
  }

  public func handle(_ request: XRPCHandlerRequest) async throws -> HTTPResponse {
    let url = try WebURL(request.path, base: "https://xrpc.invalid")
    let path = url.pathname
    let nsid = path.jsHasPrefix("/xrpc/") ? path.jsSlice(6) : path
    var target = agent
    if let proxy = request.headers.get("atproto-proxy"), !proxy.isEmpty {
      target = FakeAgent(agent, proxy: proxy)
    }
    let input: FakeXrpc.Input
    var opts: JSONValue = [:]
    let type = request.headers.get("content-type")
    if request.method == "POST" {
      if nsid == "com.atproto.repo.uploadBlob" {
        input = .bytes([UInt8](request.body ?? Data()))
        if let type { opts = ["encoding": .string(type)] }
      } else if let body = request.body, !body.isEmpty {
        input = .json((try? JSONValue.parse(body)) ?? .string(String(decoding: body, as: UTF8.self)))
      } else {
        input = .none
      }
    } else {
      input = .json(FakeServer.forwardedQuery(url.searchParams))
    }
    do {
      let answer = try await target.handle(nsid, input, opts)
      return HTTPResponse.json(answer.data, status: 200)
    } catch let error as HarnessRepo.XrpcError {
      return HTTPResponse.json(["error": .string(error.error), "message": .string(error.message)], status: error.status)
    }
  }
}
