// src/session/accounts.js, src/accounts/accountCopy.js,
// src/lib/sessionHint.js and src/accounts/pendingWork.js against
// session.accounts.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaSession

private let fixture = "session.accounts"

/// An account as a fixture writes one, for the naming functions.
private struct Named: AccountLike {
  var did: String
  var handle: String?
  var displayName: String?
  var avatar: String?

  init?(_ value: JSONValue?) {
    guard let value, !value.isNull else { return nil }
    did = value["did"]?.stringValue ?? ""
    handle = value["handle"]?.stringValue
    displayName = value["displayName"]?.stringValue
    avatar = value["avatar"]?.stringValue
  }
}

/// A row as a fixture writes one (the list functions take rows as they are).
private func row(_ value: JSONValue) -> AccountRow {
  AccountRow(
    did: value["did"]?.stringValue ?? "",
    handle: value["handle"]?.stringValue,
    displayName: value["displayName"]?.stringValue,
    avatar: value["avatar"]?.stringValue,
    mode: value["mode"]?.stringValue ?? "browser",
    // Missing is not a finite number, which cleanRow reads as the web does.
    lastUsed: value["lastUsed"]?.doubleValue ?? .nan,
    addedAt: value["addedAt"]?.doubleValue ?? .nan,
    signedOut: value["signedOut"] == .bool(true) ? true : nil,
    scope: value["scope"]?.stringValue)
}

private func rows(_ value: JSONValue?) -> [AccountRow]? {
  value?.arrayValue.map { $0.map(row) }
}

/// Fields merged by updateAccount, as a fixture writes them.
private func apply(_ fields: JSONValue, to row: inout AccountRow) {
  for (key, value) in fields.objectValue ?? [:] {
    switch key {
    case "did": row.did = value.stringValue ?? row.did
    case "handle": row.handle = value.stringValue
    case "displayName": row.displayName = value.stringValue
    case "avatar": row.avatar = value.stringValue
    case "mode": row.mode = value.stringValue ?? row.mode
    case "scope": row.scope = value.stringValue
    case "signedOut": row.signedOut = value == .bool(true) ? true : nil
    case "lastUsed": row.lastUsed = value.doubleValue ?? .nan
    default: Issue.record("no field \(key)")
    }
  }
}

/// Both stores, as the web's one localStorage holds them.
private func stored(_ store: InMemoryKeyValueStore, _ secrets: InMemorySecretStore) -> JSONValue {
  var out: [String: JSONValue] = [:]
  for key in store.allKeys() { out[key] = .string(store.getItem(key) ?? "") }
  for (key, value) in secrets.snapshot { out[key] = .string(value) }
  return .object(out)
}

private func runStep(_ op: JSONValue, _ store: InMemoryKeyValueStore, _ secrets: InMemorySecretStore) -> JSONValue {
  let did = op["did"]?.stringValue
  switch op["op"]?.stringValue {
  case "recordSignIn":
    var scope = SignInScope.unsaid
    if let given = op["scope"] { scope = given.stringValue.map(SignInScope.granted) ?? .cleared }
    return .of(
      Accounts.recordSignIn(
        store, did: did ?? "", mode: op["mode"]?.stringValue ?? "", handle: op["handle"]?.stringValue,
        displayName: op["displayName"]?.stringValue, avatar: op["avatar"]?.stringValue, scope: scope,
        now: op["now"]?.doubleValue ?? 0))
  case "updateAccount":
    return .of(Accounts.updateAccount(store, did ?? "") { apply(op["fields"] ?? [:], to: &$0) })
  case "touchAccount":
    return .of(Accounts.touchAccount(store, did ?? "", now: op["now"]?.doubleValue ?? 0))
  case "markSignedOut":
    return .of(Accounts.markSignedOut(store, did ?? ""))
  case "forgetAccount":
    return .of(Accounts.forgetAccount(store, did ?? "", secrets: secrets))
  case "writeAccounts":
    return .of(Accounts.writeAccounts(store, rows(op["list"]) ?? []))
  case "writeActiveDid":
    Accounts.writeActiveDid(store, did)
    return .null
  case "readActiveDid":
    return Accounts.readActiveDid(store).map(JSONValue.string) ?? .null
  case "writeBackendToken":
    return .bool(Accounts.writeBackendToken(secrets, did, op["token"]?.stringValue))
  case "readBackendToken":
    return Accounts.readBackendToken(secrets, did ?? "").map(JSONValue.string) ?? .null
  case "removeBackendToken":
    Accounts.removeBackendToken(secrets, did ?? "")
    return .null
  case "writeOpenAtSignIn":
    Accounts.writeOpenAtSignIn(store, did)
    return .null
  case "takeOpenAtSignIn":
    return Accounts.takeOpenAtSignIn(store).map(JSONValue.string) ?? .null
  case "removeLocalData":
    return .array(Accounts.removeLocalData(store, did ?? "").sorted().map(JSONValue.string))
  default:
    Issue.record("no step \(op)")
    return .null
  }
}

