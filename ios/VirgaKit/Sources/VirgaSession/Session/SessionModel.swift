// Ports src/session/useAtprotoSession.jsx
//
// The session layer as the app's views see it: every account this device
// has signed in with, which one is open, and an agent for any of them.
// The web's provider (AtprotoSessionProvider) holds the controller's state
// in React state; this holds it as observable properties and hands out the
// controller's actions, which is the provider's `value`:
//
//   session, agent, did   the open account, always published together
//   loading               only while the app starts or a sign-in is finished
//   returning             while a sign-in that came back is finished
//   switching             the DID being switched to, while the old one stays up
//   error                 a sign-in that came back without a session
//   signIn, signOut, mode, accounts, switchAccount, signOutAccount,
//   removeAccount, agentFor, targetFor, backendFor, capabilitiesFor,
//   checkAccount, authMode
//
// What the provider takes from the browser comes in through the
// SessionEnvironment instead (browserEnv()): the stores, Virga's server, the
// sign-in sheet, and the archive's reset after an account's data is deleted
// (`resetAnalyticsStore`, which VirgaArchive supplies). The page-load parts
// map to calls the app makes: `start()` for the provider's first effect,
// `completeSignIn(callbackURL:)` for a return that arrives as a link (the
// web's BACKEND_RETURN), `storageChanged(key:)` for the window's `storage`
// event. On iOS every account is a long session held by Virga's server.

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
  /// The mode new sign-ins get (AUTH_MODE).
  public let authMode: String

  /// While the app starts (decided once, as it starts: there is nothing to
  /// wait for when nobody has signed in).
  private var starting: Bool
  /// While a sign-in that came back is taken and its account opened (the
  /// web's page load on the return path).
  private var finishing = false

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
    starting = wanted
    let sink = SessionControllerSink(
      rows: { [weak self] in self?.rows = $0 },
      statuses: { [weak self] in self?.statuses = $0 },
      active: { [weak self] in self?.active = $0 },
      switching: { [weak self] in self?.switching = $0 },
      error: { [weak self] in self?.error = $0 },
      finishing: { [weak self] in self?.finishing = $0 })
    controller = SessionController(set: sink, env: env)
  }

  /// The provider's first effect: restore what there is (nothing, for
  /// someone who has never signed in, who loads none of the session stack),
  /// then stop loading. However often it's called, the restore runs once.
  public func start() async {
    guard restoreWanted else {
      starting = false
      return
    }
    await controller.startOnce()
    starting = false
  }

  // MARK: The open account

  public var session: SessionInfo? { active.session }
  public var agent: XRPCAgent? { active.agent }
  public var did: String? { active.did }
  public var mode: String? { active.mode }
  /// Only while the app starts or a sign-in is finished.
  public var loading: Bool { starting || finishing }
  /// While a sign-in that came back is finished (the web's `returning`:
  /// the page loaded on the return path), which says "Signing you in…".
  public var returning: Bool { finishing }

  /// `accounts`: every remembered account with the status it is shown with
  /// (recomputed when the list or a status changes).
  public var accounts: [SessionAccount] {
    // statuses is read through statusOf; reading it here is what makes a
    // view that shows the list follow a status.
    _ = statuses
    return rows.map { SessionAccount($0, status: controller.statusOf($0.did)) }
  }

  // MARK: Actions

  /// `signIn(input, opts)`. With the app's sign-in sheet it returns once the
  /// sign-in has come back and been taken, or left its error in `error`.
  public func signIn(_ input: String?, _ options: SignInOptions = SignInOptions()) async throws {
    try await controller.signIn(input, options)
  }

  /// `signOut()`: signs the open account out.
  public func signOut() async {
    if let did = active.did { await controller.signOutAccount(did) }
  }

  public func switchAccount(_ did: String?) async throws {
    try await controller.switchAccount(did)
  }

  public func signOutAccount(_ did: String) async {
    await controller.signOutAccount(did)
  }

  /// `removeAccount(did, { deleteData })`.
  public func removeAccount(_ did: String, deleteData: Bool = false) async {
    await controller.removeAccount(did, deleteData: deleteData)
  }

  public func agentFor(_ did: String?) async throws -> XRPCAgent {
    try await controller.agentFor(did)
  }

  public func targetFor(_ did: String) async throws -> SessionTarget {
    try await controller.targetFor(did)
  }

  /// `backendFor(did)`: a requester for Virga's server as a long-session
  /// account, bound to its own token, or nil.
  public func backendFor(_ did: String?) -> VirgaBackend? {
    // Recomputed when the list changes, as the web's callback is.
    _ = rows
    return controller.backendFor(did)
  }

  /// `capabilitiesFor(did)`: what the account can do here.
  public func capabilitiesFor(_ did: String?) -> AccountCapabilities {
    _ = statuses
    let row = Accounts.findAccount(rows, did)
    return SessionController.capabilitiesFrom(row, row.map { controller.statusOf($0.did) } ?? .needsSignIn)
  }

  public func checkAccount(_ did: String) async -> SessionCheckStatus {
    await controller.checkAccount(did)
  }

  /// A return that arrived as a link to the return page (a universal link):
  /// taken as the web's page load on the return path takes BACKEND_RETURN.
  /// Returns whether the address held a return.
  @discardableResult
  public func completeSignIn(callbackURL: String) async -> Bool {
    await controller.completeSignIn(callbackURL: callbackURL)
  }

  /// The window's `storage` event: another window (or an extension sharing
  /// the store) signed an account in or out, and the list here follows.
  /// `key` nil is a store that was cleared.
  public func storageChanged(key: String?) async {
    if key == nil || key.jsEquals(Accounts.accountsKey) { await controller.reread() }
  }

  /// The error a sign-in left, once it has been shown. (The web's stays
  /// until the next page load, which here is the next launch.)
  public func clearError() {
    error = nil
  }
}
