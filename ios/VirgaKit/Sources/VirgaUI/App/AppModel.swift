// Ports src/main.jsx (what the app is built from)
// Ports src/App.jsx (useProfile)
//
// Everything the app is made of, made once for the process (every window
// shares one session, so the web's "another tab switched accounts" notice
// has no counterpart here): the stores, the preferences, the session with
// its environment, the agreement's model, the open account's profile, the
// session notices, and the lookups the sign-in makes. VirgaRootView puts
// each in the environment.
//
// Demo mode (`-VirgaDemo YES`, read from UserDefaults' argument domain)
// starts signed in as the demo world's first account (World.me, with
// World.lab beside it), over in-memory stores, so the shell and every page
// can be driven without a network. Until the fake XRPC and the fake Virga
// server are ported (VirgaDemo's fakeXrpc.js, fakeNetwork.js and
// fakeServer.js, a later step), the demo's network is a stub that answers
// the agreement's two calls and the sign-out, and turns everything else
// away; that port will replace it. `-VirgaDemoTerms YES` leaves the
// agreement unrecorded, so the agreement screen shows first;
// `-VirgaDemoSignedOut YES` starts with both accounts remembered but signed
// out, on the front page.

#if canImport(UIKit)
import Foundation
import Observation
import SwiftUI
import VirgaCore
import VirgaDemo
import VirgaNetwork
import VirgaSession

/// The lookups the sign-in makes before it leaves: who a handle is, where
/// an account signs in, and the accounts a half-typed handle may be.
public struct SignInLookups: Sendable {
  public var identity: @Sendable (String) async throws -> SignInIdentityAnswer
  public var host: @Sendable (String) async throws -> SignInHost
  public var suggest: @Sendable (String) async throws -> [SignInSuggestion]

  public init(
    identity: @escaping @Sendable (String) async throws -> SignInIdentityAnswer,
    host: @escaping @Sendable (String) async throws -> SignInHost,
    suggest: @escaping @Sendable (String) async throws -> [SignInSuggestion]
  ) {
    self.identity = identity
    self.host = host
    self.suggest = suggest
  }

  /// The public network's: Bluesky's API, the PLC directory, the host.
  public static let network = SignInLookups(
    identity: { try await SignInIdentity.resolveSignInIdentity($0) },
    host: { try await SignInIdentity.resolveSignInHost($0) },
    suggest: { try await SignInSuggest.searchAccounts($0) })
}

/// The open account's public profile: what the account list remembers
/// stands in until the fresh read arrives, so a switch doesn't flash a DID.
public struct AccountProfile: Hashable, Sendable {
  public var handle: String?
  public var displayName: String?
  public var avatar: String?
  public var followersCount: Int?
  public var followsCount: Int?
  public var postsCount: Int?
  public var createdAt: String?
}

/// `useProfile(did, remembered)`.
@MainActor
@Observable
public final class ProfileModel {
  public private(set) var profile: AccountProfile?
  @ObservationIgnored private let fetch: @Sendable (String) async throws -> JSONValue?

  public init(fetch: @escaping @Sendable (String) async throws -> JSONValue?) {
    self.fetch = fetch
  }

  /// Only a change of account starts a fresh read; `remembered` is the
  /// stand-in at that moment. Call it from `.task(id: did)`, which calls an
  /// earlier read off.
  public func load(did: String?, remembered: SessionAccount?) async {
    profile = remembered.map {
      AccountProfile(handle: $0.handle, displayName: $0.displayName, avatar: $0.avatar)
    }
    guard let did, !did.isEmpty else { return }
    guard let read = try? await fetch(did), !Task.isCancelled, read.isTruthy else { return }
    // An account whose handle no longer points at it reads as
    // "handle.invalid", which is not something to print as a name.
    let handle = read["handle"]?.stringValue
    let name = read["displayName"]?.stringValue?.jsTrimmed()
    profile = AccountProfile(
      handle: handle.flatMap { $0.isEmpty || $0 == "handle.invalid" ? nil : $0 },
      displayName: name.flatMap { $0.isEmpty ? nil : $0 },
      avatar: read["avatar"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 },
      followersCount: read["followersCount"]?.intValue,
      followsCount: read["followsCount"]?.intValue,
      postsCount: read["postsCount"]?.intValue,
      createdAt: read["createdAt"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 })
  }
}

