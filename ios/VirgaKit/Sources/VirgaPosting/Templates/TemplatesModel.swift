// Ports src/posting/templates/useTemplates.js
//
// An account's post templates for the views, over TemplateService:
//
//   templates, loading, error, ready   observed
//   reload(), create(_:), update(_:_:), remove(_:)
//
// `did` is the account whose repo holds them: in the composer, the account
// it writes as. Without an account, or with `enabled` false, it reads
// nothing and gives empty results. Enabled, it shows the cached copy at
// once, loads once per account (the service shares a load in flight, so a
// page of composers makes one request) and follows every change the
// service makes to that account.
//
// `ready` is true once a load has confirmed the account's templates;
// `error` is the last failed load, with `templates` still the cached copy.
// `reload()` never throws: its failure lands in `error`. `create`, `update`
// and `remove` give the service's result and rethrow, so the editor can
// show the failure beside the form and keep what was typed.
//
// The hook's lifetime maps to calls the view makes: `init` is the first
// render, `start()` the effect (on appear, from `.task`), `setAccount(_:)`
// a new `did` or `enabled` (the effect runs again at once), `stop()` the
// unmount.

import Foundation
import Observation
import VirgaCore
import VirgaNetwork
import VirgaSession

/// What the model needs of the session: an agent for the account whose
/// templates it reads, resolved at call time (the session's agentFor).
@MainActor
public protocol TemplatesSession: AnyObject {
  func templateAgent(for did: String) async throws -> (any TemplateRepoAgent)?
}

extension SessionModel: TemplatesSession {
  public func templateAgent(for did: String) async throws -> (any TemplateRepoAgent)? {
    try await agentFor(did)
  }
}

@MainActor
@Observable
public final class TemplatesModel {
  struct State {
    var did: String?
    var templates: [PostTemplate]
    var loading: Bool
    var error: (any Error)?
    var ready: Bool

    static let idle = State(did: nil, templates: [], loading: false, error: nil, ready: false)
    // Between an account change and the effect that primes for it.
    static let pending = State(did: nil, templates: [], loading: true, error: nil, ready: false)
  }

  /// The account the model reads for: `did` when enabled, else nil.
  public private(set) var forDid: String?
  private var state: State

  @ObservationIgnored public let service: TemplateService
  @ObservationIgnored private let session: any TemplatesSession
  @ObservationIgnored private var unsubscribe: (@MainActor () -> Void)?
  @ObservationIgnored private var started = false
  /// The load the effect started, for tests to wait on.
  @ObservationIgnored private(set) var effectLoad: Task<[PostTemplate], Never>?

  public init(session: any TemplatesSession, did: String?, enabled: Bool = true, service: TemplateService? = nil) {
    let service = service ?? .shared
    self.service = service
    self.session = session
    let forDid = Self.target(did, enabled)
    self.forDid = forDid
    state = forDid.map { Self.primed(service, $0) } ?? .idle
  }

  static func target(_ did: String?, _ enabled: Bool) -> String? {
    guard enabled, let did, !did.isEmpty else { return nil }
    return did
  }

  static func primed(_ service: TemplateService, _ did: String) -> State {
    let ready = service.isLoaded(did)
    return State(did: did, templates: service.primeFromCache(did), loading: !ready, error: nil, ready: ready)
  }

  // MARK: What the view shows

  private var current: State {
    guard let forDid else { return .idle }
    return state.did.jsEquals(forDid) ? state : .pending
  }

  public var templates: [PostTemplate] { current.templates }
  public var loading: Bool { current.loading }
  public var error: (any Error)? { current.error }
  public var ready: Bool { current.ready }

  // MARK: Lifetime

  /// The effect: subscribe to the service for the account, and load it
  /// unless a load has already confirmed it.
  public func start() {
    started = true
    runEffect()
  }

  /// A new `did` or `enabled`: the model reads for that account from now.
  public func setAccount(_ did: String?, enabled: Bool = true) {
    let next = Self.target(did, enabled)
    if next.jsEquals(forDid) { return }
    forDid = next
    if started { runEffect() }
  }

  /// The unmount: stop following the service. A load under way finishes.
  public func stop() {
    started = false
    unsubscribe?()
    unsubscribe = nil
  }

  private func runEffect() {
    unsubscribe?()
    unsubscribe = nil
    guard let forDid else { return }
    // A load that settled between the first render and this went unheard,
    // since nothing was subscribed yet.
    if !(state.did.jsEquals(forDid) && state.ready == service.isLoaded(forDid)) {
      state = Self.primed(service, forDid)
    }
    let service = self.service
    unsubscribe = service.subscribe { [weak self] changed, _ in
      guard let self, changed.jsEquals(forDid) else { return }
      self.patch(forDid) {
        $0.templates = service.list(forDid)
        $0.ready = service.isLoaded(forDid)
      }
    }
    if !service.isLoaded(forDid) {
      effectLoad = Task { [weak self] in await self?.reload() ?? [] }
    }
  }

  private func patch(_ which: String, _ change: (inout State) -> Void) {
    guard state.did.jsEquals(which) else { return }
    change(&state)
  }

  /// The service's view of an account: its DID, and the session's agentFor,
  /// asked at call time.
  private func account(_ did: String?) -> TemplateAccount {
    TemplateAccount(did: did, agentFor: { [weak self] d in try await self?.session.templateAgent(for: d) })
  }

  // MARK: Actions

  /// Load the account's templates again. Never throws: a failure lands in
  /// `error`. Gives the templates, or none when the account changed meanwhile.
  @discardableResult
  public func reload() async -> [PostTemplate] {
    guard let which = forDid else { return [] }
    patch(which) { $0.loading = true }
    do {
      try await service.load(account(which))
      let service = self.service
      patch(which) {
        $0.templates = service.list(which)
        $0.loading = false
        $0.error = nil
        $0.ready = service.isLoaded(which)
      }
    } catch {
      let service = self.service
      patch(which) {
        $0.templates = service.list(which)
        $0.loading = false
        $0.error = error
      }
    }
    return forDid.jsEquals(which) ? service.list(which) : []
  }

  @discardableResult
  public func create(_ template: some TemplateFields) async throws -> PostTemplate {
    try await service.create(template, account(forDid))
  }

  @discardableResult
  public func update(_ rkey: String?, _ template: some TemplateFields) async throws -> PostTemplate {
    try await service.update(rkey, template, account(forDid))
  }

  public func remove(_ rkey: String?) async throws {
    try await service.remove(rkey, account(forDid))
  }
}
