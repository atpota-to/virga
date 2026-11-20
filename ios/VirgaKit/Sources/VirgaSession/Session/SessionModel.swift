// Ports src/session/useAtprotoSession.jsx
//
// The session layer as the app's views see it: every account this device
// has signed in with, which one is open, and an agent for any of them.
// The web's provider holds the controller's state in React state; this
// holds it as observable properties, and hands out the controller's
// actions. On iOS every account is a long session held by Virga's server.
//
//   session, agent, did   the open account, always published together
//   loading               only while the app starts
//   switching             the DID being switched to, while the old one stays up
//   error                 a sign-in that came back without a session
//
// Where the web resets the archive's stores after deleting an account's
// data (resetAnalyticsStore), the environment's `resetAnalyticsStore`
// callback is called: the archive comes later (VirgaArchive).

import Foundation
import Observation
import VirgaCore
import VirgaNetwork

@MainActor
@Observable
public final class SessionModel {
  public private(set) var rows: [AccountRow]
  public private(set) var statuses: [String: AccountStatus] = [:]
  public private(set) var active = SessionController.noActive
  public private(set) var switching: String?
  public private(set) var error: (any Error)?
  public private(set) var loading: Bool
  /// The mode new sign-ins get.
  public let authMode: String

  @ObservationIgnored public private(set) var controller: SessionController!
  @ObservationIgnored private let restoreWanted: Bool

  public init(env: SessionEnvironment) {
    let list = Accounts.readAccounts(env.storage)
    rows = list
    authMode = env.authMode
    // Whether there is anything to restore. Decided once, as the app starts.
    let wanted = SessionHint.restoresAtStartup(
      hint: SessionHint.readSessionHint(env.storage),
      onCallback: env.onCallbackPath,
      onReturn: env.backendReturn != nil,
      hasAccounts: !Accounts.signedInAccounts(list).isEmpty)
    restoreWanted = wanted
    loading = wanted
    let sink = SessionControllerSink(
      rows: { [weak self] in self?.rows = $0 },
      statuses: { [weak self] in self?.statuses = $0 },
      active: { [weak self] in self?.active = $0 },
      switching: { [weak self] in self?.switching = $0 },
      error: { [weak self] in self?.error = $0 })
    controller = SessionController(set: sink, env: env)
  }

  /// The provider's start: restore what there is (nothing, for someone who
  /// has never signed in), then stop loading.
  public func start() async {
    guard restoreWanted else {
      loading = false
      return
    }
    await controller.startOnce()
    loading = false
  }

  // MARK: The open account

  public var session: SessionInfo? { active.session }
  public var agent: XRPCAgent? { active.agent }
  public var did: String? { active.did }
  public var mode: String? { active.mode }

  /// Every remembered account with the status it is shown with.
  public var accounts: [SessionAccount] {
    rows.map { SessionAccount($0, status: controller.statusOf($0.did)) }
  }

  // MARK: Actions

  public func signIn(_ input: String?, _ options: SignInOptions = SignInOptions()) async throws {
    try await controller.signIn(input, options)
  }

  /// Signs the open account out.
  public func signOut() async {
    if let did = active.did { await controller.signOutAccount(did) }
  }

  public func switchAccount(_ did: String?) async throws {
    try await controller.switchAccount(did)
  }

  public func signOutAccount(_ did: String) async {
    await controller.signOutAccount(did)
  }

  public func removeAccount(_ did: String, deleteData: Bool = false) async {
    await controller.removeAccount(did, deleteData: deleteData)
  }

  public func agentFor(_ did: String?) async throws -> XRPCAgent {
    try await controller.agentFor(did)
  }

  public func targetFor(_ did: String) async throws -> SessionTarget {
    try await controller.targetFor(did)
  }

  public func backendFor(_ did: String?) -> VirgaBackend? {
    controller.backendFor(did)
  }

  /// `capabilitiesFor(did)`: what the account can do here.
  public func capabilitiesFor(_ did: String?) -> AccountCapabilities {
    let row = Accounts.findAccount(rows, did)
    return SessionController.capabilitiesFrom(row, row.map { controller.statusOf($0.did) } ?? .needsSignIn)
  }

  public func checkAccount(_ did: String) async -> SessionCheckStatus {
    await controller.checkAccount(did)
  }

  /// A return that arrived some other way (a universal link to the return
  /// page): finished as a sign-in's own return is.
  public func completeSignIn(callbackURL: String) async {
    await controller.completeSignIn(callbackURL: callbackURL)
  }

  /// Another window changed the account list (the web's `storage` event on
  /// `virga:accounts`): the list here follows.
  public func storageChanged(key: String?) async {
    if key == nil || key.jsEquals(Accounts.accountsKey) { await controller.reread() }
  }

  /// The error a sign-in left, once it has been shown.
  public func clearError() {
    error = nil
  }
}
