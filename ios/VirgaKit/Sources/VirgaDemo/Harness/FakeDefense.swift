// Ports harness/fakeDefense.js
//
// Virga's Defense routes, in the shapes server/defense/handlers/* answer
// with, over memory, for the fake server (DemoServer mounts them). `run()`
// stands in for the run route: on each tick of the server's workers it
// writes one batch per holder into the account's world, as list items in
// its repo, with the same veto the real one reads: the owner and the
// holder, the people kept by hand, everyone the account follows, and the
// members of its curation lists.
//
// What it doesn't do: talk to a database, open a session or check a PDS's
// limits. Ids a client sends (a DID, a list's, a plan's) are kept as the
// JSON they came as and compared as JavaScript's `===` compares them.
// `nextKey()` is createTidClock's, its keys minted at the clock's `now`
// (Date.now() on the web), its clock id given (random on the web).

import Foundation
import VirgaCore
import VirgaDefense
import VirgaNetwork
import VirgaSession

/// Defense's rows, as the server's tables hold them.
public struct DefenseTables: Sendable {
  /// `{ id, owner_did, holder_did, mode, uri, name, purpose, created_at }`.
  public var lists: [JSONValue] = []
  /// `{ owner_did, did, reason, added_at }`, newest first.
  public var kept: [JSONValue] = []
  /// `{ id, owner_did, list_id, post_uri, rows, approved_at, approved_bands, note, totals, created_at }`.
  public var plans: [JSONValue] = []
  /// As defense_decision.
  public var decisions: [JSONValue] = []
  /// `{ id, owner_did, list_id, kind, state, next_at, last_error }`.
  public var jobs: [JSONValue] = []
  /// The moderator's links: did → `{ linked_at, code, code_at, list_id }`, in the order made.
  public var links = JSOrderedMap<JSONValue>()
}

/// Virga's Defense routes and list writer, in memory (`createDefense`).
public final class DemoDefense: Sendable {
  public let world: DemoWorld
  /// Whether "DEFENSE_WRITES" is on.
  public let writes: Bool
  /// 'on', 'off' or 'linked'.
  public let moderator: String
  let now: @Sendable () -> Double
  let note: @Sendable (String) -> Void
  let random: @Sendable () -> Double
  let state: Locked<(tables: DefenseTables, seq: Int, lastMicros: UInt64)>
  let clockId: UInt64

  static let listItem = "app.bsky.graph.listitem"
  static let curateList = "app.bsky.graph.defs#curatelist"

  /// - Parameters:
  ///   - world: every account's world.
  ///   - writes: whether "DEFENSE_WRITES" is on.
  ///   - moderator: 'off' (not set up), 'linked' (every account starts
  ///     linked) or 'on'.
  ///   - now: `Date.now()`.
  ///   - note: the server's log.
  ///   - random: `Math.random()`, for the link codes.
  ///   - clockId: the record keys' clock id (createTidClock's CLOCK_ID).
  public init(
    world: DemoWorld, writes: Bool = true, moderator: String = "on", now: @escaping @Sendable () -> Double,
    note: @escaping @Sendable (String) -> Void = { _ in }, random: @escaping @Sendable () -> Double = { Double.random(in: 0..<1) },
    clockId: UInt64 = UInt64.random(in: 0..<1024)
  ) {
    self.world = world
    self.writes = writes
    self.moderator = moderator
    self.now = now
    self.note = note
    self.random = random
    self.clockId = clockId & 1023
    var tables = DefenseTables()
    if moderator == "linked" {
      let at = World.iso(now())
      for w in world.worlds {
        tables.links[w.me.did] = ["linked_at": .string(at), "code": .null, "code_at": .null, "list_id": .null]
      }
    }
    state = Locked((tables, 0, 0))
  }

  /// The moderator's handle, or nil when it isn't set up.
  public var moderatorHandle: String? { moderator == "off" ? nil : "mod.virga.example" }

  /// What's held, for tests (`inspect()`).
  public var tables: DefenseTables { state.wrappedValue.tables }

  func iso(_ ms: Double? = nil) -> String { World.iso(ms ?? now()) }

  /// `nextKey()`: createTidClock's next key, at `now`, always increasing.
  func nextKey(_ s: inout (tables: DefenseTables, seq: Int, lastMicros: UInt64)) -> String {
    var micros = UInt64(Swift.max(0, now().rounded(.down))) * 1000
    if micros <= s.lastMicros { micros = s.lastMicros + 1 }
    s.lastMicros = micros
    return TID.encode(micros: micros, clockId: clockId)
  }

