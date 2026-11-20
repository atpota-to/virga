// src/signin/{flow,hosts,identity,suggest}.js against session.signin, and
// src/lib/oauthClient.js against session.oauth.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaSession

private let fixture = "session.signin"
private let appview = "https://appview.test"

/// An error as a fixture writes one.
private func jsError(_ value: JSONValue?) -> JSError? {
  guard let value, !value.isNull else { return nil }
  return JSError(json: value)
}

private func identity(_ value: JSONValue?) -> SignInIdentityAnswer? {
  guard let value, !value.isNull else { return nil }
  return SignInIdentityAnswer(
    did: value["did"]?.stringValue ?? "", handle: value["handle"]?.stringValue, displayName: value["displayName"]?.stringValue,
    avatar: value["avatar"]?.stringValue, host: value["host"]?.stringValue, pds: value["pds"]?.stringValue)
}

private func notice(_ value: JSONValue?) -> SignInNotice? {
  guard let value, !value.isNull else { return nil }
  return SignInNotice(about: value["about"]?.stringValue, text: value["text"]?.stringValue ?? "", anyway: value["anyway"]?.stringValue)
}

/// An event as a fixture writes one: `{ type, … }`.
private func event(_ value: JSONValue) -> SignInFlowEvent {
  let trip = value["trip"]?.intValue
  switch value["type"]?.stringValue ?? "" {
  case "typed": return .typed
  case "notice": return .notice(notice(value["notice"]))
  case "find": return .find
  case "found": return .found(identity(value["identity"]))
  case "lookup-failed": return .lookupFailed(notice(value["notice"]))
  case "not-me": return .notMe
  case "hosts": return .hosts
  case "hosts-back": return .hostsBack
  case "leave": return .leave(host: value["host"]?.stringValue, purpose: value["purpose"]?.stringValue)
  case "host-known": return .hostKnown(trip: trip, host: value["host"]?.stringValue)
  case "sent": return .sent(trip: trip)
  case "stalled": return .stalled(trip: trip)
  case "cancel": return .cancel
  case "trip-failed": return .tripFailed(trip: trip, notice: notice(value["notice"]))
  case let other: return .other(other)
  }
}

private func leaving(_ value: JSONValue?) -> SignInLeaving? {
  guard let value, !value.isNull else { return nil }
  return SignInLeaving(trip: 1, host: value["host"]?.stringValue, purpose: value["purpose"]?.stringValue ?? "signin", from: .entry, phase: "waiting")
}

@Suite struct SignInFlowParity {
  @Test func constants() throws {
    let steps = try Parity.cases(fixture, fn: "STEP")[0]
    let actual: JSONValue = ["ENTRY": "entry", "FINDING": "finding", "FOUND": "found", "HOSTS": "hosts", "LEAVING": "leaving"]
    expectParity(actual, steps)
    #expect([SignInStep.entry, .finding, .found, .hosts, .leaving].map(\.rawValue) == ["entry", "finding", "found", "hosts", "leaving"])
    let timings: JSONValue = [
      "FINDING_MIN_MS": .number(SignInFlow.findingMinMs), "LEAVE_DELAY_MS": .number(SignInFlow.leaveDelayMs),
      "STALL_MS": .number(SignInFlow.stallMs),
    ]
    expectParity(timings, try Parity.cases(fixture, fn: "timings")[0])
    let initial = try Parity.cases(fixture, fn: "initialFlow")[0]
    #expect(Parity.diff(.of(SignInFlow.initialFlow()), initial.output, strictNulls: true) == nil)
    expectParity(.of(SignInHosts.signupHosts), try Parity.cases(fixture, fn: "SIGNUP_HOSTS")[0])
    let suggest: JSONValue = [
      "SUGGEST_MIN_CHARS": .number(Double(SignInSuggest.suggestMinChars)), "SUGGEST_LIMIT": .number(Double(SignInSuggest.suggestLimit)),
      "SUGGEST_DEBOUNCE_MS": .number(SignInSuggest.suggestDebounceMs),
    ]
    expectParity(suggest, try Parity.cases(fixture, fn: "suggestConstants")[0])
  }

