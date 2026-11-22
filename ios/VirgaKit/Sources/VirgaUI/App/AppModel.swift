// Ports src/main.jsx (what the app is built from)
// Ports src/App.jsx (useProfile)
//
// Everything the app is made of, made once for the process (every window
// shares one session, so the web's "another tab switched accounts" notice
// has no counterpart here): the stores, the preferences, the session with
// its environment, the agreement's model, the open account's profile, the
// session notices, and the lookups the sign-in makes. VirgaRootView puts
// each in the environment. The open account's archive (ArchiveProvider's
// useAnalyticsArchive) is made here too, one per signed-in account, and
// held by the view around the shell (App/ArchiveHost.swift).
//
// The session's two hooks into the archive are wired here: deleting an
// account's data deletes its archive's store, and then every store handle
// is started afresh (analyticsStore.js's resetAnalyticsStore).
//
// Demo mode (`-VirgaDemo YES`, read from UserDefaults' argument domain)
// runs the app on VirgaDemo's DemoSession: the made-up world's two
// accounts (Mira, with the full archive, and Field Lab) signed in on this
// device as long sessions, over in-memory stores, with the demo network
// (DemoTransport) in front of the fake Virga server. The first build reads
// Mira's whole archive from it. The harness's flags come in the web's
// address form: `-VirgaDemoFlags "<query>"` for any of them (accounts=1,
// signedout, expired=<handle>, scope=read, defense=on, terms=ask,
// latency=<ms>, now=<time>, appview=…), and the two kept from before,
// `-VirgaDemoTerms YES` (terms=ask: the agreement screen first) and
// `-VirgaDemoSignedOut YES` (signedout: the front page, both accounts
// remembered).