  /// `id()`: a row id from a sequence and the clock.
  func id(_ s: inout (tables: DefenseTables, seq: Int, lastMicros: UInt64)) -> String {
    s.seq += 1
    let seq = String(s.seq, radix: 16)
    let hex = String(Int64(now().rounded(.down)), radix: 16)
    let clock = String((String(repeating: "0", count: Swift.max(0, 12 - hex.count)) + hex).suffix(12))
    return "\(String(repeating: "0", count: Swift.max(0, 8 - seq.count)) + seq)-0000-4000-8000-\(clock)"
  }

  static func coded(_ status: Int, _ code: String, _ error: String) -> DemoServer.Coded {
    DemoServer.Coded(status: status, body: ["success": false, "code": .string(code), "error": .string(error)])
  }

  /// `requireWrites()`.
  func requireWrites() throws {
    if !writes { throw Self.coded(503, "WRITES_OFF", "Defense’s lists aren’t turned on on Virga’s server yet.") }
  }

  /// `text(v, max)`: whitespace runs as one space, trimmed, clipped; or nil.
  static func text(_ value: JSONValue?, _ max: Int) -> String? {
    guard case .string(let raw)? = value else { return nil }
    var units: [UInt16] = []
    var space = false
    for unit in raw.utf16 {
      if FakeServer.isSpaceUnit(unit) {
        space = true
      } else {
        if space { units.append(0x20) }
        space = false
        units.append(unit)
      }
    }
    if space { units.append(0x20) }
    let collapsed = String(jsUnits: units).jsTrimmed()
    return collapsed.isEmpty ? nil : collapsed.jsSlice(0, max)
  }

  /// `/^did:[a-z]+:[a-zA-Z0-9._:%-]+$/.test(value || '')`.
  static func isDid(_ value: JSONValue?) -> Bool {
    let units = Array((value?.isTruthy == true ? value!.jsString : "").utf16)
    guard units.count > 4, Array(units.prefix(4)) == Array("did:".utf16) else { return false }
    var i = 4
    let start = i
    while i < units.count, (0x61...0x7A).contains(units[i]) { i += 1 }
    guard i > start, i < units.count, units[i] == 0x3A else { return false }
    i += 1
    guard i < units.count else { return false }
    return units[i...].allSatisfy { u in
      (0x41...0x5A).contains(u) || (0x61...0x7A).contains(u) || (0x30...0x39).contains(u)
        || [0x2E, 0x5F, 0x3A, 0x25, 0x2D].contains(u)
    }
  }

  static let approvable = Plan.approvableBands.map(\.rawValue)

  /// `APPROVABLE_BANDS.includes(band)`.
  static func isApprovable(_ band: JSONValue?) -> Bool {
    guard case .string(let text)? = band else { return false }
    return approvable.contains { text.jsEquals($0) }
  }

  static func eq(_ a: JSONValue?, _ b: JSONValue?) -> Bool {
    guard let a, let b else { return a == nil && b == nil }
    return FakeServer.strictEquals(a, b)
  }

  static func owned(_ row: JSONValue, _ did: String) -> Bool { row["owner_did"]?.stringValue?.jsEquals(did) ?? false }

  /// A member, or null for none: `x ?? null`.
  static func v(_ value: JSONValue?) -> JSONValue { value ?? .null }

  /// Whether a row's state is one of `names`.
  static func isState(_ row: JSONValue, _ names: [String]) -> Bool {
    guard case .string(let state)? = row["state"] else { return false }
    return names.contains(state)
  }

  // MARK: Shapes

  /// `summary(list)`.
  func summary(_ t: DefenseTables, _ list: JSONValue) -> JSONValue {
    let on = t.decisions.filter { Self.eq($0["list_id"], list["id"]) }
    let held = t.jobs.enumerated().filter { _, j in
      Self.eq(j["list_id"], list["id"]) && j["state"] == .string("pending") && j["last_error"]?.isTruthy == true
    }.sorted { a, b in
      let (x, y) = (a.element["next_at"].jsNumber, b.element["next_at"].jsNumber)
      return x != y ? x > y : a.offset < b.offset
    }.first?.element
    func state(_ d: JSONValue, _ names: [String]) -> Bool { names.contains { d["state"] == .string($0) } }
    let listed = on.filter {
      $0["action"] == .string("add") && state($0, ["done", "already"]) && $0["undone_at"]?.isTruthy != true
    }.count
    let waiting = on.filter { state($0, ["queued", "sent"]) }.count
    let heldUntil: JSONValue =
      held.map { $0["next_at"].jsNumber > now() ? .string(iso($0["next_at"].jsNumber)) : .null } ?? .null
    return [
      "id": Self.v(list["id"]), "holderDid": Self.v(list["holder_did"]), "mode": Self.v(list["mode"]),
      "uri": Self.v(list["uri"]), "name": Self.v(list["name"]), "purpose": Self.v(list["purpose"]),
      "createdAt": Self.v(list["created_at"]), "listed": .number(Double(listed)), "waiting": .number(Double(waiting)),
      "heldUntil": heldUntil, "lastError": held?["last_error"].jsTruthy ?? .null,
    ]
  }