@MainActor
@Observable
public final class AppModel {
  public let flags: AppConfig.Flags
  public let isDemo: Bool
  @ObservationIgnored public let stores: AppStores
  public let preferences: PreferencesModel
  public let session: SessionModel
  public let terms: TermsAcceptanceModel
  public let profile: ProfileModel
  public let notices: SessionNoticesModel
  @ObservationIgnored public let lookups: SignInLookups
  /// The posting services a sign-out reads waiting work through
  /// (pendingWork.js). Nil until VirgaPosting's schedule and timer services
  /// are wired to Virga's server: a long session's sign-out then says it
  /// couldn't check, as the web does when the read fails.
  @ObservationIgnored public let pendingWork: PendingWorkServices?
  @ObservationIgnored private var started = false

  init(
    flags: AppConfig.Flags, isDemo: Bool, stores: AppStores, environment: SessionEnvironment, lookups: SignInLookups,
    fetchProfile: @escaping @Sendable (String) async throws -> JSONValue?, reporterTransport: any HTTPTransport
  ) {
    self.flags = flags
    self.isDemo = isDemo
    self.stores = stores
    self.lookups = lookups
    self.pendingWork = nil
    preferences = PreferencesModel(
      store: stores.keyValue, languages: Locale.preferredLanguages, timeZone: .current, systemDark: SystemAppearance.isDark())
    let session = SessionModel(env: environment)
    self.session = session
    terms = TermsAcceptanceModel(
      did: nil, mode: nil, storage: stores.keyValue, backendFor: { [weak session] did in session?.backendFor(did) },
      reporter: TermsAcceptanceModel.reporter(backendUrl: environment.backendUrl, transport: reporterTransport))
    profile = ProfileModel(fetch: fetchProfile)
    notices = SessionNoticesModel(session: session, tabStorage: stores.tab)
  }

  /// The session's start, once for the process.
  public func start() async {
    guard !started else { return }
    started = true
    await session.start()
  }

  // MARK: Building it

  /// The one the app runs: the demo when launched with `-VirgaDemo YES`.
  public static let shared: AppModel = {
    VirgaTypeface.registerIfNeeded()
    let defaults = UserDefaults.standard
    let flags = AppConfig.Flags(infoDictionary: Bundle.main.infoDictionary ?? [:])
    if defaults.bool(forKey: "VirgaDemo") {
      return demo(flags: flags, askTerms: defaults.bool(forKey: "VirgaDemoTerms"), signedOut: defaults.bool(forKey: "VirgaDemoSignedOut"))
    }
    return device(flags: flags)
  }()

  /// Signed in through Virga's server, over the device's stores.
  static func device(flags: AppConfig.Flags) -> AppModel {
    let stores = AppStores.device()
    let environment = SessionEnvironment(
      storage: stores.keyValue, tabStorage: stores.tab, secrets: stores.secrets, backendUrl: flags.backendURL,
      authMode: flags.authMode, authenticator: SystemWebAuthenticator())
    return AppModel(
      flags: flags, isDemo: false, stores: stores, environment: environment, lookups: .network,
      fetchProfile: { did in try await Atproto.getProfile(did) }, reporterTransport: HTTP.transport)
  }