#if canImport(UIKit)
import Foundation
import Observation
import SwiftUI
import VirgaArchive
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
  /// What every account's archive is read through (its file store, the
  /// public network, the clock), less the account itself.
  @ObservationIgnored let archiveEnvironment: ArchiveEnvironment
  /// The demo's session, held for as long as the app runs on its network.
  @ObservationIgnored let demoSession: DemoSession?
  /// The open account's archive, while its shell is up.
  @ObservationIgnored private var openArchive: ArchiveModel?
  @ObservationIgnored private var started = false

  init(
    flags: AppConfig.Flags, isDemo: Bool, stores: AppStores, environment: SessionEnvironment, lookups: SignInLookups,
    fetchProfile: @escaping @Sendable (String) async throws -> JSONValue?, reporterTransport: any HTTPTransport,
    archiveEnvironment: ArchiveEnvironment, demoSession: DemoSession? = nil
  ) {
    self.flags = flags
    self.isDemo = isDemo
    self.stores = stores
    self.lookups = lookups
    self.pendingWork = nil
    self.archiveEnvironment = archiveEnvironment
    self.demoSession = demoSession
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

  // MARK: The archive

  /// The open account's archive, as ArchiveProvider makes it: the account's
  /// agent and handle (the profile's, or what the account list remembers),
  /// over the app's file store, read through the session's transport and
  /// clock. The view that holds it starts it and stops it (ArchiveHost).
  ///
  /// Posts made in the app reach it through VirgaPosting's posting events;
  /// `postsChanged` stays unwired until the composer is ported, as nothing
  /// in the app posts yet.
  /// The open account's archive: the one already made for it, or a new one.
  public func archive(for did: String) -> ArchiveModel {
    if let open = openArchive, open.did.jsEquals(did) { return open }
    let made = makeArchive(did: did)
    openArchive = made
    return made
  }

  /// The account's shell has gone (signed out, or another account opened):
  /// its archive stops, and the next sign-in makes another.
  public func closeArchive(_ archive: ArchiveModel) {
    archive.stop()
    if openArchive === archive { openArchive = nil }
  }

  func makeArchive(did: String) -> ArchiveModel {
    let remembered = session.accounts.first { $0.did.jsEquals(did) }
    let handle = profile.profile?.handle ?? remembered?.handle
    var environment = archiveEnvironment
    environment.postsChanged = nil
    return ArchiveModel(agent: session.did.jsEquals(did) ? session.agent : nil, did: did, handle: handle, environment: environment)
  }

  /// The session's `resetAnalyticsStore`: every store handle starts afresh
  /// (the web drops them all, whichever account's data went).
  static let resetArchiveStores: @Sendable (String?) async -> Void = { _ in
    AnalyticsStore.resetAnalyticsStore()
  }

  /// The session's `deleteDatabase`: `virga-analytics:<did>` is the
  /// archive's store, deleted from the app's file store. The posting store
  /// (`virga-posting:<did>`) isn't ported yet, so there is nothing of it to
  /// delete, and the answer is that nothing went.
  static func deleteDatabase(files: any FileStore) -> @Sendable (String) async -> Bool {
    { name in await AnalyticsStore.deleteDatabase(name, files: files) }
  }

  // MARK: Building it

  /// The one the app runs: the demo when launched with `-VirgaDemo YES`.
  public static let shared: AppModel = {
    VirgaTypeface.registerIfNeeded()
    let defaults = UserDefaults.standard
    var flags = AppConfig.Flags(infoDictionary: Bundle.main.infoDictionary ?? [:])
    if defaults.bool(forKey: "VirgaDemo") {
      // The demo may turn Defense on whatever the build says (`-VirgaDefense
      // on`, and `-VirgaDefenseModerator on` for its moderator), so the UI
      // tests reach its pages; the grant is the harness's
      // (`-VirgaDemoFlags "defense=on"`).
      flags = demoFlags(flags, defense: defaults.string(forKey: "VirgaDefense"), moderator: defaults.string(forKey: "VirgaDefenseModerator"))
      return demo(
        flags: flags,
        search: demoSearch(
          flags: defaults.string(forKey: "VirgaDemoFlags"), askTerms: defaults.bool(forKey: "VirgaDemoTerms"),
          signedOut: defaults.bool(forKey: "VirgaDemoSignedOut")))
    }
    return device(flags: flags)
  }()

  /// The build's flags with the demo's own say on Defense: "on" turns it
  /// (or its moderator) on, anything else leaves the build's word.
  static func demoFlags(_ flags: AppConfig.Flags, defense: String?, moderator: String?) -> AppConfig.Flags {
    let on = defense == "on" || flags.defenseEnabled
    return AppConfig.Flags(
      authMode: flags.authMode, backendURL: flags.backendURL, defenseEnabled: on,
      defenseModeratorEnabled: moderator == "on" || flags.defenseModeratorEnabled)
  }

  /// Signed in through Virga's server, over the device's stores.
  static func device(flags: AppConfig.Flags) -> AppModel {
    let stores = AppStores.device()
    let environment = SessionEnvironment(
      storage: stores.keyValue, tabStorage: stores.tab, secrets: stores.secrets, backendUrl: flags.backendURL,
      authMode: flags.authMode, resetAnalyticsStore: resetArchiveStores, deleteDatabase: deleteDatabase(files: stores.files),
      authenticator: SystemWebAuthenticator())
    return AppModel(
      flags: flags, isDemo: false, stores: stores, environment: environment, lookups: .network,
      fetchProfile: { did in try await Atproto.getProfile(did) }, reporterTransport: HTTP.transport,
      archiveEnvironment: ArchiveEnvironment(files: stores.files, transport: environment.transport, clock: environment.clock))
  }

  /// The harness's address for the demo's launch arguments: `?` and the
  /// flags given, with `terms=ask` and `signedout` for the two kept switches.
  static func demoSearch(flags: String?, askTerms: Bool, signedOut: Bool) -> String {
    var parts: [String] = []
    if let flags {
      let given = flags.hasPrefix("?") ? String(flags.dropFirst()) : flags
      if !given.isEmpty { parts.append(given) }
    }
    if askTerms { parts.append("terms=ask") }
    if signedOut { parts.append("signedout") }
    return "?" + parts.joined(separator: "&")
  }

  /// The made-up world (VirgaDemo's DemoSession), signed in, nothing
  /// persisted. The app's own session model runs over the demo session's
  /// environment, with the archive's two hooks wired as on a device.
  static func demo(flags: AppConfig.Flags, search: String) -> AppModel {
    let stores = AppStores.inMemory()
    let demo = DemoSession(
      options: DemoOptions.read(search), timeZone: .current, storage: stores.keyValue, tabStorage: stores.tab,
      secrets: stores.secrets)
    // The demo server's workers (scheduled posts, timers, Defense's list
    // writes), every `?cron=` seconds (20 unless the flags say), as the web
    // harness's install() starts them.
    demo.startCron()
    var environment = demo.environment
    environment.resetAnalyticsStore = resetArchiveStores
    environment.deleteDatabase = deleteDatabase(files: stores.files)
    let world = demo.world
    return AppModel(
      flags: flags, isDemo: true, stores: stores, environment: environment, lookups: DemoNetwork.lookups(world),
      fetchProfile: { did in world.views.person(did) }, reporterTransport: demo.transport,
      archiveEnvironment: demo.archiveEnvironment(files: stores.files, registry: .shared), demoSession: demo)
  }
}

/// The sign-in's lookups in the demo: the made-up world's accounts, by
/// handle, without leaving the device.
enum DemoNetwork {
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