  /// `publicDecision(d)`.
  static func publicDecision(_ d: JSONValue) -> JSONValue {
    [
      "id": Self.v(d["id"]), "listId": Self.v(d["list_id"]), "planId": Self.v(d["plan_id"]),
      "did": Self.v(d["subject_did"]), "action": Self.v(d["action"]), "band": Self.v(d["band"]),
      "trust": Self.v(d["trust"]), "via": Self.v(d["via"]), "note": Self.v(d["note"]), "state": Self.v(d["state"]),
      "reason": Self.v(d["reason"]), "createdAt": Self.v(d["created_at"]), "actedAt": Self.v(d["acted_at"]),
      "undoneAt": Self.v(d["undone_at"]), "undoes": Self.v(d["undoes"]),
    ]
  }

  /// `live(listId, did)`: an add on the list that is (or will be) written.
  static func live(_ t: DefenseTables, _ listId: JSONValue?, _ did: JSONValue?) -> Bool {
    t.decisions.contains { d in
      eq(d["list_id"], listId) && eq(d["subject_did"], did) && d["action"] == .string("add")
        && ["queued", "sent", "done", "already"].contains { d["state"] == .string($0) } && d["undone_at"]?.isTruthy != true
    }
  }

  // MARK: Routes

  /// The Defense routes this mounts on the server (`api`'s keys).
  public static let routes: [(method: String, path: String)] = [
    ("GET", "/api/defense/lists"), ("POST", "/api/defense/list-create"), ("POST", "/api/defense/keep"),
    ("POST", "/api/defense/unkeep"), ("POST", "/api/defense/plan"), ("POST", "/api/defense/approve"),
    ("GET", "/api/defense/history"), ("POST", "/api/defense/undo"), ("GET", "/api/defense/link"),
    ("POST", "/api/defense/link-code"), ("POST", "/api/defense/unlink"), ("POST", "/api/defense/link-list"),
  ]

  /// One of the routes, for the account `did`. Throws the coded refusals
  /// (`DemoServer.Coded`), or what the web throws past them.
  func handle(_ method: String, _ path: String, did: String, query: [(String, String)], body: JSONValue?) throws
    -> ServerAnswer?
  {
    // `body?.x`: a null body reads as no body.
    let body = body.nonNull
    func field(_ key: String) -> JSONValue? { body?.objectValue?[key] }
    switch (method, path) {
    case ("GET", "/api/defense/lists"): return lists(did)
    case ("POST", "/api/defense/list-create"): return try listCreate(did, field)
    case ("POST", "/api/defense/keep"): return try keep(did, field)
    case ("POST", "/api/defense/unkeep"): return unkeep(did, field)
    case ("POST", "/api/defense/plan"): return try plan(did, field)
    case ("POST", "/api/defense/approve"): return try approve(did, field)
    case ("GET", "/api/defense/history"): return history(did, query)
    case ("POST", "/api/defense/undo"): return undo(did, field)
    case ("GET", "/api/defense/link"): return link(did)
    case ("POST", "/api/defense/link-code"): return linkCode(did)
    case ("POST", "/api/defense/unlink"): return unlink(did)
    case ("POST", "/api/defense/link-list"): return linkList(did, field)
    default: return nil
    }
  }

  func lists(_ did: String) -> ServerAnswer {
    let t = state.withLock { $0.tables }
    return ServerAnswer(
      200,
      [
        "success": true,
        "data": [
          "lists": .array(t.lists.filter { Self.owned($0, did) }.map { summary(t, $0) }),
          "kept": .array(
            t.kept.filter { Self.owned($0, did) }.map {
              ["did": Self.v($0["did"]), "reason": Self.v($0["reason"]), "addedAt": Self.v($0["added_at"])]
            }),
          "writes": .bool(writes),
        ],
      ])
  }

