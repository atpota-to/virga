// Ports src/session/sessionHealth.js
//
// Is an account's sign-in still good? The answer drives the account menu
// ("Sign back in"), the composer's "post as" list, and the hand-off that
// sends someone to sign in again. The rule throughout: a false "signed out"
// is worse than a stale session, so only an answer that can't be anything
// else counts as dead.
//
// For a long session, the check is the server's side-effect-free probe
// (`/oauth/session?lite=1`: one row read, no refresh). Only
// FRONTEND_SESSION_INVALID ("this token's row is gone") is definitive, and
// only once it has been seen three times, 2.5 s apart: a cold server can
// miss a row it has. Everything else is unknown and never marks an account
// as needing a sign-in.

import Foundation
import VirgaCore
import VirgaNetwork

public enum SessionCheckStatus: String, Sendable, Hashable, Codable {
  case valid
  case expired
  case unknown
}

/// `{ status, definitive }`: `definitive` is only ever true alongside expired.
public struct SessionCheckResult: Sendable, Hashable, Codable {
  public var status: SessionCheckStatus
  public var definitive: Bool

  public init(status: SessionCheckStatus, definitive: Bool = false) {
    self.status = status
    self.definitive = definitive
  }

  public static let valid = SessionCheckResult(status: .valid)
  public static let unknown = SessionCheckResult(status: .unknown)
  public static let dead = SessionCheckResult(status: .expired, definitive: true)
}

/// What confirmSessionDead decided.
public enum SessionVerdict: String, Sendable, Hashable {
  /// Every round was definitive: the account has to sign in again.
  case dead
  /// A round came back valid.
  case alive
  /// Anything else; nothing should change.
  case unknown
}

public enum SessionHealth {
  /// Check an account at most this often.
  public static let liteCheckTtlMs: Double = 60_000
  /// Per-probe deadline. The answer is best-effort, so it fails fast.
  public static let liteCheckTimeoutMs: Double = 8_000
  /// How many definitive answers in a row make an account dead, and how far apart.
  public static let confirmRounds = 3
  public static let confirmGapMs: Double = 2_500
  /// At most this many automatic sign-ins per window, per app run.
  public static let reauthLoopMax = 3
  public static let reauthLoopWindowMs: Double = 5 * 60_000
  public static let reauthAttemptsKey = "virga:reauth-attempts"

  /// `interpretLiteSessionResponse({ ok, status, data })`.
  public static func interpretLiteSessionResponse(ok: Bool, status: Int, data: JSONValue?) -> SessionCheckResult {
    if status == 401 || status == 403 {
      let code = data?["code"]
      return SessionCheckResult(status: .expired, definitive: code?.stringValue.map { $0 == "FRONTEND_SESSION_INVALID" } ?? false)
    }
    if !ok { return .unknown }
    if data?["success"].truthy != nil && data?["authenticated"].truthy != nil {
      if data?["oauthSessionMissing"].truthy != nil { return SessionCheckResult(status: .expired) }
      return .valid
    }
    return .unknown
  }

  /// A session check's raw answer, read.
  public static func interpretLiteSessionResponse(_ read: BackendClient.SessionRead) -> SessionCheckResult {
    interpretLiteSessionResponse(ok: read.ok, status: read.status, data: read.data)
  }

  /// `statusFromCheck({ status, definitive })`: 'needsSignIn' only for a
  /// confirmed death, 'ready' for a live one, and 'unknown' when the check
  /// couldn't tell (which an account keeps using).
  public static func statusFromCheck(_ result: SessionCheckResult) -> AccountStatus {
    if result.status == .valid { return .ready }
    if result.status == .expired && result.definitive { return .needsSignIn }
    return .unknown
  }

  /// `setTimeout` as a wait.
  public static let defaultSleep: @Sendable (Double) async -> Void = { ms in
    try? await Task.sleep(nanoseconds: UInt64(max(0, ms) * 1_000_000))
  }

  /// `confirmSessionDead(probe, { rounds, gapMs, sleep })`: confirm that an
  /// account is dead before acting on it. Rounds run one after another, so
  /// they never add to a burst.
  public static func confirmSessionDead(
    _ probe: @Sendable () async throws -> SessionCheckResult?,
    rounds: Int = confirmRounds,
    gapMs: Double = confirmGapMs,
    sleep: @Sendable (Double) async -> Void = defaultSleep
  ) async -> SessionVerdict {
    var round = 0
    while round < rounds {
      if round > 0 { await sleep(gapMs) }
      let result: SessionCheckResult?
      do {
        result = try await probe()
      } catch {
        return .unknown
      }
      if result?.status == .valid { return .alive }
      if !(result?.status == .expired && result?.definitive == true) { return .unknown }
      round += 1
    }
    return .dead
  }

