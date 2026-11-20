// Ports src/legal/useTermsAcceptance.js
//
// Whether the open account has agreed to the current Terms of Service and
// Privacy Policy, for the app to decide between itself and the agreement
// screen. The decisions are Acceptance's; this holds the state, asks the
// server, and follows a change another window made to the note.
//
//   status  .accepted  go on into the app
//           .checking  a long session with no note here: asking the server
//           .needs     show the agreement screen
//   accept  record the agreement. On a long session it returns once the
//           server has the row and throws when it couldn't be written
//           (Acceptance.acceptFailure words the error), so nobody on a long
//           session is let in without a record; that holds when the
//           session's token has gone too. On a browser session the note is
//           kept at once and the report to the server follows.
//
// The hook's props are `update(did:mode:)`: the view calls it whenever the
// open account changes. An account switched to in place is decided afresh at
// once, so the app never shows for it on the strength of the last account's
// answer. `storageChanged(key:)` stands for the web's `storage` event.

import Foundation
import Observation
import VirgaCore
import VirgaNetwork

@MainActor
@Observable
public final class TermsAcceptanceModel {
  /// Sends a browser session's agreement to the server: `reportAcceptance`.
  public typealias Reporter = @Sendable (_ did: String, _ version: Int) async throws -> Void

  public private(set) var did: String?
  public private(set) var mode: String?
  public private(set) var status: TermsStatus

  @ObservationIgnored private let storage: (any KeyValueStore)?
  @ObservationIgnored private let backendFor: @MainActor (String) -> VirgaBackend?
  @ObservationIgnored private let reporter: Reporter
  @ObservationIgnored private let now: @Sendable () -> Date
  /// The question to the server under way, and what it is about.
  @ObservationIgnored private var check: (task: Task<Void, Never>, did: String)?

  /// Agreements this run of the app has already offered to the server, so a
  /// second model (or a second look) doesn't offer one twice.
  static let reported = Locked<Set<JSKey>>([])

  /// `reportAcceptance` against Virga's server at `backendUrl`.
  public static func reporter(backendUrl: String?, transport: any HTTPTransport = HTTP.transport) -> Reporter {
    { did, version in
      _ = try await TermsService.reportAcceptance(did: did, version: version, backendUrl: backendUrl, transport: transport)
    }
  }

  /// - Parameters:
  ///   - backendFor: the session's `backendFor(did)`, read whenever it is needed.
  ///   - reporter: reports a browser session's agreement (`TermsAcceptanceModel.reporter`).
  public init(
    did: String?,
    mode: String?,
    storage: (any KeyValueStore)?,
    backendFor: @escaping @MainActor (String) -> VirgaBackend?,
    reporter: @escaping Reporter,
    now: @escaping @Sendable () -> Date = { Date() }
  ) {
    self.did = did
    self.mode = mode
    self.storage = storage
    self.backendFor = backendFor
    self.reporter = reporter
    self.now = now
    self.status = .accepted
    self.status = decide()
    effects()
  }

  /// The requester for a long session's account, as the hook reads it.
  private var requester: VirgaBackend? {
    guard let did, !did.isEmpty, mode == "backend" else { return nil }
    return backendFor(did)
  }

  private func decide() -> TermsStatus {
    guard let did, !did.isEmpty else { return .accepted }
    return Acceptance.startingStatus(entry: Acceptance.readAcceptance(storage, did), mode: mode, canAsk: requester != nil)
  }

  /// The hook's props changed: the open account, or how it signed in.
  public func update(did: String?, mode: String?) {
    let sameAccount = did.jsEquals(self.did)
    guard !sameAccount || mode != self.mode else { return }
    self.did = did
    self.mode = mode
    if !sameAccount { status = decide() }
    effects()
  }

  /// Sets the status for `did`, if it is still the open account.
  private func settle(_ did: String, _ next: TermsStatus) {
    guard self.did.jsEquals(did) else { return }
    if status != next {
      status = next
      effects()
    }
  }