  func listCreate(_ did: String, _ field: (String) -> JSONValue?) throws -> ServerAnswer {
    try requireWrites()
    let name = Self.text(field("name"), 64)
    let purpose: String? = field("purpose") == .string("mute") ? "mute" : field("purpose") == .string("block") ? "block" : nil
    guard let name, let purpose else {
      throw Self.coded(400, "INVALID", "A list needs a name and to be for blocking or muting.")
    }
    guard let owner = world.world(did) else {
      throw HarnessJSError.typeError("Cannot read properties of null (reading 'scope')")
    }
    if !Scopes.missingScopes(owner.scope, AppConfig.listTokens).isEmpty {
      throw Self.coded(403, "NO_SCOPE", "This sign-in doesn’t let Virga make lists. Sign in again from Defense to let it.")
    }
    return try state.withLock { s in
      let rkey = nextKey(&s)
      try world.writeRecord(
        did: did, collection: "app.bsky.graph.list", rkey: rkey,
        record: [
          "$type": "app.bsky.graph.list", "purpose": "app.bsky.graph.defs#modlist", "name": .string(name),
          "description": "Kept with Virga.", "createdAt": .string(iso()),
        ], createOnly: true, now: now())
      let row: JSONValue = [
        "id": .string(id(&s)), "owner_did": .string(did), "holder_did": .string(did), "mode": "own",
        "uri": .string("at://\(did)/app.bsky.graph.list/\(rkey)"), "name": .string(name), "purpose": .string(purpose),
        "created_at": .string(iso()),
      ]
      s.tables.lists.append(row)
      note("defense: made the list “\(name)” for \(did)")
      return ServerAnswer(200, ["success": true, "data": ["list": summary(s.tables, row)]])
    }
  }

  func keep(_ did: String, _ field: (String) -> JSONValue?) throws -> ServerAnswer {
    guard Self.isDid(field("did")) else { throw Self.coded(400, "INVALID", "That isn’t an account’s DID.") }
    let subject = field("did") ?? .null
    let reason = Self.text(field("reason"), 200) ?? "kept by hand"
    let at = iso()
    state.withLock { s in
      if let i = s.tables.kept.firstIndex(where: { Self.owned($0, did) && Self.eq($0["did"], subject) }) {
        s.tables.kept[i]["reason"] = .string(reason)
      } else {
        s.tables.kept.insert(
          ["owner_did": .string(did), "did": subject, "reason": .string(reason), "added_at": .string(at)], at: 0)
      }
    }
    return ServerAnswer(200, ["success": true, "data": ["did": subject, "reason": .string(reason)]])
  }

  func unkeep(_ did: String, _ field: (String) -> JSONValue?) -> ServerAnswer {
    let subject = field("did")
    state.withLock { s in
      if let i = s.tables.kept.firstIndex(where: { Self.owned($0, did) && Self.eq($0["did"], subject) }) {
        s.tables.kept.remove(at: i)
      }
    }
    var data: [String: JSONValue] = [:]
    if let subject { data["did"] = subject }
    return ServerAnswer(200, ["success": true, "data": .object(data)])
  }

  func plan(_ did: String, _ field: (String) -> JSONValue?) throws -> ServerAnswer {
    try state.withLock { s in
      let list = s.tables.lists.first { Self.eq($0["id"], field("listId")) && Self.owned($0, did) }
      let raw = field("rows")?.arrayValue ?? []
      if raw.isEmpty || raw.count > Plan.planMax {
        throw Self.coded(400, "INVALID", "A plan needs between one and ten thousand accounts.")
      }
      for r in raw where !Self.isDid(r["did"]) || !Self.isApprovable(r["band"]) {
        throw Self.coded(400, "INVALID", "A plan can’t hold anyone protected, or a row without a DID.")
      }
      guard let list else { throw Self.coded(404, "NO_LIST", "That list isn’t one of yours, or isn’t kept any more.") }
      let rows: [JSONValue] = raw.map { r in
        let trust: JSONValue = r["trust"].nonNull ?? .null
        return ["did": Self.v(r["did"]), "band": Self.v(r["band"]), "trust": trust]
      }
      let id = id(&s)
      let postUri: JSONValue = field("postUri").jsTruthy ?? .null
      let totals: JSONValue = field("totals").jsTruthy ?? [:]
      let plan: JSONValue = [
        "id": .string(id), "owner_did": .string(did), "list_id": Self.v(list["id"]),
        "post_uri": postUri, "rows": .array(rows),
        "approved_at": .null, "approved_bands": [], "note": .null,
        "totals": totals, "created_at": .string(iso()),
      ]
      s.tables.plans.append(plan)
      return ServerAnswer(200, ["success": true, "data": ["planId": .string(id), "rows": .number(Double(rows.count))]])
    }
  }

