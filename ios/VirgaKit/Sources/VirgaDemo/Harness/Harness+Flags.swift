// Ports harness/harness.js (readFlags, createHarness and its workers: cron, stopCron)
//
// The harness put together: the accounts' worlds, Virga's server, the
// agents and the network, read from the address flags. On the web they
// come from the page's query string; on iOS from a launch argument string
// in the same form (`?accounts=1&terms=ask`), read by the same
// `Harness.readFlags`, so a UI test can ask for what a web test asks for.
//
// Address flags (all optional):
//   ?accounts=1      only Mira (the default is Mira and Field Lab)
//   ?mode=browser    accounts are browser sessions (the default is long
//                    sessions through Virga's server). Read as the web reads
//                    it, but the iOS demo has long sessions only (the app
//                    signs in only through Virga's server), so DemoOptions
//                    leaves it out
//   ?signedout       start on the front page, both accounts remembered
//   ?expired=lab     that account (by handle) starts signed out; the other is open
//   ?scope=read      the sessions were granted reading only, as before posting
//   ?defense=on      the sessions were granted Defense's permission too;
//                    ?defense=lists the list writes as well
//   ?defensewrites=off
//                    Virga's server doesn't write Defense's lists
//   ?moderator=off|linked
//                    Virga's moderator isn't set up, or every account starts
//                    linked to it
//   ?limits=3,1,1    per-account limits on scheduled posts, plain timers and
//                    conditional timers; a blank or 0 leaves one unlimited
//   ?ailimits=30,15,3 the monthly AI allowances ('unlimited' for none)
//   ?ai=slow|down    the adviser and alt text take longer than the composer
//                    waits, or are unavailable
//   ?cron=20         how often (seconds) the server's workers run; 0 stops them
//   ?appview=failopen|flaky
//                    the signed-in getProfiles leaves known followers off
//   ?terms=ask|down|newer  nobody has agreed to the Terms of Service yet;
//                    with 'down' the server can't record it either, and with
//                    'newer' its documents are a version ahead of the app's
//                    (a build made before a bump), so it refuses the app's
//                    agreement
//   ?latency=60      simulated delay per request, in ms
//   ?now=<ms>        the moment the made-up world is dated back from

import Foundation
import VirgaCore
import VirgaNetwork

/// `readFlags(search)`'s result.
public struct HarnessFlags: Codable, Hashable, Sendable {
  /// The per-feature limits on scheduled posts and timers (`?limits=`); nil
  /// is unlimited.
  public struct Limits: Codable, Hashable, Sendable {
    public var scheduledPosts: Double?
    public var postTimers: Double?
    public var conditionalTimers: Double?

    public init(scheduledPosts: Double? = nil, postTimers: Double? = nil, conditionalTimers: Double? = nil) {
      self.scheduledPosts = scheduledPosts
      self.postTimers = postTimers
      self.conditionalTimers = conditionalTimers
    }
  }

  /// The monthly AI allowances (`?ailimits=`); nil is unlimited.
  public struct AILimits: Codable, Hashable, Sendable {
    public var adviser: Double?
    public var altText: Double?
    public var style: Double?

    public init(adviser: Double?, altText: Double?, style: Double?) {
      self.adviser = adviser
      self.altText = altText
      self.style = style
    }

    public func encode(to encoder: Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(adviser, forKey: .adviser)
      try c.encode(altText, forKey: .altText)
      try c.encode(style, forKey: .style)
    }
  }

  public var accounts: [WorldAccount]
  /// 'browser' or 'backend'.
  public var mode: String
  public var signedOut: Bool
  /// The handle (its start) of the account that starts signed out.
  public var expired: String?
  /// The scope the sessions were granted.
  public var scope: String
  /// 'ok', 'failopen' or 'flaky'.
  public var appview: String
  public var defenseWrites: Bool
  /// 'on', 'off' or 'linked'.
  public var moderator: String
  public var limits: Limits
  public var aiLimits: AILimits
  /// 'ok', 'slow' or 'down'.
  public var ai: String
  /// 'agreed', 'ask' or 'down'.
  public var terms: String
  public var cronSeconds: Double
  public var latency: Double
  /// The world's `now`, or nil for the clock's.
  public var now: Double?

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(accounts, forKey: .accounts)
    try c.encode(mode, forKey: .mode)
    try c.encode(signedOut, forKey: .signedOut)
    try c.encode(expired, forKey: .expired)
    try c.encode(scope, forKey: .scope)
    try c.encode(appview, forKey: .appview)
    try c.encode(defenseWrites, forKey: .defenseWrites)
    try c.encode(moderator, forKey: .moderator)
    try c.encode(limits, forKey: .limits)
    try c.encode(aiLimits, forKey: .aiLimits)
    try c.encode(ai, forKey: .ai)
    try c.encode(terms, forKey: .terms)
    try c.encode(cronSeconds, forKey: .cronSeconds)
    try c.encode(latency, forKey: .latency)
    try c.encode(now, forKey: .now)
  }
}

