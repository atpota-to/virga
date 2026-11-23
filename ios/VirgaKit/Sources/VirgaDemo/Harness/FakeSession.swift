// Ports harness/fakeSession.jsx
//
// The demo's session: the two made-up accounts (Mira, with the full
// archive, and Field Lab, a quiet second account) signed in on this device
// as long sessions, through the app's own session layer. The web harness
// swaps useAtprotoSession for a stand-in provider; on iOS nothing is
// swapped. DemoSession builds VirgaSession's SessionModel (over
// SessionController) with no browser sessions (NoBrowserSessions),
// in-memory key-value and secret stores, and the demo's network
// (DemoTransport) in front of the fake server, then writes what this device
// would hold after both accounts signed in: the account rows, the open
// account, each account's token (minted by the fake server, as a sign-in
// would) and the note that it agreed to the Terms. So switching accounts,
// signing out, the session checks, the agreement screen and a sign-in (the
// sheet is DemoAuthenticator) all run the app's real code against the
// made-up world.
//
// The flags that apply (DemoOptions, read as harness.js reads the address):
// accounts=1, signedout, expired=<handle>, scope=read, defense=on|lists,
// terms=ask|down, latency, now, appview, and the server's: defensewrites,
// moderator, limits, ailimits, ai and cron. `mode` doesn't: the iOS app
// has long sessions only, as it signs in only through Virga's server.
//
// What the web's provider did itself and the real SessionController now
// does: switching (and its wait), signing out per device, a 401 confirmed
// by three lite checks before an account is shown as signed out, agentFor,
// targetFor, backendFor, capabilitiesFor and checkAccount.

import Foundation
import VirgaArchive
import VirgaCore
import VirgaNetwork
import VirgaSession

/// The harness flags the iOS demo reads (`readFlags`'s, less the
/// browser-session mode).
public struct DemoOptions: Sendable, Hashable {
  /// Mira and Field Lab (`?accounts=1`: Mira alone).
  public var accounts: [WorldAccount]
  /// Start on the front page, both accounts remembered (`?signedout`).
  public var signedOut: Bool
  /// The account (by the start of its handle) that starts signed out
  /// (`?expired=lab`); the other is open.
  public var expired: String?
  /// The scope the sessions were granted (`?scope=read`, `?defense=on|lists`).
  public var scope: String
  /// 'agreed', 'ask' (nobody has agreed to the Terms yet) or 'down' (and
  /// the server can't record it either).
  public var terms: String
  /// Simulated delay per request, in ms.
  public var latency: Double
  /// The moment the made-up world is dated back from, or nil for now.
  public var now: Double?
  /// 'ok', 'failopen' or 'flaky': whether the signed-in getProfiles counts
  /// known followers.
  public var appview: String
  /// Whether Virga's server writes Defense's lists (`?defensewrites=off`: no).
  public var defenseWrites: Bool
  /// 'on', 'off' (Virga's moderator isn't set up) or 'linked' (every account starts linked).
  public var moderator: String
  /// The per-feature limits on scheduled posts and timers (`?limits=`).
  public var limits: HarnessFlags.Limits
  /// The monthly AI allowances (`?ailimits=`).
  public var aiLimits: HarnessFlags.AILimits
  /// 'ok', 'slow' or 'down': the adviser and alt text.
  public var ai: String
  /// How often (seconds) the server's workers run once started; 0 never.
  public var cronSeconds: Double

  public init(
    accounts: [WorldAccount] = [World.me, World.lab],
    signedOut: Bool = false,
    expired: String? = nil,
    scope: String = Harness.defaultScope,
    terms: String = "agreed",
    latency: Double = 60,
    now: Double? = nil,
    appview: String = "ok",
    defenseWrites: Bool = true,
    moderator: String = "on",
    limits: HarnessFlags.Limits = HarnessFlags.Limits(),
    aiLimits: HarnessFlags.AILimits = FakeServer.defaultAiLimits,
    ai: String = "ok",
    cronSeconds: Double = 20
  ) {
    self.accounts = accounts
    self.signedOut = signedOut
    self.expired = expired
    self.scope = scope
    self.terms = terms
    self.latency = latency
    self.now = now
    self.appview = appview
    self.defenseWrites = defenseWrites
    self.moderator = moderator
    self.limits = limits
    self.aiLimits = aiLimits
    self.ai = ai
    self.cronSeconds = cronSeconds
  }