  func approve(_ did: String, _ field: (String) -> JSONValue?) throws -> ServerAnswer {
    try requireWrites()
    return try state.withLock { s in
      let found = s.tables.plans.firstIndex { Self.eq($0["id"], field("planId")) && Self.owned($0, did) }
      let bands = (field("bands")?.arrayValue ?? []).filter(Self.isApprovable)
      if bands.isEmpty { throw Self.coded(400, "INVALID", "Approve a plan by naming at least one band.") }
      guard let p = found else { throw Self.coded(404, "NO_PLAN", "That plan isn’t yours, has expired, or its list is gone.") }
      let plan = s.tables.plans[p]
      let noteText = Self.text(field("note"), Plan.noteMax)
      let kept = s.tables.kept.filter { Self.owned($0, did) }.map { Self.v($0["did"]) }
      func isKept(_ d: JSONValue?) -> Bool { kept.contains { Self.eq($0, d) } }
      let chosen = (plan["rows"]?.arrayValue ?? []).filter { r in bands.contains { Self.eq($0, r["band"]) } }
      let keptOut = chosen.filter { isKept($0["did"]) }.count
      let listId = plan["list_id"]
      let already = chosen.filter { !isKept($0["did"]) && Self.live(s.tables, listId, $0["did"]) }.count
      let fresh = chosen.filter { !isKept($0["did"]) && !Self.live(s.tables, listId, $0["did"]) }
      var jobId: JSONValue = .null
      if !fresh.isEmpty {
        let job: JSONValue = [
          "id": .string(id(&s)), "owner_did": .string(did), "list_id": Self.v(listId), "kind": "add", "state": "pending",
          "next_at": .number(now()), "last_error": .null,
        ]
        s.tables.jobs.append(job)
        jobId = job["id"]!
        let noteValue: JSONValue = noteText.map(JSONValue.string) ?? .null
        for r in fresh {
          var d: [String: JSONValue] = [:]
          d["id"] = .number(Double(s.tables.decisions.count + 1))
          d["owner_did"] = .string(did)
          d["list_id"] = Self.v(listId)
          d["plan_id"] = Self.v(plan["id"])
          d["job_id"] = jobId
          d["subject_did"] = Self.v(r["did"])
          d["action"] = "add"
          d["band"] = Self.v(r["band"])
          d["trust"] = Self.v(r["trust"])
          d["via"] = "web"
          d["note"] = noteValue
          d["state"] = "queued"
          d["rkey"] = .null
          d["reason"] = .null
          d["created_at"] = .string(iso())
          d["acted_at"] = .null
          d["undone_at"] = .null
          d["undoes"] = .null
          s.tables.decisions.append(.object(d))
        }
      }
      s.tables.plans[p]["approved_at"] = .string(iso())
      var approved: [String] = []
      for band in (plan["approved_bands"]?.arrayValue ?? []) + bands {
        let text = band.jsString
        if !approved.contains(where: { $0.jsEquals(text) }) { approved.append(text) }
      }
      approved.sort { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }
      s.tables.plans[p]["approved_bands"] = .array(approved.map(JSONValue.string))
      if let noteText { s.tables.plans[p]["note"] = .string(noteText) }
      note("defense: queued \(fresh.count) for \(did)")
      return ServerAnswer(
        200,
        [
          "success": true,
          "data": [
            "jobId": jobId, "queued": .number(Double(fresh.count)), "kept": .number(Double(keptOut)),
            "already": .number(Double(already)),
          ],
        ])
    }
  }