extension Harness {
  /// `new URLSearchParams(search)`: the pairs, a leading `?` dropped.
  static func searchPairs(_ search: String) -> [(String, String)] {
    JSURI.parseSearchParams(search)
  }

  /// `/^\d+$/.test(part.trim())`.
  static func isDigits(_ text: String) -> Bool {
    let trimmed = text.jsTrimmed()
    return !trimmed.isEmpty && trimmed.utf16.allSatisfy { (0x30...0x39).contains($0) }
  }

  /// `readLimits(value)`: `?limits=` as the server's per-feature limits; a
  /// blank or 0 is unlimited.
  public static func readLimits(_ value: String?) -> HarnessFlags.Limits {
    let parts = (value ?? "").jsSplit(",").map { part -> Double? in
      let n = JSNumber.toNumber(part)
      return isDigits(part) && n > 0 ? n : nil
    }
    func at(_ i: Int) -> Double? { i < parts.count ? parts[i] : nil }
    return HarnessFlags.Limits(scheduledPosts: at(0), postTimers: at(1), conditionalTimers: at(2))
  }

  /// `readAiLimits(value)`: `?ailimits=` as the monthly AI allowances
  /// (adviser, altText, style); `unlimited` or `none` for none at all.
  public static func readAiLimits(_ value: String?) -> HarnessFlags.AILimits {
    let defaults = FakeServer.defaultAiLimits
    guard let value else { return defaults }
    let word = value.jsTrimmed().lowercased()
    if word == "unlimited" || word == "none" { return HarnessFlags.AILimits(adviser: nil, altText: nil, style: nil) }
    let parts = value.jsSplit(",").map { isDigits($0) ? JSNumber.toNumber($0) : nil }
    func at(_ i: Int) -> Double? { i < parts.count ? parts[i] : nil }
    return HarnessFlags.AILimits(
      adviser: at(0) ?? defaults.adviser, altText: at(1) ?? defaults.altText, style: at(2) ?? defaults.style)
  }

  /// `readFlags(search)`: the address flags, from a query string.
  public static func readFlags(_ search: String) -> HarnessFlags {
    let params = searchPairs(search)
    func get(_ key: String) -> String? { params.first { $0.0.jsEquals(key) }?.1 }
    func has(_ key: String) -> Bool { get(key) != nil }
    func num(_ key: String, _ fallback: Double) -> Double {
      guard let text = get(key) else { return fallback }
      let n = JSNumber.toNumber(text)
      return n.isFinite ? n : fallback
    }
    func oneOf(_ key: String, _ allowed: [String], _ fallback: String) -> String {
      guard let value = get(key), allowed.contains(where: { $0.jsEquals(value) }) else { return fallback }
      return value
    }
    let now = num("now", 0)
    return HarnessFlags(
      accounts: get("accounts") == "1" ? [World.me] : [World.me, World.lab],
      mode: get("mode") == "browser" ? "browser" : "backend",
      signedOut: has("signedout"),
      expired: get("expired").flatMap { $0.isEmpty ? nil : $0 },
      scope: grantedScope(scope: get("scope"), defense: get("defense")),
      appview: oneOf("appview", ["failopen", "flaky"], "ok"),
      defenseWrites: get("defensewrites") != "off",
      moderator: oneOf("moderator", ["off", "linked"], "on"),
      limits: readLimits(get("limits")),
      aiLimits: readAiLimits(get("ailimits")),
      ai: oneOf("ai", ["slow", "down"], "ok"),
      terms: oneOf("terms", ["ask", "down", "newer"], "agreed"),
      cronSeconds: num("cron", 20),
      latency: num("latency", 60),
      now: now > 0 ? now : nil)
  }
}

/// The harness put together (`createHarness(flags, { now })`): the worlds,
/// Virga's server, one agent per account for the life of the harness, and
/// the network over them.
public final class DemoHarness: Sendable {
  public let flags: HarnessFlags
  public let world: DemoWorld
  public let server: DemoServer
  public let clock: NetworkClock
  let makeAgent: @Sendable (String) throws -> FakeAgent