  // MARK: The automatic sign-in loop breaker

  static func recentAttempts(_ storage: (any KeyValueStore)?, _ now: Double) -> [Double] {
    let raw = storage?.getItem(reauthAttemptsKey) ?? ""
    guard let data = try? JSONValue.parse(raw.isEmpty ? "null" : raw) else { return [] }
    let list = data["attempts"]?.arrayValue ?? []
    return list.compactMap { value in
      guard case .number(let ts) = value, ts.isFinite, now - ts < reauthLoopWindowMs else { return nil }
      return ts
    }
  }

  /// Whether automatic sign-ins have run too often lately. When it trips,
  /// the app stops signing in on its own and offers a button.
  public static func reauthLooping(_ storage: (any KeyValueStore)?, now: Double) -> Bool {
    recentAttempts(storage, now).count >= reauthLoopMax
  }

  public static func recordReauthAttempt(_ storage: (any KeyValueStore)?, now: Double) {
    var recent = recentAttempts(storage, now)
    recent.append(now)
    try? storage?.setItem(reauthAttemptsKey, "{\"attempts\":[\(recent.map(JSNumber.format).joined(separator: ","))]}")
  }

  public static func clearReauthAttempts(_ storage: (any KeyValueStore)?) {
    storage?.removeItem(reauthAttemptsKey)
  }
}

/// `createSessionChecker({ probe, now, ttlMs, rounds, gapMs, sleep, onResult })`:
/// a per-account checker with a time-to-live. `check(did)` probes at most
/// once per `ttlMs` per account and shares a probe that's under way. A
/// definitive answer is confirmed (confirmSessionDead) before it is reported
/// as such. `onResult(did, result)` hears every settled answer.
@MainActor
public final class SessionChecker {
  public typealias Probe = @MainActor (String) async throws -> SessionCheckResult

  private let probe: Probe
  private let now: () -> Double
  private let ttlMs: Double
  private let rounds: Int
  private let gapMs: Double
  private let sleep: @Sendable (Double) async -> Void
  private let onResult: (@MainActor (String, SessionCheckResult) -> Void)?
  private var cache: [JSKey: (at: Double, result: SessionCheckResult)] = [:]
  private var inflight: [JSKey: Task<SessionCheckResult, Never>] = [:]

  public init(
    probe: @escaping Probe,
    now: @escaping () -> Double,
    ttlMs: Double = SessionHealth.liteCheckTtlMs,
    rounds: Int = SessionHealth.confirmRounds,
    gapMs: Double = SessionHealth.confirmGapMs,
    sleep: @escaping @Sendable (Double) async -> Void = SessionHealth.defaultSleep,
    onResult: (@MainActor (String, SessionCheckResult) -> Void)? = nil
  ) {
    self.probe = probe
    self.now = now
    self.ttlMs = ttlMs
    self.rounds = rounds
    self.gapMs = gapMs
    self.sleep = sleep
    self.onResult = onResult
  }

  private func run(_ did: String) async -> SessionCheckResult {
    let first: SessionCheckResult
    do {
      first = try await probe(did)
    } catch {
      first = .unknown
    }
    var result = first
    if first.status == .expired && first.definitive {
      // The first round counts; the rest are spaced the same way.
      await sleep(gapMs)
      let probe = self.probe
      let verdict = await SessionHealth.confirmSessionDead({ try await probe(did) }, rounds: rounds - 1, gapMs: gapMs, sleep: sleep)
      if verdict == .alive {
        result = .valid
      } else if verdict != .dead {
        result = SessionCheckResult(status: .expired)
      }
    }
    cache[JSKey(did)] = (now(), result)
    onResult?(did, result)
    return result
  }

  /// `check(did, { force })`.
  @discardableResult
  public func check(_ did: String, force: Bool = false) async -> SessionCheckResult {
    let key = JSKey(did)
    if !force, let held = cache[key], now() - held.at < ttlMs { return held.result }
    if let running = inflight[key] { return await running.value }
    let task = Task { @MainActor in
      let result = await self.run(did)
      self.inflight[key] = nil
      return result
    }
    inflight[key] = task
    return await task.value
  }

  public func forget(_ did: String) {
    cache[JSKey(did)] = nil
  }

  public func peek(_ did: String) -> SessionCheckResult? {
    cache[JSKey(did)]?.result
  }
}