  func history(_ did: String, _ query: [(String, String)]) -> ServerAnswer {
    let t = state.withLock { $0.tables }
    let wanted = DemoServer.get(query, "before").map(JSNumber.toNumber) ?? 0
    let before = wanted.isNaN || wanted == 0 ? Double.infinity : wanted
    let out = t.decisions.filter { Self.owned($0, did) && $0["id"].jsNumber < before }
      .enumerated().sorted { a, b in
        let (x, y) = (a.element["id"].jsNumber, b.element["id"].jsNumber)
        return x != y ? x > y : a.offset < b.offset
      }.map(\.element).prefix(200)
    let plans = t.plans.filter { Self.owned($0, did) && $0["approved_at"]?.isTruthy == true }
      .jsSorted { a, b in
        (a["approved_at"]?.stringValue ?? "").jsLess(b["approved_at"]?.stringValue ?? "") ? 1 : -1
      }
      .map { p -> JSONValue in
        let adds = t.decisions.filter { Self.eq($0["plan_id"], p["id"]) && $0["action"] == .string("add") }
        func n(_ test: (JSONValue) -> Bool) -> JSONValue { .number(Double(adds.filter(test).count)) }
        func state(_ d: JSONValue, _ names: [String]) -> Bool { names.contains { d["state"] == .string($0) } }
        func undone(_ d: JSONValue) -> Bool { d["undone_at"]?.isTruthy == true }
        return [
          "id": Self.v(p["id"]), "listId": Self.v(p["list_id"]), "postUri": Self.v(p["post_uri"]),
          "createdAt": Self.v(p["created_at"]), "approvedAt": Self.v(p["approved_at"]),
          "bands": Self.v(p["approved_bands"]), "note": Self.v(p["note"]), "totals": Self.v(p["totals"]),
          "counts": [
            "added": n { state($0, ["done", "already"]) && !undone($0) },
            "waiting": n { state($0, ["queued", "sent"]) && !undone($0) },
            "kept": n { state($0, ["vetoed"]) },
            "failed": n { state($0, ["failed"]) },
            "undone": n { undone($0) },
            "live": n { state($0, ["queued", "sent", "done"]) && !undone($0) },
          ],
        ]
      }
    return ServerAnswer(
      200,
      ["success": true, "data": ["decisions": .array(out.map(Self.publicDecision)), "plans": .array(plans)]])
  }

  // Undo isn't stopped by writes being off, as on the server.
  func undo(_ did: String, _ field: (String) -> JSONValue?) -> ServerAnswer {
    state.withLock { s in
      let ids = field("ids")?.arrayValue ?? []
      let planId = field("planId")
      func inScope(_ d: JSONValue) -> Bool {
        guard Self.owned(d, did), d["action"] == .string("add"), d["undone_at"]?.isTruthy != true else { return false }
        if let planId, planId.isTruthy, Self.eq(d["plan_id"], planId) { return true }
        return ids.contains { id in
          // `ids.includes(d.id)`: SameValueZero.
          if case .number(let x) = id, case .number(let y)? = d["id"] { return x == y }
          return Self.eq(id, d["id"])
        }
      }
      var cancelled = 0
      var queued = 0
      let at = iso()
      for i in s.tables.decisions.indices where inScope(s.tables.decisions[i]) && s.tables.decisions[i]["state"] == .string("queued") {
        s.tables.decisions[i]["state"] = "cancelled"
        s.tables.decisions[i]["undone_at"] = .string(at)
        s.tables.decisions[i]["reason"] = "undone before it was written"
        cancelled += 1
      }
      var byList: [(list: JSONValue, job: JSONValue)] = []
      let written = s.tables.decisions.filter {
        inScope($0) && ($0["state"] == .string("sent") || $0["state"] == .string("done")) && $0["rkey"]?.isTruthy == true
      }
      for d in written {
        if s.tables.decisions.contains(where: {
          Self.eq($0["undoes"], d["id"]) && ($0["state"] == .string("queued") || $0["state"] == .string("sent"))
        }) {
          continue
        }
        let listId = Self.v(d["list_id"])
        if !byList.contains(where: { Self.eq($0.list, listId) }) {
          let job: JSONValue = [
            "id": .string(id(&s)), "owner_did": .string(did), "list_id": listId, "kind": "remove", "state": "pending",
            "next_at": .number(now()), "last_error": .null,
          ]
          s.tables.jobs.append(job)
          byList.append((listId, job))
        }
        let job = byList.first { Self.eq($0.list, listId) }!.job
        var undo: [String: JSONValue] = [:]
        undo["id"] = .number(Double(s.tables.decisions.count + 1))
        undo["owner_did"] = .string(did)
        undo["list_id"] = listId
        undo["plan_id"] = .null
        undo["job_id"] = Self.v(job["id"])
        undo["subject_did"] = Self.v(d["subject_did"])
        undo["action"] = "remove"
        undo["band"] = .null
        undo["trust"] = .null
        undo["via"] = "web"
        undo["note"] = Self.text(field("note"), Plan.noteMax).map(JSONValue.string) ?? .null
        undo["state"] = "queued"
        undo["rkey"] = Self.v(d["rkey"])
        undo["reason"] = .null
        undo["created_at"] = .string(iso())
        undo["acted_at"] = .null
        undo["undone_at"] = .null
        undo["undoes"] = Self.v(d["id"])
        s.tables.decisions.append(.object(undo))
        queued += 1
      }
      return ServerAnswer(
        200,
        [
          "success": true,
          "data": [
            "jobId": Self.v(byList.first?.job["id"]), "cancelled": .number(Double(cancelled)),
            "queued": .number(Double(queued)),
          ],
        ])
    }
  }