@Suite struct AccountsParity {
  @Test func constants() throws {
    func check(_ fn: String, _ actual: JSONValue) throws {
      let d = Parity.diff(actual, try Parity.cases(fixture, fn: fn)[0].output)
      #expect(d == nil, "\(fn): \(d ?? "")")
    }
    try check("ACCOUNTS_KEY", .string(Accounts.accountsKey))
    try check("ACTIVE_KEY", .string(Accounts.activeKey))
    try check("MODES", .array(Accounts.modes.map(JSONValue.string)))
    try check("SESSION_EXPIRED_EVENT", .string(Accounts.sessionExpiredEvent))
    try check("OPEN_AT_SIGNIN_KEY", .string(Accounts.openAtSignInKey))
    try check("REAUTH_REQUIRED_CODE", .string(Accounts.reauthRequiredCode))
    try check("backendTokenKey", .string(Accounts.backendTokenKey("did:plc:virgaharnessmira2zq4x")))
    try check("REAUTH_REQUEST_EVENT", .string(AccountCopy.reauthRequestEvent))
    try check("SESSION_NOTICE_EVENT", .string(AccountCopy.sessionNoticeEvent))
    try check("POSTING_REGRANT_MESSAGE", .string(AccountCopy.postingRegrantMessage))
    try check("SESSION_HINT_KEY", .string(SessionHint.sessionHintKey))
    let tokens = ["vg_" + String(repeating: "a1", count: 32)]
    let samples: [String?] = [tokens[0], tokens[0].uppercased(), tokens[0] + "0", "vg_", "", nil]
    try check("isBackendToken", .array(samples.map { .bool(Accounts.isBackendToken($0)) }))
  }

  @Test func isDid() throws {
    for c in try Parity.cases(fixture, fn: "isDid") {
      expectParity(.bool(Accounts.isDid(c["value"].stringValue)), c)
    }
  }