  /// The options `flags` carry.
  public init(flags: HarnessFlags) {
    self.init(
      accounts: flags.accounts, signedOut: flags.signedOut, expired: flags.expired, scope: flags.scope, terms: flags.terms,
      latency: flags.latency, now: flags.now, appview: flags.appview, defenseWrites: flags.defenseWrites,
      moderator: flags.moderator, limits: flags.limits, aiLimits: flags.aiLimits, ai: flags.ai,
      cronSeconds: flags.cronSeconds)
  }

  /// A launch argument in the web's address form (`?accounts=1&terms=ask`),
  /// read as `Harness.readFlags` reads it.
  public static func read(_ search: String) -> DemoOptions {
    DemoOptions(flags: Harness.readFlags(search))
  }

  /// The flags for the harness: these options, with long sessions.
  public var flags: HarnessFlags {
    var flags = Harness.readFlags("")
    flags.accounts = accounts
    flags.signedOut = signedOut
    flags.expired = expired
    flags.scope = scope
    flags.terms = terms
    flags.latency = latency
    flags.now = now
    flags.appview = appview
    flags.defenseWrites = defenseWrites
    flags.moderator = moderator
    flags.limits = limits
    flags.aiLimits = aiLimits
    flags.ai = ai
    flags.cronSeconds = cronSeconds
    return flags
  }

  /// `expiredAtStart(id)`.
  public func expiredAtStart(_ account: WorldAccount) -> Bool {
    guard let expired, !expired.isEmpty else { return false }
    return account.handle.jsHasPrefix(expired)
  }
}

/// The signed-in session on the demo's made-up world (the web's
/// AtprotoSessionProvider in harness/fakeSession.jsx).
@MainActor
public final class DemoSession {
  public let options: DemoOptions
  public let harness: DemoHarness
  /// The network every request of this session goes to.
  public let transport: DemoTransport
  /// The web's localStorage and sessionStorage, and the Keychain.
  public let storage: any KeyValueStore
  public let tabStorage: any KeyValueStore
  public let secrets: any SecretStore
  public let clock: NetworkClock
  public let timeZone: TimeZone
  /// The DID documents read so far (atproto.js's cache), this session's own.
  public let didDocuments = PromiseCache<JSONValue>()
  public let pdsResolver: PDSResolver
  public let environment: SessionEnvironment
  /// The app's session, as the views bind to it.
  public let model: SessionModel

  public var world: DemoWorld { harness.world }
  public var server: DemoServer { harness.server }

