// Ports src/defense/useDefense.js
//
// What every Defense page needs about the open account: its session, what
// its grant lets Defense do, the sign-in that asks for more (or less), and
// its lists, kept fresh while something is being written to them.
//
// The two hooks are two models over the session (VirgaSession's
// SessionModel, through DefenseSession so a test or a preview can stand
// in): DefenseAccountModel is useDefenseAccount, DefenseListsModel is
// useDefenseLists. The view starts the lists model from its `.task`
// (`start()`), tells it when the account changes (`update(did:)`), and
// stops it when it goes (`stop()`): the hook's mount, props and unmount.
// Between those the lists model follows the session itself, as the hook
// re-renders with it: a sign-out, or a new sign-in's token, gives the
// account another requester (or none), and the lists are read again.

import Foundation
import Observation
import VirgaCore
import VirgaNetwork
import VirgaSession

/// What the Defense models read of the session: the provider's value as
/// useAtprotoSession gives it. SessionModel is one.
@MainActor
public protocol DefenseSession: AnyObject {
  /// The open account's DID.
  var did: String? { get }
  /// Every remembered account, with its status.
  var accounts: [SessionAccount] { get }
  /// The mode new sign-ins get (AUTH_MODE).
  var authMode: String { get }
  /// What the account can do here.
  func capabilitiesFor(_ did: String?) -> AccountCapabilities
  /// A requester for Virga's server as a long-session account, or nil.
  func backendFor(_ did: String?) -> VirgaBackend?
  /// Sign in (again).
  func signIn(_ input: String?, _ options: SignInOptions) async throws
}

extension SessionModel: DefenseSession {}

/// useDefenseAccount: the open account and its Defense permissions, and
/// `askFor(level)`, which signs in again with that much of Defense.
@MainActor
@Observable
public final class DefenseAccountModel {
  /// `asking`: a sign-in under way (`{ busy }`), or the words for one that
  /// didn't start (`{ error }`); nil otherwise.
  public enum Asking: Hashable, Sendable {
    case busy
    case error(String)
  }

  @ObservationIgnored public let session: any DefenseSession
  public private(set) var asking: Asking?

  public init(session: any DefenseSession) {
    self.session = session
  }

  /// The open account's DID.
  public var did: String? { session.did }

  /// The open account's row, or nil.
  public var account: SessionAccount? {
    guard let did = session.did else { return nil }
    return session.accounts.first { $0.did.jsEquals(did) }
  }

  /// What the open account's grant lets it do (`caps`).
  public var caps: AccountCapabilities { session.capabilitiesFor(session.did) }

  /// `askFor(level)`: sign the open account in again with that much of
  /// Defense: `.scan`, `.lists`, or nil to give Defense up (the web's
  /// false). `asking` is busy until the sign-in comes back, then nil, or
  /// the words for why it didn't start. Nothing happens without an account.
  ///
  /// A sign-in called off on the system's sheet (Cancel, or coming back
  /// from the host) has nothing to say, as everywhere else in the app
  /// (SignInFlow.tripFailureNotice's rule): the web's page has left by
  /// then, so its catch only ever sees a sign-in that didn't start.
  public func askFor(_ level: AppConfig.DefenseLevel?) async {
    guard let account else { return }
    asking = .busy
    do {
      let mode = account.mode.isEmpty ? AccountCopy.reauthModeFor(accountMode: account.mode, session.authMode) : account.mode
      try await session.signIn(
        Accounts.accountSignInId(account),
        SignInOptions(mode: mode, intent: "reauth", defense: level.map { .string($0.rawValue) } ?? .bool(false), did: account.did))
      asking = nil
    } catch {
      asking = SignInFlow.tripFailureNotice(error, nil) == nil ? nil : .error(OAuthClient.signInErrorMessage(error))
    }
  }
}

/// useDefenseLists(did): the account's lists, the people it keeps by hand
/// and whether the server writes lists (`data`, `{ lists, kept, writes }`
/// as the server sent it, or nil for an account without a long session),
/// with `error` and `loading`. Read again every 15 seconds while any list
/// has something waiting, so a page shows the writing as it goes.
@MainActor
@Observable
public final class DefenseListsModel {
  /// POLL_MS: how often the lists are read again while something waits.
  public static let pollMs: Double = 15_000

  public private(set) var did: String?
  public private(set) var data: JSONValue?
  public private(set) var error: String?
  public private(set) var loading: Bool