  @Test func readAccounts() throws {
    for c in try Parity.cases(fixture, fn: "readAccounts") {
      let store = InMemoryKeyValueStore()
      if let text = c["stored"].stringValue { try store.setItem(Accounts.accountsKey, text) }
      let d = Parity.diff(.of(Accounts.readAccounts(store)), c.output, strictNulls: true)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
    #expect(Accounts.readAccounts(nil).isEmpty)
  }

  /// Each script's steps: what they return, and everything stored after.
  @Test func scripts() throws {
    for c in try Parity.cases(fixture, fn: "script") {
      let store = InMemoryKeyValueStore()
      let secrets = InMemorySecretStore()
      for (key, value) in c["stored"].objectValue ?? [:] {
        if key.hasPrefix("virga:backend-token:") {
          try secrets.setSecret(value.stringValue ?? "", for: key)
        } else {
          try store.setItem(key, value.stringValue ?? "")
        }
      }
      let expected = c.output.arrayValue ?? []
      for (index, op) in (c["ops"].arrayValue ?? []).enumerated() {
        let result = runStep(op, store, secrets)
        let actual: JSONValue = ["result": result, "stored": stored(store, secrets)]
        let d = Parity.diff(actual, expected[index], strictNulls: true)
        #expect(d == nil, "\(c) step \(index) \(op): \(d ?? "")")
      }
    }
  }

  @Test func whichAccount() throws {
    for c in try Parity.cases(fixture, fn: "findAccount") {
      let found = Accounts.findAccount(rows(c.input["list"]), c["did"].stringValue)
      expectParity(found.map { .string($0.did) } ?? .null, Parity.dids(c))
    }
    for c in try Parity.cases(fixture, fn: "signedInAccounts") {
      let live = Accounts.signedInAccounts(rows(c.input["list"]))
      expectParity(.array(live.map { .string($0.did) }), Parity.dids(c))
    }
    for c in try Parity.cases(fixture, fn: "pickActiveAccount") {
      let picked = Accounts.pickActiveAccount(rows(c.input["list"]), c["activeDid"].stringValue)
      expectParity(picked.map { .string($0.did) } ?? .null, Parity.dids(c))
    }
    for c in try Parity.cases(fixture, fn: "nextReadyAccount") {
      let needs = c["needsSignIn"].stringValue
      let next = Accounts.nextReadyAccount(rows(c.input["list"]), c["did"].stringValue) { $0 == needs ? "needsSignIn" : "ready" }
      expectParity(next.map { .string($0.did) } ?? .null, Parity.dids(c))
    }
  }

  @Test func naming() throws {
    for c in try Parity.cases(fixture, fn: "naming") {
      let account = Named(c.input["account"])
      let actual: JSONValue = [
        "accountName": .string(Accounts.accountName(account)),
        "accountHandle": Accounts.accountHandle(account).map(JSONValue.string) ?? .null,
        "accountSignInId": .string(Accounts.accountSignInId(account)),
        "needsRefresh": .bool(Accounts.needsRefresh(account)),
        "reauthNoticeLabel": .string(Accounts.reauthNoticeLabel(account)),
      ]
      expectParity(actual, c)
    }
    for c in try Parity.cases(fixture, fn: "shortDid") {
      expectParity(.string(Accounts.shortDid(c["did"].stringValue)), c)
    }
  }

  @Test func lastOpenedLabel() throws {
    for c in try Parity.cases(fixture, fn: "lastOpenedLabel") {
      let runs = c.output.arrayValue ?? [c.output]
      for run in runs {
        let zone = TimeZone(identifier: run["zone"]?.stringValue ?? c["zone"].stringValue ?? "UTC")!
        let lastUsed = run["lastUsed"]?.doubleValue ?? (c["lastUsed"].stringValue == "NaN" ? .nan : nil)
        let label = Accounts.lastOpenedLabel(lastUsed, now: run["now"]?.doubleValue ?? .nan, timeZone: zone)
        let d = Parity.diff(label.map(JSONValue.string) ?? .null, run["label"] ?? .null)
        #expect(d == nil, "\(c) \(zone.identifier) \(run): \(d ?? "")")
      }
    }
  }

  @Test func reauthRequired() throws {
    for c in try Parity.cases(fixture, fn: "isReauthRequiredError") {
      let error: JSError? = c["error"].isNull ? nil : JSError(json: c["error"])
      expectParity(.bool(Accounts.isReauthRequiredError(error)), c)
    }
    let made = Accounts.makeReauthRequiredError("did:plc:virgaharnessmira2zq4x")
    let actual: JSONValue = [
      "message": .string(jsMessage(made)), "code": made.jsFields.code ?? .null, "did": made.did.map(JSONValue.string) ?? .null,
      "isReauth": .bool(Accounts.isReauthRequiredError(made)),
    ]
    expectParity(actual, try Parity.cases(fixture, fn: "makeReauthRequiredError")[0])
  }

  @Test func localData() throws {
    for c in try Parity.cases(fixture, fn: "localDatabases") {
      expectParity(.array(Accounts.localDatabases(c["did"].stringValue ?? "").map(JSONValue.string)), c)
    }
    for c in try Parity.cases(fixture, fn: "localDataKeys") {
      let mira = "did:plc:virgaharnessmira2zq4x"
      let lab = "did:plc:virgaharnesslab7k2pq"
      let store = InMemoryKeyValueStore([
        "virga:keep:followback:\(mira)": "[]", "virga:keep:cleanup:\(mira)": "[]", "virga:keep:cleanup:\(lab)": "[]",
        "virga:preferences": "{}", "virga:posting-device": "x", "virga:keep:x:\(mira):\(lab)": "[]",
      ])
      let keys = Accounts.localDataKeys(store, c["did"].stringValue ?? "")
      // The fixed keys in the web's order; those found by scanning in the
      // store's own order there, in code-unit order here.
      let expected = c.output.arrayValue ?? []
      let fixed = min(8, expected.count)
      expectParity(.array(Array(keys.prefix(fixed)).map(JSONValue.string)), ParityCase.with(c, output: .array(Array(expected.prefix(fixed)))))
      let scanned = Array(keys.dropFirst(fixed)).sorted()
      let scannedExpected = expected.dropFirst(fixed).compactMap(\.stringValue).sorted()
      #expect(scanned == scannedExpected, "\(c)")
    }
  }

  @Test func accountCopy() throws {
    for c in try Parity.cases(fixture, fn: "modeLabel") {
      expectParity(.string(AccountCopy.modeLabel(c["mode"].stringValue)), c)
    }
    for c in try Parity.cases(fixture, fn: "statusLabel") {
      let label = AccountCopy.statusLabel(c["status"].stringValue, active: c["active"].boolValue ?? false, switching: c["switching"].boolValue ?? false)
      expectParity(label.map(JSONValue.string) ?? .null, c)
    }
    for c in try Parity.cases(fixture, fn: "reauthModeFor") {
      let mode = c["mode"].stringValue
      let authMode = c["authMode"].stringValue
      let actual: JSONValue = [
        "reauthModeFor": .string(AccountCopy.reauthModeFor(accountMode: mode, authMode)),
        "offersLongerSession": .bool(AccountCopy.offersLongerSession(accountMode: mode, authMode)),
      ]
      expectParity(actual, c)
    }
    for c in try Parity.cases(fixture, fn: "pendingWorkWarning") {
      let work = c["work"].isNull ? nil : PendingWorkCount(posts: c["work"]["posts"]?.intValue ?? 0, timers: c["work"]["timers"]?.intValue ?? 0)
      expectParity(AccountCopy.pendingWorkWarning(c["name"].stringValue ?? "", work).map(JSONValue.string) ?? .null, c)
    }
  }

  @Test func sessionHint() throws {
    for c in try Parity.cases(fixture, fn: "readSessionHint") {
      let store = InMemoryKeyValueStore()
      if let text = c["stored"].stringValue { try store.setItem(SessionHint.sessionHintKey, text) }
      expectParity(.bool(SessionHint.readSessionHint(store)), c)
    }
    for c in try Parity.cases(fixture, fn: "syncSessionHint") {
      let store = InMemoryKeyValueStore()
      if c["hinted"].boolValue == true { SessionHint.writeSessionHint(store) }
      SessionHint.syncSessionHint(store, rows(c.input["accounts"]))
      expectParity(.bool(SessionHint.readSessionHint(store)), c)
    }
    for c in try Parity.cases(fixture, fn: "restoresAtStartup") {
      let restores = SessionHint.restoresAtStartup(
        hint: c["hint"].boolValue ?? false, onCallback: c["onCallback"].boolValue ?? false,
        onReturn: c["onReturn"].boolValue ?? false, hasAccounts: c["hasAccounts"].boolValue ?? false)
      expectParity(.bool(restores), c)
    }
    #expect(SessionHint.readSessionHint(nil) == false)
  }

  @Test func pendingWork() throws {
    // scheduleService.isActiveScheduledRow and timerService.isLiveTimer
    // (VirgaPosting's), as the generator ran them.
    let active: (JSONValue) -> Bool = { ["pending", "publishing"].contains($0["status"]?.stringValue ?? "") }
    let live: (JSONValue) -> Bool = { ["armed", "checking"].contains($0["status"]?.stringValue ?? "") }
    for c in try Parity.cases(fixture, fn: "countPendingWork") {
      let count = PendingWork.countPendingWork(
        scheduled: c.input["scheduled"].map { $0.arrayValue } ?? [], timers: c.input["timers"].map { $0.arrayValue } ?? [],
        isActiveScheduledRow: active, isLiveTimer: live)
      expectParity(.of(count), c)
    }
    for c in try Parity.cases(fixture, fn: "hasPendingWork") {
      let work = c["work"].isNull ? nil : PendingWorkCount(posts: c["work"]["posts"]?.intValue ?? 0, timers: c["work"]["timers"]?.intValue ?? 0)
      expectParity(.bool(PendingWork.hasPendingWork(work)), c)
    }
    // `hasPendingWork(undefined)` is falsy (undefined).
    #expect(PendingWork.hasPendingWork(PendingWorkEntry.absent) == false)
    #expect(try Parity.cases(fixture, fn: "hasPendingWork:undefined")[0].output == .null)
  }
}

extension Parity {
  /// A list case's expected output reduced to DIDs: the web hands back the
  /// rows it was given, which the typed rows here can't echo field for field.
  static func dids(_ c: ParityCase) -> ParityCase {
    let output: JSONValue
    switch c.output {
    case .array(let items): output = .array(items.map { $0["did"] ?? .null })
    case .object: output = c.output["did"] ?? .null
    default: output = c.output
    }
    return ParityCase.with(c, output: output)
  }
}

extension ParityCase {
  /// The case with another expected output.
  static func with(_ c: ParityCase, output: JSONValue) -> ParityCase {
    let data = try! JSONEncoder().encode(["id": JSONValue.string(c.id), "fn": .string(c.fn), "input": c.input, "output": output])
    return try! JSONDecoder().decode(ParityCase.self, from: data)
  }
}
