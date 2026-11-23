// src/session/scopes.js against session.scopes, and
// src/session/sessionHealth.js against session.health.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaSession

/// A scope as a fixture writes one: a string, a list, or null.
private func scopeList(_ value: JSONValue?) -> ScopeList {
  switch value {
  case .array(let items)?: return .list(items.compactMap(\.stringValue))
  case .string(let text)?: return .text(text)
  default: return .text(nil)
  }
}

@Suite struct ScopesParity {
  @Test func parseScopeToken() throws {
    for c in try Parity.cases("session.scopes", fn: "parseScopeToken") {
      let token = c["token"].stringValue ?? (c["token"].isNull ? nil : c["token"].jsString)
      let parsed = Scopes.parseScopeToken(token)
      let actual: JSONValue = ["parsed": parsed.map { .of($0) } ?? .null, "valid": .bool(Scopes.isValidScopeToken(token))]
      let d = Parity.diff(actual, c.output, strictNulls: true)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func missingScopes() throws {
    for c in try Parity.cases("session.scopes", fn: "missingScopes") {
      let missing = Scopes.missingScopes(scopeList(c.input["granted"]), scopeList(c.input["wanted"]))
      expectParity(.array(missing.map(JSONValue.string)), c)
    }
  }

  @Test func isMissingScopeError() throws {
    for c in try Parity.cases("session.scopes", fn: "isMissingScopeError") {
      let e = c["error"]
      let actual = e.isNull ? false : Scopes.isMissingScopeError(error: e["error"]?.stringValue, message: e["message"]?.stringValue)
      expectParity(.bool(actual), c)
    }
    // From the errors the app meets.
    #expect(Scopes.isMissingScopeError(XRPCError(statusCode: 403, error: "ScopeMissingError", message: "Missing required scope \"repo:app.bsky.feed.post\"")))
    #expect(Scopes.isMissingScopeError(nil) == false)
    #expect(Scopes.isMissingScopeError(BackendError(message: "Record not found")) == false)
  }

  /// scopes.test.js: every token Virga asks for parses, and the posting ones
  /// are among them.
  @Test func theTokensVirgaAsksFor() {
    for token in AppConfig.oauthScope.split(separator: " ").map(String.init) {
      #expect(Scopes.isValidScopeToken(token), "\(token)")
    }
    #expect(Scopes.missingScopes(AppConfig.oauthScope, AppConfig.postingTokens) == [])
    #expect(Scopes.missingScopes(.text(AppConfig.oauthScope), .text(AppConfig.oauthScope)) == [])
  }
}

/// A probe answering from a list in turn, logging each call.
private final class Script: @unchecked Sendable {
  let answers: [JSONValue]
  let log = Locked<[JSONValue]>([])
  let count = Locked(0)

  init(_ answers: [JSONValue]) {
    self.answers = answers
  }

  func note(_ entry: JSONValue) { log.withLock { $0.append(entry) } }

  func answer(_ did: String?) throws -> SessionCheckResult? {
    let n = count.withLock { value -> Int in
      defer { value += 1 }
      return value
    }
    note(["probe", did.map(JSONValue.string) ?? .null])
    let answer = answers[min(n, answers.count - 1)]
    if answer == "throw" { throw JSError(message: "offline") }
    return result(answer)
  }

  func result(_ value: JSONValue) -> SessionCheckResult? {
    guard let status = value["status"]?.stringValue.flatMap(SessionCheckStatus.init(rawValue:)) else { return nil }
    return SessionCheckResult(status: status, definitive: value["definitive"]?.boolValue ?? false)
  }
}

@MainActor
@Suite struct SessionHealthParity {
  private let fixture = "session.health"

  @Test func constants() throws {
    let c = try Parity.cases(fixture, fn: "constants")[0]
    let actual: JSONValue = [
      "LITE_CHECK_TTL_MS": .number(SessionHealth.liteCheckTtlMs),
      "LITE_CHECK_TIMEOUT_MS": .number(SessionHealth.liteCheckTimeoutMs),
      "CONFIRM_ROUNDS": .number(Double(SessionHealth.confirmRounds)),
      "CONFIRM_GAP_MS": .number(SessionHealth.confirmGapMs),
      "REAUTH_LOOP_MAX": .number(Double(SessionHealth.reauthLoopMax)),
      "REAUTH_LOOP_WINDOW_MS": .number(SessionHealth.reauthLoopWindowMs),
      "REAUTH_ATTEMPTS_KEY": .string(SessionHealth.reauthAttemptsKey),
      "SESSION_CHECK_STATUS": ["VALID": "valid", "EXPIRED": "expired", "UNKNOWN": "unknown"],
    ]
    expectParity(actual, c)
    #expect([SessionCheckStatus.valid, .expired, .unknown].map(\.rawValue) == ["valid", "expired", "unknown"])
  }

  @Test func interpretLiteSessionResponse() throws {
    for c in try Parity.cases(fixture, fn: "interpretLiteSessionResponse") {
      let result = SessionHealth.interpretLiteSessionResponse(
        ok: c["ok"].boolValue ?? false, status: c["status"].intValue ?? 0, data: c.input["data"].nonNull)
      expectParity(.of(result), c)
    }
  }

  @Test func statusFromCheck() throws {
    for c in try Parity.cases(fixture, fn: "statusFromCheck") {
      let result = SessionCheckResult(status: SessionCheckStatus(rawValue: c["status"].stringValue ?? "")!, definitive: c["definitive"].boolValue ?? false)
      expectParity(.string(SessionHealth.statusFromCheck(result).rawValue), c)
    }
  }

  @Test func confirmSessionDead() async throws {
    for c in try Parity.cases(fixture, fn: "confirmSessionDead") {
      let script = Script(c["answers"].arrayValue ?? [])
      let verdict = await SessionHealth.confirmSessionDead(
        { try script.answer(nil) },
        rounds: c["rounds"].intValue ?? SessionHealth.confirmRounds,
        gapMs: c["gapMs"].doubleValue ?? SessionHealth.confirmGapMs,
        sleep: { ms in script.note(["sleep", .number(ms)]) })
      expectParity(["verdict": .string(verdict.rawValue), "log": .array(script.log.wrappedValue)], c)
    }
  }

  @Test func createSessionChecker() async throws {
    for c in try Parity.cases(fixture, fn: "createSessionChecker") {
      let script = Script(c["answers"].arrayValue ?? [])
      var t: Double = 1_000
      let checker = SessionChecker(
        probe: { did in try script.answer(did)! },
        now: { t },
        ttlMs: c["ttlMs"].doubleValue ?? SessionHealth.liteCheckTtlMs,
        rounds: c["rounds"].intValue ?? SessionHealth.confirmRounds,
        gapMs: c["gapMs"].doubleValue ?? SessionHealth.confirmGapMs,
        sleep: { ms in script.note(["sleep", .number(ms)]) },
        onResult: { did, result in script.note(["result", .string(did), .of(result)]) })
      for step in c["steps"].arrayValue ?? [] {
        if let advance = step["advance"]?.doubleValue {
          t += advance
        } else if let did = step["forget"]?.stringValue {
          checker.forget(did)
        } else if let did = step["peek"]?.stringValue {
          script.note(["peek", .string(did), checker.peek(did).map { .of($0) } ?? .null])
        } else if let did = step["check"]?.stringValue {
          let force = step["force"]?.boolValue ?? false
          let together = step["together"]?.intValue ?? 1
          let runs = (0..<together).map { _ in Task { @MainActor in await checker.check(did, force: force) } }
          var results: [SessionCheckResult] = []
          for run in runs { results.append(await run.value) }
          script.note(["checked", .string(did), .array(results.map { .of($0) })])
        }
      }
      expectParity(.array(script.log.wrappedValue), c)
    }
  }

  @Test func reauthLoop() throws {
    for c in try Parity.cases(fixture, fn: "reauthLoop") {
      let store = InMemoryKeyValueStore()
      if let stored = c["stored"].stringValue { try store.setItem(SessionHealth.reauthAttemptsKey, stored) }
      var out: [JSONValue] = []
      for step in c["steps"].arrayValue ?? [] {
        let at = step[1]?.doubleValue ?? 0
        var answer: JSONValue = .null
        switch step[0]?.stringValue {
        case "record": SessionHealth.recordReauthAttempt(store, now: at)
        case "clear": SessionHealth.clearReauthAttempts(store)
        default: answer = .bool(SessionHealth.reauthLooping(store, now: at))
        }
        out.append(["answer": answer, "stored": store.getItem(SessionHealth.reauthAttemptsKey).map(JSONValue.string) ?? .null])
      }
      expectParity(.array(out), c)
    }
    #expect(SessionHealth.reauthLooping(nil, now: 0) == false)
  }
}