  /// The hook's effects, run whenever what they depend on changed.
  private func effects() {
    // A question about another account, or one that no longer needs asking,
    // is called off.
    if let check, !(status == .checking && self.did.jsEquals(check.did)) {
      check.task.cancel()
      self.check = nil
    }
    guard let did, !did.isEmpty else { return }

    // A long session with no note here: the agreement may have been made on
    // another device. If the server can't say, the screen shows.
    if status == .checking, check == nil {
      guard let asked = requester else {
        settle(did, .needs)
        return
      }
      let storage = self.storage
      let task = Task { @MainActor [weak self] in
        do {
          let answer = try await TermsService.fetchTermsStatus(asked)
          if Task.isCancelled { return }
          let next = Acceptance.statusFromAnswer(answer)
          if next == .accepted {
            Acceptance.writeAcceptance(storage, did, at: answer.acceptedAt, recorded: true, identity: "session")
          }
          self?.check = nil
          self?.settle(did, next)
        } catch {
          if Task.isCancelled { return }
          self?.check = nil
          self?.settle(did, .needs)
        }
      }
      check = (task, did)
    }

    // A browser session's agreement that hasn't reached the server yet is
    // offered again, once per run of the app.
    if mode != "backend", status == .accepted {
      let entry = Acceptance.readAcceptance(storage, did)
      let key = JSKey("\(did):\(entry.map { String($0.version) } ?? "undefined")")
      guard let entry, Acceptance.needsReport(entry) else { return }
      let fresh = Self.reported.withLock { $0.insert(key).inserted }
      guard fresh else { return }
      startReport(did, entry)
    }
  }

  /// Send a browser session's agreement to the server, and note how it
  /// went. A server that refuses claims outright won't change its mind on
  /// the next visit, so that agreement stops being offered.
  private func startReport(_ did: String, _ entry: TermsAcceptanceNote) {
    let storage = self.storage
    let reporter = self.reporter
    Task {
      await Self.report(did, entry, storage: storage, reporter: reporter)
    }
  }

  nonisolated static func report(_ did: String, _ entry: TermsAcceptanceNote, storage: (any KeyValueStore)?, reporter: Reporter) async {
    do {
      try await reporter(did, entry.version)
      // The server says nothing back about a claim, so the time stays this
      // device's own.
      var kept = entry
      kept.recorded = true
      kept.identity = "claimed"
      Acceptance.writeAcceptance(storage, did, kept)
    } catch {
      var kept = entry
      kept.tries = JSErrorFields(error)?.codeString == "SESSION_REQUIRED" ? Acceptance.maxReportTries : entry.tries + 1
      Acceptance.writeAcceptance(storage, did, kept)
    }
  }

  /// Another window changed a note (the web's `storage` event): an agreement
  /// made there lets this one in too.
  public func storageChanged(key: String?) {
    guard let did, !did.isEmpty, let key, key.jsEquals(Acceptance.termsKey(did)) else { return }
    if Acceptance.opensGate(Acceptance.readAcceptance(storage, did), mode: mode) { settle(did, .accepted) }
  }

  /// `accept()`: record the agreement.
  public func accept() async throws {
    guard let did, !did.isEmpty else { return }
    let at = JSDate.toISOString(now().timeIntervalSince1970 * 1000)
    let asked = requester
    if mode == "backend" {
      // A long session whose token has gone has nobody to vouch for it. It
      // is not a browser session, and isn't recorded as one.
      guard let asked else {
        throw JSError(message: "This account has no session with Virga’s server", code: "FRONTEND_SESSION_INVALID", status: 401)
      }
      let acceptedAt = try await TermsService.recordAcceptance(asked, version: LegalVersion.termsVersion)
      Acceptance.writeAcceptance(storage, did, at: .string(acceptedAt), recorded: true, identity: "session")
      settle(did, .accepted)
      return
    }
    let entry = TermsAcceptanceNote(version: LegalVersion.termsVersion, at: at, recorded: false, tries: 0, identity: nil)
    Acceptance.writeAcceptance(storage, did, entry)
    Self.reported.withLock { _ = $0.insert(JSKey("\(did):\(entry.version)")) }
    settle(did, .accepted)
    startReport(did, entry)
  }

  /// Calls off a question under way (the view went away).
  public func stop() {
    check?.task.cancel()
    check = nil
  }
}