  /// The made-up world (VirgaDemo), signed in, nothing persisted.
  static func demo(flags: AppConfig.Flags, askTerms: Bool, signedOut: Bool = false) -> AppModel {
    let world = DemoWorld(now: Date())
    let now = world.now
    let stores = AppStores.inMemory()
    let accounts = [World.lab, World.me]
    for account in accounts {
      Accounts.recordSignIn(
        stores.keyValue, did: account.did, mode: "backend", handle: account.handle, displayName: account.displayName,
        avatar: account.avatar, scope: .granted(AppConfig.oauthScope), now: now)
      if signedOut {
        Accounts.markSignedOut(stores.keyValue, account.did)
      } else {
        _ = Accounts.writeBackendToken(stores.secrets, account.did, DemoNetwork.token(for: account.did))
      }
      if !askTerms || account.did != World.me.did {
        Acceptance.writeAcceptance(
          stores.keyValue, account.did, at: .string(JSDate.toISOString(now) ?? ""), recorded: true, identity: "session")
      }
    }
    if !signedOut {
      Accounts.writeActiveDid(stores.keyValue, World.me.did)
      SessionHint.writeSessionHint(stores.keyValue)
    }
    let transport = DemoNetwork.transport(now: now)
    let environment = SessionEnvironment(
      storage: stores.keyValue, tabStorage: stores.tab, secrets: stores.secrets, backendUrl: DemoNetwork.server,
      transport: transport, authMode: "backend",
      getProfile: { did in world.views.person(did) },
      resolvePdsUrl: { _ in World.pds },
      rememberPdsUrl: { _, _ in })
    return AppModel(
      flags: flags, isDemo: true, stores: stores, environment: environment, lookups: DemoNetwork.lookups(world),
      fetchProfile: { did in world.views.person(did) }, reporterTransport: transport)
  }
}

/// The demo's network until the fake one is ported: Virga's server answers
/// the agreement (asked, and recorded) and a sign-out; nothing else answers.
enum DemoNetwork {
  static let server = "https://demo.virga.invalid"

  /// A token in the server's shape (`vg_` and 64 hex digits), one per account.
  static func token(for did: String) -> String {
    let digits = SHA256.hash(Array(did.utf8)).map { String(format: "%02x", $0) }.joined()
    return "vg_" + digits
  }

  static func transport(now: Double) -> MockTransport {
    let transport = MockTransport()
    let at = JSONValue.string(JSDate.toISOString(now) ?? "")
    transport.on("GET", .path("/api/terms/status"), respond: .json(["accepted": false, "acceptedAt": .null, "version": .null]))
    transport.on(
      "POST", .path("/api/terms/accept"),
      respond: .json(["success": true, "identity": "session", "acceptedAt": at, "version": .number(Double(LegalVersion.termsVersion))]))
    transport.on(.path("/api/oauth/logout"), respond: .json(["success": true]))
    transport.on(.any, respond: .status(503))
    return transport
  }

  /// The two accounts of the world, by handle; any other handle isn't found.
  static func lookups(_ world: DemoWorld) -> SignInLookups {
    let people = [World.me, World.lab]
    func answer(_ account: WorldAccount) -> SignInIdentityAnswer {
      SignInIdentityAnswer(
        did: account.did, handle: account.handle, displayName: account.displayName, avatar: account.avatar,
        host: SignInIdentity.hostLabelForPds(World.pds), pds: World.pds)
    }
    return SignInLookups(
      identity: { input in
        let wanted = Handle.normalize(input)
        guard let account = people.first(where: { $0.handle.jsEquals(wanted) || $0.did.jsEquals(input) }) else {
          throw DemoLookupError()
        }
        return answer(account)
      },
      host: { _ in
        // Read from the web's shape, `{ host, pds }`, as the lookup answers it.
        let host: JSONValue = SignInIdentity.hostLabelForPds(World.pds).map(JSONValue.string) ?? .null
        return try JSONValue.object(["host": host, "pds": .string(World.pds)]).decode(SignInHost.self)
      },
      suggest: { query in
        let wanted = query.jsLowercased()
        return try people.filter { $0.handle.jsLowercased().hasPrefix(wanted) }.map { account in
          let avatar: JSONValue = account.avatar.map(JSONValue.string) ?? .null
          let row = JSONValue.object([
            "did": .string(account.did), "handle": .string(account.handle), "displayName": .string(account.displayName), "avatar": avatar,
          ])
          return try row.decode(SignInSuggestion.self)
        }
      })
  }

  struct DemoLookupError: Error {}
}
#endif