  /// `linkOf(did)`: a code lands ten seconds after it is made, as if the
  /// owner DMed it.
  func linkOf(_ s: inout (tables: DefenseTables, seq: Int, lastMicros: UInt64), _ did: String) -> JSONValue? {
    guard var l = s.tables.links[did] else { return nil }
    if l["code"]?.isTruthy == true, l["linked_at"]?.isTruthy != true, now() - l["code_at"].jsNumber > 10_000 {
      l["linked_at"] = .string(iso())
      l["code"] = .null
      s.tables.links[did] = l
      note("the moderator was linked by \(did)")
    }
    return l
  }

  func link(_ did: String) -> ServerAnswer {
    state.withLock { s in
      let l = linkOf(&s, did)
      let codeAt = l?["code_at"].jsNumber ?? .nan
      let live = l?["code"]?.isTruthy == true && now() - codeAt < 15 * 60_000
      return ServerAnswer(
        200,
        [
          "success": true,
          "data": [
            "moderator": moderatorHandle.map(JSONValue.string) ?? .null,
            "linked": .bool(l?["linked_at"]?.isTruthy == true),
            "linkedAt": l?["linked_at"] ?? .null,
            "codeExpiresAt": live ? .string(iso(codeAt + 15 * 60_000)) : .null,
            "listId": l?["list_id"] ?? .null,
          ],
        ])
    }
  }

  func linkCode(_ did: String) -> ServerAnswer {
    guard let moderator = moderatorHandle else {
      return ServerAnswer(
        503, ["success": false, "code": "NO_MODERATOR", "error": "Virga’s moderator isn’t set up on this server yet."])
    }
    let letters = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
    let code = String((0..<8).map { _ in letters[Swift.min(letters.count - 1, Int((random() * Double(letters.count)).rounded(.down)))] })
    return state.withLock { s in
      var l = s.tables.links[did] ?? ["linked_at": .null, "list_id": .null]
      l["code"] = .string(code)
      l["code_at"] = .number(now())
      s.tables.links[did] = l
      return ServerAnswer(
        200,
        [
          "success": true,
          "data": [
            "code": .string("\(code.prefix(4))-\(code.dropFirst(4))"), "expiresAt": .string(iso(now() + 15 * 60_000)),
            "moderator": .string(moderator),
          ],
        ])
    }
  }

  func unlink(_ did: String) -> ServerAnswer {
    state.withLock { s in
      if var l = s.tables.links[did] {
        l["linked_at"] = .null
        l["code"] = .null
        l["code_at"] = .null
        s.tables.links[did] = l
      }
    }
    return ServerAnswer(200, ["success": true, "data": ["linked": false]])
  }

  func linkList(_ did: String, _ field: (String) -> JSONValue?) -> ServerAnswer {
    state.withLock { s in
      let listId = field("listId").jsTruthy ?? .null
      if listId.isTruthy,
        !s.tables.lists.contains(where: {
          Self.eq($0["id"], listId) && Self.owned($0, did) && $0["removed_at"]?.isTruthy != true
        })
      {
        return ServerAnswer(404, ["success": false, "code": "NOT_FOUND", "error": "That list isn’t one of yours."])
      }
      var l = s.tables.links[did] ?? ["linked_at": .null, "code": .null, "code_at": .null]
      l["list_id"] = listId
      s.tables.links[did] = l
      return ServerAnswer(200, ["success": true, "data": ["listId": listId]])
    }
  }

  // MARK: The list writer