  /// - Parameters:
  ///   - options: the flags that apply.
  ///   - clock: `Date.now()` and the waits (the network's latency, the
  ///     session checks' pauses, the sign-in sheet's half second).
  ///   - timeZone: the zone a written time without an offset is read in.
  ///   - storage, tabStorage, secrets: the device's stores (fresh ones in
  ///     memory by default, so nothing outlives the demo); the follower
  ///     sweeps are counted in `storage`, as the web counts them in
  ///     localStorage.
  ///   - randomBytes: the server's tokens' randomness.
  public init(
    options: DemoOptions = DemoOptions(),
    clock: NetworkClock = .live,
    timeZone: TimeZone = .gmt,
    storage: any KeyValueStore = InMemoryKeyValueStore(),
    tabStorage: any KeyValueStore = InMemoryKeyValueStore(),
    secrets: any SecretStore = InMemorySecretStore(),
    randomBytes: (@Sendable (Int) -> [UInt8])? = nil
  ) {
    self.options = options
    self.clock = clock
    self.timeZone = timeZone
    self.storage = storage
    self.tabStorage = tabStorage
    self.secrets = secrets
    let harness = DemoHarness(
      flags: options.flags, now: options.now, clock: clock, timeZone: timeZone,
      sweepCounter: FakeXrpc.localStorageCounter(storage), randomBytes: randomBytes)
    self.harness = harness
    let transport = harness.transport()
    self.transport = transport

    // Long sessions hold a token from Virga's server, minted as a sign-in would.
    let openAtStart = harness.worlds.filter { !options.signedOut && !options.expiredAtStart($0.me) }
    for w in openAtStart {
      Accounts.writeBackendToken(secrets, w.me.did, harness.server.mintToken(w.me.did))
    }

    // The note this device keeps that an account agreed to the terms. By
    // default the made-up accounts have agreed, so the app opens as it
    // always has; with `terms` any note is taken away, so the agreement
    // screen is there to look at every time.
    let stamp = World.iso((clock.now()).rounded(.down))
    for w in harness.worlds {
      if options.terms != "agreed" {
        storage.removeItem(Acceptance.termsKey(w.me.did))
      } else if !Acceptance.opensGate(Acceptance.readAcceptance(storage, w.me.did), mode: "backend") {
        Acceptance.writeAcceptance(storage, w.me.did, at: .string(stamp), recorded: true, identity: "session")
      }
    }

    // The accounts this device remembers, Mira first.
    let rows = harness.worlds.enumerated().map { i, w in
      let used = w.now - Double(i) * 86_400_000 * 3
      let open = openAtStart.contains { $0.me.did.jsEquals(w.me.did) }
      return AccountRow(
        did: w.me.did, handle: w.me.handle, displayName: w.profile.displayName, avatar: w.profile.avatar, mode: "backend",
        lastUsed: used, addedAt: used, signedOut: open ? nil : true, scope: w.scope)
    }
    Accounts.writeAccounts(storage, rows)
    Accounts.writeActiveDid(storage, openAtStart.first?.me.did)
    SessionHint.syncSessionHint(storage, rows)

    let documents = didDocuments
    let resolver = PDS.createPdsResolver { did in
      try await Atproto.getDidDocument(did, transport: transport, clock: clock, cache: documents)
    }
    pdsResolver = resolver
    environment = SessionEnvironment(
      storage: storage, tabStorage: tabStorage, secrets: secrets, browser: NoBrowserSessions(),
      backendUrl: FakeServer.serverOrigin, transport: transport, clock: clock, authMode: "backend",
      getProfile: { did in try await Atproto.getProfile(did, transport: transport) },
      resolvePdsUrl: { did in try await resolver.resolvePdsUrl(did) },
      rememberPdsUrl: { did, url in await resolver.remember(did, url) },
      authenticator: DemoAuthenticator(server: harness.server, clock: clock))
    model = SessionModel(env: environment)
  }

  /// The provider's first effect: restore the open account.
  public func start() async {
    await model.start()
  }

  /// What VirgaArchive's ArchiveModel reads the demo through: this
  /// session's network, clock, zone and DID documents, with the archive in
  /// `files` (memory only when nil).
  public func archiveEnvironment(
    files: (any FileStore)?, registry: AnalyticsStoreRegistry = AnalyticsStoreRegistry(), locale: String? = nil
  ) -> ArchiveEnvironment {
    ArchiveEnvironment(
      files: files, registry: registry, transport: transport, clock: clock, didDocuments: didDocuments, timeZone: timeZone,
      locale: locale)
  }

  /// `window.__harness.cron()`: one run of the server's workers now.
  @discardableResult
  public func cron() async -> DemoServer.CronRun { await harness.cron() }

  /// The server's workers every `?cron=` seconds on this session's clock,
  /// as the web harness's install() starts them; the app's demo mode calls
  /// it once the session is up (tests leave it off and call `cron()`).
  public func startCron() { harness.startCron() }

  /// `window.__harness.stopCron()`.
  public func stopCron() { harness.stopCron() }

  /// `window.__harness.expire(handle)`.
  @discardableResult
  public func expire(_ handle: String) -> Bool { harness.expire(handle) }

  /// `window.__harness.refuse(handle)`.
  @discardableResult
  public func refuse(_ handle: String) -> Bool { harness.refuse(handle) }
}