  @ObservationIgnored private let session: any DefenseSession
  @ObservationIgnored private let sleep: @Sendable (Double) async -> Void
  /// The hook's `seq`: only the latest read may set the state.
  @ObservationIgnored private var seq = 0
  @ObservationIgnored private var poll: Task<Void, Never>?
  /// The requester the last read used, as (DID, token): the web's `req`,
  /// whose identity changes with the account and its token.
  @ObservationIgnored private var requesterKey: [String?]?
  /// Between start() and stop(): the session is followed.
  @ObservationIgnored private var watching = false
  /// A change of the session is being listened for.
  @ObservationIgnored private var armed = false

  /// - Parameters:
  ///   - did: the account whose lists these are.
  ///   - sleep: waits the given milliseconds (returning early when
  ///     cancelled); the poll's timer.
  public init(
    did: String?,
    session: any DefenseSession,
    sleep: @escaping @Sendable (Double) async -> Void = { ms in try? await Task.sleep(nanoseconds: UInt64(ms * 1_000_000)) }
  ) {
    self.did = did
    self.session = session
    self.sleep = sleep
    let req = did.flatMap { $0.isEmpty ? nil : session.backendFor($0) }
    loading = req != nil
  }

  /// `req`: the account's requester for Virga's server, or nil.
  public var requester: VirgaBackend? {
    guard let did, !did.isEmpty else { return nil }
    return session.backendFor(did)
  }

  /// Whether any list has something waiting to be written.
  public var waiting: Bool {
    (data?["lists"]?.arrayValue ?? []).contains { $0["waiting"].jsNumber > 0 }
  }

  private func currentKey() -> [String?] {
    let req = requester
    return [did, req.flatMap { $0.token() }]
  }

  /// The hook's mount: the first read, and from then on the session is
  /// followed (a session that is an @Observable, as SessionModel is).
  public func start() async {
    watching = true
    watchSession()
    await refresh()
  }

  /// The hook's `did` changed, or the session did: when that changes the
  /// requester (another account, or a new token), the lists are read again.
  /// As the hook's two effects at that commit: the timer is set again at
  /// once for the new requester (over the lists still shown, so while they
  /// have something waiting), and the lists are read.
  public func update(did: String?) async {
    let changed = !did.jsEquals(self.did)
    self.did = did
    guard changed || requesterKey.map({ !Self.same($0, currentKey()) }) ?? true else { return }
    syncPolling(restart: true)
    await refresh()
  }

  private static func same(_ a: [String?], _ b: [String?]) -> Bool {
    a.count == b.count && zip(a, b).allSatisfy { $0.jsEquals($1) }
  }

  /// The hook's unmount: no more reads on a timer, and the session no
  /// longer followed.
  public func stop() {
    watching = false
    stopPolling()
  }

  private func stopPolling() {
    poll?.cancel()
    poll = nil
  }

  /// The hook re-renders whenever the session changes, and reads
  /// `backendFor(did)` again: here, a change to what the requester is made
  /// from (SessionModel's accounts) looks at it again, through update(did:).
  private func watchSession() {
    guard watching, !armed else { return }
    armed = true
    let session = self.session
    let did = self.did
    withObservationTracking {
      _ = session.backendFor(did)
    } onChange: { [weak self] in
      Task { @MainActor [weak self] in
        guard let self else { return }
        self.armed = false
        guard self.watching else { return }
        self.watchSession()
        await self.update(did: self.did)
      }
    }
  }

  /// `refresh()`: read the lists again. Answers what was read, or nil (no
  /// requester, or the read failed, its words then in `error`, the last
  /// lists kept). A read that an even later one overtook sets nothing.
  @discardableResult
  public func refresh() async -> JSONValue? {
    requesterKey = currentKey()
    guard let req = requester else {
      data = nil
      error = nil
      loading = false
      syncPolling()
      return nil
    }
    seq += 1
    let mine = seq
    loading = true
    do {
      let read = try await DefenseService.fetchLists(req)
      if mine == seq {
        data = read
        error = nil
        loading = false
        syncPolling()
      }
      return read
    } catch {
      if mine == seq {
        self.error = DefenseService.defenseErrorMessage(error)
        loading = false
      }
      return nil
    }
  }

  /// The hook's polling effect: an interval while anything waits, none
  /// otherwise; a new one when the requester changed.
  private func syncPolling(restart: Bool = false) {
    guard waiting else {
      stopPolling()
      return
    }
    if poll != nil && !restart { return }
    poll?.cancel()
    let sleep = self.sleep
    poll = Task { [weak self] in
      while !Task.isCancelled {
        await sleep(Self.pollMs)
        if Task.isCancelled { return }
        // setInterval doesn't wait for the read it starts; neither does
        // this, so stopping the timer never stops a read under way.
        guard let self else { return }
        Task { await self.refresh() }
      }
    }
  }
}