  @Test func flowReducer() throws {
    for c in try Parity.cases(fixture, fn: "flowReducer") {
      var state = SignInFlow.initialFlow()
      let expected = c.output.arrayValue ?? []
      for (index, raw) in (c["events"].arrayValue ?? []).enumerated() {
        let next = SignInFlow.flowReducer(state, event(raw))
        // The web's `same` is identity: a state it hands back untouched must
        // be the same value here; a new object may hold the same values.
        if expected[index]["same"] == .bool(true) { #expect(next == state, "\(c) after \(raw): changed") }
        state = next
        let d = Parity.diff(.of(state), expected[index]["state"] ?? .null)
        #expect(d == nil, "\(c) after \(raw): \(d ?? "")")
      }
    }
  }

  @Test func words() throws {
    for c in try Parity.cases(fixture, fn: "notices") {
      let v = c["value"].stringValue ?? ""
      expectParity(["notFound": .of(SignInFlow.notFoundNotice(v)), "lookupFailed": .of(SignInFlow.lookupFailedNotice(v))], c)
    }
    for c in try Parity.cases(fixture, fn: "identityWords") {
      let who = identity(c.input["identity"])
      let actual: JSONValue = [
        "identityName": .string(SignInFlow.identityName(who)), "identityMeta": .string(SignInFlow.identityMeta(who)),
        "continueLabel": .string(SignInFlow.continueLabel(who)),
      ]
      expectParity(actual, c)
    }
    for c in try Parity.cases(fixture, fn: "leavingWords") {
      let card: SignInLeaving? =
        c.input["leaving"]?.isNull == true
        ? nil : SignInLeaving(trip: 1, host: c["host"].stringValue, purpose: c["purpose"].stringValue ?? "signin", from: .entry, phase: "waiting")
      let actual: JSONValue = [
        "leavingTitle": .string(SignInFlow.leavingTitle(card)), "leavingDetail": .string(SignInFlow.leavingDetail(card)),
        "stallLabel": .string(SignInFlow.stallLabel(card)),
      ]
      expectParity(actual, c)
    }
    for c in try Parity.cases(fixture, fn: "tripFailureNotice") {
      let found = SignInFlow.tripFailureNotice(jsError(c.input["error"]), leaving(c.input["leaving"]))
      let d = Parity.diff(found.map { .of($0) } ?? .null, c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func hosts() async throws {
    for c in try Parity.cases(fixture, fn: "notTheHosts") {
      expectParity(.bool(SignInHosts.notTheHosts(jsError(c.input["error"]))), c)
    }
    for c in try Parity.cases(fixture, fn: "signUpAt") {
      let failures = c["failures"].arrayValue ?? []
      let calls = Locked<[JSONValue]>([])
      let o = c["options"]
      let options = SignInOptions(
        mode: o["mode"]?.stringValue, intent: o["intent"]?.stringValue ?? "add", prompt: o["prompt"]?.stringValue, defense: o["defense"],
        did: o["did"]?.stringValue)
      var outcome: JSONValue = .null
      do {
        try await SignInHosts.signUpAt({ hostUrl, opts in
          let n = calls.withLock { list -> Int in
            var recorded: JSONValue = ["intent": .string(opts.intent)]
            if let mode = opts.mode { recorded["mode"] = .string(mode) }
            if let prompt = opts.prompt { recorded["prompt"] = .string(prompt) }
            if let defense = opts.defense { recorded["defense"] = defense }
            if let did = opts.did { recorded["did"] = .string(did) }
            list.append(["hostUrl": .string(hostUrl), "options": recorded])
            return list.count - 1
          }
          if n < failures.count { throw JSError(json: failures[n]) }
        }, "https://old.example", options: options)
        outcome = "gone"
      } catch {
        outcome = ["error": .string(jsMessage(error))]
      }
      var actual: JSONValue = ["calls": .array(calls.wrappedValue)]
      if case .object(let o) = outcome, let error = o["error"] { actual["error"] = error } else { actual["result"] = outcome }
      expectParity(actual, c)
    }
  }
}

@Suite struct SignInIdentityParity {
  @Test func typed() throws {
    for c in try Parity.cases(fixture, fn: "typed") {
      let raw = c["raw"].stringValue
      let normalized = SignInIdentity.normalizeSignInInput(raw)
      let actual: JSONValue = [
        "cleanTyped": .string(SignInIdentity.cleanTyped(raw)), "normalized": .string(normalized),
        "kind": .string(SignInIdentity.classifySignInInput(normalized)),
        "suggestQuery": SignInSuggest.suggestQuery(raw).map(JSONValue.string) ?? .null,
      ]
      expectParity(actual, c)
    }
    for c in try Parity.cases(fixture, fn: "classifySignInInput") {
      expectParity(.string(SignInIdentity.classifySignInInput(c["value"].stringValue)), c)
    }
  }

  @Test func hostNames() throws {
    for c in try Parity.cases(fixture, fn: "hostnameOf") {
      let url = c["url"].stringValue
      let actual: JSONValue = [
        "hostnameOf": SignInIdentity.hostnameOf(url).map(JSONValue.string) ?? .null,
        "hostLabelForPds": SignInIdentity.hostLabelForPds(url).map(JSONValue.string) ?? .null,
      ]
      expectParity(actual, c)
    }
    for c in try Parity.cases(fixture, fn: "handleFromDidDocument") {
      expectParity(SignInIdentity.handleFromDidDocument(c.input["doc"]).map(JSONValue.string) ?? .null, c)
    }
  }

  @Test func resolveSignInHost() async throws {
    for c in try Parity.cases(fixture, fn: "resolveSignInHost") {
      await expectReplay(c) { transport, clock in
        let resolver = SignInIdentity.Resolver(transport: transport, clock: clock.clock, cache: PromiseCache(), appview: appview)
        let did = c["did"].stringValue ?? "did:plc:abcdefghijklmnopqrstuvwx"
        return .of(try await resolver.resolveSignInHost(did, document: c.input["document"]))
      }
    }
  }

  @Test func resolveSignInIdentity() async throws {
    for c in try Parity.cases(fixture, fn: "resolveSignInIdentity") {
      await expectReplay(c) { transport, clock in
        let resolver = SignInIdentity.Resolver(transport: transport, clock: clock.clock, cache: PromiseCache(), appview: appview)
        let input = c["input"].stringValue ?? ""
        do {
          return .of(try await resolver.resolveSignInIdentity(input))
        } catch {
          let fields = JSErrorFields(error)
          let errorInput = (error as? IdentityNotFoundError)?.input ?? (error as? IdentityLookupError)?.input
          return ["error": ["name": .string(fields?.name ?? ""), "message": .string(fields?.message ?? ""), "input": errorInput.map(JSONValue.string) ?? .null]]
        }
      }
    }
  }

  @Test func searchAccounts() async throws {
    for c in try Parity.cases(fixture, fn: "searchAccounts") {
      await expectReplay(c) { transport, _ in
        do {
          return .of(
            try await SignInSuggest.searchAccounts(
              c["term"].stringValue ?? "", limit: c["limit"].intValue ?? SignInSuggest.suggestLimit, appview: appview, transport: transport))
        } catch {
          return ["error": ["message": .string(jsMessage(error)), "status": JSErrorFields(error)?.status.map { .number(Double($0)) } ?? .null]]
        }
      }
    }
  }

  @Test func moveActive() throws {
    for c in try Parity.cases(fixture, fn: "moveActive") {
      expectParity(.number(Double(SignInSuggest.moveActive(c["index"].intValue ?? 0, c["count"].intValue ?? 0, c["key"].stringValue ?? ""))), c)
    }
  }

  /// A lookup called off stops as a cancel.
  @Test func cancelling() async {
    let transport = MockTransport()
    transport.on(.any) { _ in
      withUnsafeCurrentTask { $0?.cancel() }
      throw CancellationError()
    }
    let resolver = SignInIdentity.Resolver(transport: transport, cache: PromiseCache(), appview: appview)
    await #expect(throws: CancellationError.self) { try await resolver.resolveSignInIdentity("mira.example.com") }
  }
}

@Suite struct OAuthClientParity {
  @Test func signInErrorMessage() throws {
    for c in try Parity.cases("session.oauth", fn: "signInErrorMessage") {
      expectParity(.string(OAuthClient.signInErrorMessage(jsError(c.input["error"]))), c)
    }
    // The client's own errors read as the web's do.
    #expect(OAuthClient.signInErrorMessage(BackendError(name: "TypeError", message: "Failed to fetch", code: "NETWORK_ERROR")).hasPrefix("Couldn’t reach Virga’s server."))
    #expect(OAuthClient.signInErrorMessage(nil as (any Error)?) == "Sign-in couldn’t start. Check the handle and try again.")
  }

  @Test func callbackErrorMessage() throws {
    for c in try Parity.cases("session.oauth", fn: "callbackErrorMessage") {
      expectParity(.string(OAuthClient.callbackErrorMessage(jsError(c.input["error"]))), c)
    }
    let declined = BackendClient.readBackendReturn(
      BackendClient.ReturnLocation(pathname: "/oauth/return", search: "?error=access_denied"), nil, "/oauth/return")
    if case .error(let error, _)? = declined {
      #expect(OAuthClient.callbackErrorMessage(error) == "Access wasn’t granted, so you’re not signed in.")
    } else {
      Issue.record("not an error return")
    }
  }
}