  /// `vetoFor(owner, holder, dids)`: who the owner may never add, and why.
  func vetoFor(_ t: DefenseTables, _ owner: String, _ holder: JSONValue?, _ dids: [JSONValue]) -> [(JSONValue, String)] {
    guard let w = world.world(owner) else { return [] }
    let follows = Set(w.follows.compactMap { $0.value["subject"]?.stringValue.map(JSKey.init) })
    var keptBy: [(JSONValue, String)] = []
    for k in t.kept where Self.owned(k, owner) {
      let reason = k["reason"].map(\.jsString) ?? "undefined"
      if let i = keptBy.firstIndex(where: { Self.eq($0.0, k["did"]) }) {
        keptBy[i].1 = reason
      } else {
        keptBy.append((Self.v(k["did"]), reason))
      }
    }
    var curated: [JSKey: String] = [:]
    for l in w.ownLists where l.purpose == Self.curateList {
      for m in l.members { curated[JSKey(m)] = l.name }
    }
    var out: [(JSONValue, String)] = []
    for did in dids {
      if out.contains(where: { Self.eq($0.0, did) }) { continue }
      let key = did.stringValue.map(JSKey.init)
      if Self.eq(did, .string(owner)) {
        out.append((did, "your own account"))
      } else if Self.eq(did, holder) {
        out.append((did, "the account that holds the list"))
      } else if let kept = keptBy.first(where: { Self.eq($0.0, did) }) {
        out.append((did, kept.1))
      } else if let key, follows.contains(key) {
        out.append((did, "you follow them"))
      } else if let key, let name = curated[key] {
        out.append((did, "on your list “\(name)”"))
      }
    }
    return out
  }

  /// `run()`: one pass, a batch per holder. Answers how many items were written.
  @discardableResult
  public func run() async -> Int { runNow() }

  func runNow() -> Int {
    guard writes else { return 0 }
    return state.withLock { s in
      var written = 0
      var holders: [JSONValue] = []
      let pending = s.tables.jobs.indices.filter {
        s.tables.jobs[$0]["state"] == .string("pending") && s.tables.jobs[$0]["next_at"].jsNumber <= now()
      }
      for j in pending {
        let job = s.tables.jobs[j]
        guard let list = s.tables.lists.first(where: { Self.eq($0["id"], job["list_id"]) }),
          !holders.contains(where: { Self.eq($0, list["holder_did"]) })
        else { continue }
        holders.append(Self.v(list["holder_did"]))
        let holder = list["holder_did"]?.stringValue ?? ""
        let batch = Array(
          s.tables.decisions.indices.filter {
            Self.eq(s.tables.decisions[$0]["job_id"], job["id"])
              && Self.isState(s.tables.decisions[$0], ["queued", "sent"])
          }.prefix(Pace.batch))
        if batch.isEmpty {
          s.tables.jobs[j]["state"] = "done"
          continue
        }
        let isAdd = job["kind"] == .string("add")
        if isAdd && !Scopes.missingScopes(world.world(holder)?.scope, AppConfig.listTokens).isEmpty {
          s.tables.jobs[j]["last_error"] =
            "This sign-in doesn’t let Virga write lists. Sign in again from Defense › Lists to let it."
          s.tables.jobs[j]["next_at"] = .number(now() + 60_000)
          continue
        }
        let veto =
          isAdd
          ? vetoFor(
            s.tables, list["owner_did"]?.stringValue ?? "", list["holder_did"],
            batch.map { Self.v(s.tables.decisions[$0]["subject_did"]) }) : []
        for d in batch {
          if s.tables.decisions[d]["rkey"]?.isTruthy != true { s.tables.decisions[d]["rkey"] = .string(nextKey(&s)) }
          let subject = s.tables.decisions[d]["subject_did"]
          if let vetoed = veto.first(where: { Self.eq($0.0, subject) }) {
            s.tables.decisions[d]["state"] = "vetoed"
            s.tables.decisions[d]["reason"] = .string(vetoed.1)
            continue
          }
          let rkey = s.tables.decisions[d]["rkey"]?.jsString ?? ""
          if isAdd {
            do {
              try world.writeRecord(
                did: holder, collection: Self.listItem, rkey: rkey,
                record: [
                  "$type": .string(Self.listItem), "subject": subject ?? .null, "list": Self.v(list["uri"]),
                  "createdAt": .string(iso()),
                ], now: now())
            } catch {
              continue
            }
            s.tables.decisions[d]["state"] = "done"
            written += 1
          } else {
            let found = (try? world.removeRecord(did: holder, collection: Self.listItem, rkey: rkey)) ?? false
            s.tables.decisions[d]["state"] = found ? "done" : "already"
            let undoes = s.tables.decisions[d]["undoes"]
            if let add = s.tables.decisions.firstIndex(where: { Self.eq($0["id"], undoes) }) {
              s.tables.decisions[add]["undone_at"] = .string(iso())
            }
          }
          s.tables.decisions[d]["acted_at"] = .string(iso())
        }
        let left = s.tables.decisions.contains {
          Self.eq($0["job_id"], job["id"]) && Self.isState($0, ["queued", "sent"])
        }
        if !left { s.tables.jobs[j]["state"] = "done" }
        s.tables.jobs[j]["last_error"] = .null
      }
      if written > 0 { note("defense: wrote \(written) list items") }
      return written
    }
  }
}