  /// - Parameters:
  ///   - flags: `readFlags`'s.
  ///   - now: the world's `now` (`flags.now ?? Date.now()`); the clock's
  ///     when neither is given.
  ///   - clock: `Date.now()` and the waits, for the server and the agents.
  ///   - timeZone: the zone a written time without an offset is read in.
  ///   - sweepCounter: counts Mira's follower sweeps (the web keeps it in
  ///     localStorage); one in memory by default.
  ///   - randomBytes: the server's tokens' randomness.
  ///   - tids: `nextTid()` for the agents.
  public init(
    flags: HarnessFlags,
    now: Double? = nil,
    clock: NetworkClock = .live,
    timeZone: TimeZone = .gmt,
    sweepCounter: FakeXrpc.SweepCounter? = nil,
    randomBytes: (@Sendable (Int) -> [UInt8])? = nil,
    tids: TIDClock = .shared
  ) {
    self.flags = flags
    self.clock = clock
    let at = now ?? flags.now ?? (clock.now()).rounded(.down)
    let world = DemoWorld(now: at, accounts: flags.accounts, scope: flags.scope, timeZone: timeZone)
    self.world = world
    let registry = Locked<[JSKey: FakeAgent]>([:])
    let latency = flags.latency
    let appview = flags.appview
    let counter = sweepCounter ?? FakeXrpc.memoryCounter()
    let made: @Sendable (String) throws -> FakeAgent = { did in
      try registry.withLock { held in
        if let agent = held[JSKey(did)] { return agent }
        guard world.world(did) != nil else { throw DemoWorldError.noAccount(did) }
        // Read at each call: a sign-in that turns Defense on changes it.
        let agent = FakeAgent(
          world: world, did: did, latency: latency, scope: { world.world(did)?.scope }, appview: appview,
          sweepCounter: counter, clock: clock, tids: tids)
        held[JSKey(did)] = agent
        return agent
      }
    }
    makeAgent = made
    let bytes = randomBytes ?? { count in (0..<count).map { _ in UInt8.random(in: 0...255) } }
    server = DemoServer(
      world: world, terms: flags.terms, limits: FakeServer.limitsOption(flags.limits),
      aiLimits: FakeServer.aiLimitsOption(flags.aiLimits), ai: flags.ai, defenseWrites: flags.defenseWrites,
      moderator: flags.moderator, now: clock.now, sleep: clock.sleep, randomBytes: bytes, agents: made)
  }

  /// The workers' timer (`setInterval(cron, flags.cronSeconds * 1000)`), while it runs.
  let cronTask = Locked<Task<Void, Never>?>(nil)

  /// `window.__harness.cron()`: one run of the server's workers now (due
  /// scheduled posts published, due timers settled, Defense's list items
  /// written).
  @discardableResult
  public func cron() async -> DemoServer.CronRun { await server.runCron() }

  /// install()'s timer: the workers every `flags.cronSeconds` seconds on
  /// the harness's clock (the first run one interval in), until
  /// `stopCron()`. No timer at all when `cronSeconds` is 0 or less, as on
  /// the web. Starting again replaces the running timer.
  public func startCron() {
    guard flags.cronSeconds > 0 else { return }
    let every = flags.cronSeconds * 1000
    let task = Task { [server, clock] in
      while !Task.isCancelled {
        await clock.sleep(every)
        if Task.isCancelled { break }
        await server.runCron()
      }
    }
    cronTask.withLock { running in
      running?.cancel()
      running = task
    }
  }

  /// `window.__harness.stopCron()`.
  public func stopCron() {
    cronTask.withLock { running in
      running?.cancel()
      running = nil
    }
  }

  /// Whether the workers' timer is running.
  public var cronRunning: Bool { cronTask.withLock { $0 != nil } }

  /// The worlds as they are now.
  public var worlds: [AccountWorld] { world.worlds }

  /// `worldOf(did)`.
  public func worldOf(_ did: String) -> AccountWorld? { world.world(did) }

  /// What the account's session was granted now.
  public func grantOf(_ did: String) -> String { world.grantOf(did) }

  /// Sign the account in again with or without Defense's permission, as
  /// Turn on Defense (and Turn off) does: its agent and Virga's server see
  /// the new grant at once. Returns the scope.
  @discardableResult
  public func regrant(_ did: String, defense: Harness.DefenseLevel) throws -> String {
    try world.regrant(did, defense: defense)
  }

  /// The account's agent: the same one for the life of the harness.
  public func agentFor(_ did: String) throws -> FakeAgent { try makeAgent(did) }

  /// The network over the worlds and the server (`installFakeNetwork`'s
  /// fetch): hand it to whatever would send a request.
  public func transport(latency: Double? = nil, videoProcessingMs: Double = 4000) -> DemoTransport {
    DemoTransport(
      world: world, server: server, latency: latency ?? flags.latency, clock: clock, videoProcessingMs: videoProcessingMs)
  }

  /// `install()`: the app's own transport and clock (VirgaNetwork's `HTTP`,
  /// the web's `window.fetch`) become the demo's, so whatever reads the
  /// network without being handed a transport reads the made-up one.
  /// Answers the transport.
  /// It also starts the server's workers (`startCron()`), as the web's
  /// install does, unless `cron` is false.
  @discardableResult
  public func install(latency: Double? = nil, cron: Bool = true) -> DemoTransport {
    let net = transport(latency: latency)
    HTTP.transport = net
    HTTP.clock = clock
    if cron { startCron() }
    return net
  }

  /// `window.__harness.expire(handle)`: ends an account's long session on
  /// the server. Whether there was such an account.
  @discardableResult
  public func expire(_ handle: String) -> Bool {
    guard let found = worlds.first(where: { $0.me.handle.jsHasPrefix(handle) }) else { return false }
    server.expireAccount(found.me.did)
    return true
  }

  /// `window.__harness.refuse(handle)`: its grant is refused while the row
  /// stays.
  @discardableResult
  public func refuse(_ handle: String) -> Bool {
    guard let found = worlds.first(where: { $0.me.handle.jsHasPrefix(handle) }) else { return false }
    server.refuseGrant(found.me.did)
    return true
  }
}
