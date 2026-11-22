// Ports harness/fakeServer.js (the timers, the adviser and alt text routes)
//
// /api/self-destruct/{create,list,cancel}: a timer armed once per post (a
// re-arm is the author changing the rule), held to the per-bucket limits
// and the flat cap, listed live first, then failed, then settled; and
// /api/ai/{analyze-post,synthesize-style,alt-text}, counted against the
// month's allowance, with the wait an answer takes (`aiDelayMs`, longer
// than the adviser waits when `ai` is 'slow') and a 503 when it is 'down'.

import Foundation
import VirgaCore
import VirgaNetwork

/// A post on a timer, as the server's table holds it.
public struct TimerRow: Codable, Hashable, Sendable {
  public var id: String
  public var user_did: String
  public var post_uri: String
  public var post_cid: String?
  public var collection: String
  public var rkey: String
  /// The thread's later posts: `{ uri, collection, rkey }`.
  public var extra_uris: [JSONValue]
  public var snippet: String?
  public var posted_at: String
  public var check_at: String
  /// 'armed' | 'checking' | 'acted' | 'deleted' | 'spared' | 'failed' | 'cancelled'.
  public var status: String
  public var conditions: JSONValue
  public var effects: JSONValue
  public var acted: JSONValue
  public var lifespan_seconds: Double
  public var extensions: Int
  public var last_counts: JSONValue
  public var resolution: String?
  public var resolved_at: String?
  public var attempts: Int
  public var max_attempts: Int
  public var last_error: String?
  public var last_error_code: String?
  public var created_at: String

  /// The row as the web object, every key present.
  public var json: JSONValue {
    var out: [String: JSONValue] = [:]
    out["id"] = .string(id)
    out["user_did"] = .string(user_did)
    out["post_uri"] = .string(post_uri)
    out["post_cid"] = post_cid.map(JSONValue.string) ?? .null
    out["collection"] = .string(collection)
    out["rkey"] = .string(rkey)
    out["extra_uris"] = .array(extra_uris)
    out["snippet"] = snippet.map(JSONValue.string) ?? .null
    out["posted_at"] = .string(posted_at)
    out["check_at"] = .string(check_at)
    out["status"] = .string(status)
    out["conditions"] = conditions
    out["effects"] = effects
    out["acted"] = acted
    out["lifespan_seconds"] = .number(lifespan_seconds)
    out["extensions"] = .number(Double(extensions))
    out["last_counts"] = last_counts
    out["resolution"] = resolution.map(JSONValue.string) ?? .null
    out["resolved_at"] = resolved_at.map(JSONValue.string) ?? .null
    out["attempts"] = .number(Double(attempts))
    out["max_attempts"] = .number(Double(max_attempts))
    out["last_error"] = last_error.map(JSONValue.string) ?? .null
    out["last_error_code"] = last_error_code.map(JSONValue.string) ?? .null
    out["created_at"] = .string(created_at)
    return .object(out)
  }
}

/// What validateArm makes of a request to arm a timer.
struct ArmValue: Sendable {
  var uri: String
  var collection: String
  var rkey: String
  var cid: String?
  var extra: [JSONValue]
  var snippet: String?
  var postedAt: String
  var checkAt: String
  var seconds: Double
  var conditions: JSONValue
  var effects: JSONValue
  var resolution: String?
}

extension DemoServer {
  // MARK: Timers

  /// `timerShape(t, { list })`.
  static func timerShape(_ t: TimerRow, list: Bool = false) -> JSONValue {
    var out: [String: JSONValue] = [
      "id": .string(t.id), "postUri": .string(t.post_uri), "collection": .string(t.collection),
      "postedAt": .string(t.posted_at), "checkAt": .string(t.check_at), "status": .string(t.status),
      "lifespanSeconds": .number(t.lifespan_seconds), "extensions": .number(Double(t.extensions)), "clientKey": "virga",
      "createdAt": .string(t.created_at),
    ]
    out["snippet"] = t.snippet.flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null
    out["conditions"] = t.conditions.isTruthy ? t.conditions : [:]
    out["effects"] = t.effects.isTruthy ? t.effects : .null
    out["acted"] = t.acted.isTruthy ? t.acted : .null
    if list {
      out["lastCounts"] = t.last_counts.isTruthy ? t.last_counts : .null
      out["resolution"] = t.resolution.flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null
      out["resolvedAt"] = t.resolved_at.flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null
      out["attempts"] = .number(Double(t.attempts))
      out["maxAttempts"] = .number(Double(t.max_attempts))
      out["lastError"] = t.last_error.flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null
      out["lastErrorCode"] = t.last_error_code.flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null
    }
    return .object(out)
  }

  /// `validateArm(did, body, { refusePastDeadline, missedDeadline })`: the
  /// server's validateArm, for the parts a writer can get wrong. Answers
  /// the value, or the sentence of refusal.
  func validateArm(_ did: String, _ body: JSONValue, refusePastDeadline: Bool = false, missedDeadline: String = "floor")
    -> Result<ArmValue, Invalid>
  {
    let field: (String) -> JSONValue? = { body.objectValue?[$0] }
    guard let uri = Self.parseAtUri(field("postUri")), uri.did.jsHasPrefix("did:") else {
      return .failure(Invalid(error: "postUri must be an at:// URI of a post"))
    }
    if !uri.did.jsEquals(did) { return .failure(Invalid(error: "you can only set a timer on your own post")) }
    if uri.collection != "app.bsky.feed.post" { return .failure(Invalid(error: "timers are for Bluesky posts")) }
    let effects = FakeServer.parseEffects(field("effects"))
    if let error = effects.error { return .failure(Invalid(error: error)) }
    let conditions = FakeServer.parseConditions(field("conditions"))
    if let error = conditions.error { return .failure(Invalid(error: error)) }
    let seconds = field("lifespanSeconds").jsNumber.rounded(.down)
    if !seconds.isFinite || seconds < Double(FakeServer.minLifespanSeconds) || seconds > Double(FakeServer.maxLifespanSeconds) {
      return .failure(Invalid(error: "a timer runs for between five minutes and thirty days"))
    }
    let extras = field("extraUris")?.arrayValue ?? []
    if extras.count > 100 { return .failure(Invalid(error: "a timer can take at most 100 more posts of a thread")) }
    var extra: [JSONValue] = []
    for e in extras {
      let p = Self.parseAtUri(e.stringValue != nil ? e : e["uri"])
      guard let p, p.did.jsEquals(did), p.collection.jsEquals(uri.collection) else {
        return .failure(Invalid(error: "every post of the thread has to be yours"))
      }
      extra.append([
        "uri": .string("at://\(p.did)/\(p.collection)/\(p.rkey)"), "collection": .string(p.collection),
        "rkey": .string(p.rkey),
      ])
    }
    let t = now()
    let floor = t + Double(FakeServer.minLifespanSeconds) * 1000
    let posted = dateParse(field("postedAt"))
    let startedAt = posted.isFinite && posted <= t && t - posted < seconds * 1000 ? posted : t
    var checkAt = Swift.max(startedAt + seconds * 1000, floor)
    var resolution: String?
    if let deleteAt = field("deleteAt"), deleteAt.isTruthy {
      let at = dateParse(deleteAt)
      if !at.isFinite { return .failure(Invalid(error: "deleteAt is not a valid datetime")) }
      if at > t + 30 * FakeServer.day { return .failure(Invalid(error: "a delete time can be at most thirty days away")) }
      if refusePastDeadline && at < t - 60_000 {
        return .failure(Invalid(error: "that delete time has already passed, so no timer was set. pick a later time."))
      }
      if missedDeadline == "window" && at < startedAt + Double(FakeServer.minLifespanSeconds) * 1000 {
        resolution = "the delete time had passed by the time this went out, so it runs for its length instead"
      } else {
        checkAt = Swift.max(at, floor)
      }
    }
    return .success(
      ArmValue(
        uri: "at://\(uri.did)/\(uri.collection)/\(uri.rkey)", collection: uri.collection, rkey: uri.rkey,
        cid: field("postCid")?.stringValue, extra: extra, snippet: field("snippet")?.stringValue.map { $0.jsSlice(0, 200) },
        postedAt: iso(startedAt), checkAt: iso(checkAt), seconds: seconds, conditions: conditions.value ?? .null,
        effects: effects.value ?? .null, resolution: resolution))
  }

  /// `armTimer(did, v, { id, extra })`: a new timer, or the post's live one
  /// rewritten (a re-arm is the author changing the rule; a 'checking'
  /// row is mid-evaluation and stands). The row's index, and whether it
  /// was there.
  @discardableResult
  func armTimer(_ s: inout State, _ did: String, _ v: ArmValue, id given: String? = nil) -> (index: Int, existing: Bool) {
    let id = given ?? uuid()
    if let i = liveTimers(s, did).first(where: { s.timers[$0].post_uri.jsEquals(v.uri) }) {
      if s.timers[i].status == "armed" {
        s.timers[i].conditions = v.conditions
        s.timers[i].effects = v.effects
        s.timers[i].lifespan_seconds = v.seconds
        s.timers[i].check_at = v.checkAt
        s.timers[i].snippet = v.snippet
        s.timers[i].post_cid = v.cid
        s.timers[i].extra_uris = v.extra
        s.timers[i].acted = .null
        s.timers[i].resolution = v.resolution.flatMap { $0.isEmpty ? nil : $0 }
        s.timers[i].attempts = 0
        s.timers[i].last_error = nil
        s.timers[i].last_error_code = nil
      }
      return (i, true)
    }
    s.timers.append(
      TimerRow(
        id: id, user_did: did, post_uri: v.uri, post_cid: v.cid, collection: v.collection, rkey: v.rkey,
        extra_uris: v.extra, snippet: v.snippet, posted_at: v.postedAt, check_at: v.checkAt, status: "armed",
        conditions: v.conditions, effects: v.effects, acted: .null, lifespan_seconds: v.seconds, extensions: 0,
        last_counts: .null, resolution: v.resolution, resolved_at: nil, attempts: 0, max_attempts: 5, last_error: nil,
        last_error_code: nil, created_at: iso(now())))
    return (s.timers.count - 1, false)
  }

  /// POST /api/self-destruct/create: 201 for a new timer, 200 for the post's own again.
  func timerCreate(_ did: String, _ given: JSONValue?) throws -> ServerAnswer {
    try state.withLock { s in
      let body = try Self.body(given)
      let v: ArmValue
      switch validateArm(did, body, refusePastDeadline: true) {
      case .success(let value): v = value
      case .failure(let invalid): throw Self.refusal(400, invalid.error)
      }
      try enforceTimerLimit(s, did, conditions: v.conditions, effects: v.effects, exceptPostUri: v.uri)
      try enforceFlatTimerCap(s, did, v.uri)
      let (i, existing) = armTimer(&s, did, v)
      if !existing { note(&s, "timer \(s.timers[i].id) on \(s.timers[i].post_uri) for \(s.timers[i].check_at)") }
      return ServerAnswer(existing ? 200 : 201, ["success": true, "data": Self.timerShape(s.timers[i])])
    }
  }

  /// GET /api/self-destruct/list: live first (soonest check first), then
  /// failed, then settled (the last week's acted ones, or with `history`
  /// every settled one), newest first; a hundred at most.
  func timerList(_ did: String, _ query: [(String, String)]) -> ServerAnswer {
    state.withLock { s in
      let historyValue = Self.get(query, "history")
      let history = historyValue == "1" || historyValue == "true"
      let mine = s.timers.filter { $0.user_did.jsEquals(did) }
      // `dir * String(a[key] || '').localeCompare(String(b[key] || ''))`,
      // stable: the keys are ISO times (or none), which collate as their
      // code units do.
      func sorted(_ rows: [TimerRow], _ key: (TimerRow) -> String?, _ dir: Int) -> [TimerRow] {
        rows.enumerated().sorted { a, b in
          let x = Array((key(a.element) ?? "").utf16)
          let y = Array((key(b.element) ?? "").utf16)
          if x == y { return a.offset < b.offset }
          return dir > 0 ? x.lexicographicallyPrecedes(y) : y.lexicographicallyPrecedes(x)
        }.map(\.element)
      }
      let live = sorted(mine.filter { $0.status == "armed" || $0.status == "checking" }, \.check_at, 1)
      let failed = sorted(mine.filter { $0.status == "failed" }, \.resolved_at, -1)
      let week = now() - 7 * FakeServer.day
      let settled =
        history
        ? sorted(mine.filter { ["acted", "deleted", "spared"].contains($0.status) }, \.resolved_at, -1)
        : sorted(
          mine.filter { $0.status == "acted" && dateParse($0.resolved_at.map(JSONValue.string) ?? .null) > week },
          \.resolved_at, -1)
      let data = (live + failed + settled).prefix(100).map { Self.timerShape($0, list: true) }
      return ServerAnswer(200, ["success": true, "data": .array(Array(data))])
    }
  }

  /// POST /api/self-destruct/cancel: a timer that is still waiting (or failed), called off.
  func timerCancel(_ did: String, _ given: JSONValue?, _ query: [(String, String)]) throws -> ServerAnswer {
    try state.withLock { s in
      let body = try Self.body(given)
      let id = body.objectValue?["id"].jsTruthy ?? Self.get(query, "id").map(JSONValue.string)
      guard let id, id.isTruthy else { throw Self.refusal(400, "Missing id") }
      guard
        let i = s.timers.indices.first(where: { Self.same(id, s.timers[$0].id) && s.timers[$0].user_did.jsEquals(did) }),
        ["armed", "failed"].contains(s.timers[i].status)
      else {
        throw Self.refusal(
          409, "that timer is no longer waiting. it is running now, or it has already settled.", code: "NOT_CANCELLABLE")
      }
      s.timers[i].status = "cancelled"
      s.timers[i].resolution = "called off"
      s.timers[i].resolved_at = iso(now())
      note(&s, "timer \(s.timers[i].id) called off")
      return ServerAnswer(200, ["success": true, "data": ["id": .string(s.timers[i].id), "status": "cancelled"]])
    }
  }

  // MARK: The adviser and alt text

  /// `takeTrial(did, kind)`: the month's count for `kind` (nil when it is
  /// unlimited, and nothing is counted or reported), refused with a 429 at
  /// the allowance. Answers the key and the count read, for `commit`.
  func takeTrial(_ did: String, _ kind: String) throws -> (key: String, used: Int, limit: Int)? {
    guard let limit = aiAllowance[kind] else { return nil }
    let key = "\(did):\(kind):\(iso(now()).jsSlice(0, 7))"
    let used = state.withLock { $0.aiUsage[JSKey(key)] ?? 0 }
    if used >= limit {
      throw Coded(
        status: 429, body: ["error": "monthly_limit", "limit": .number(Double(limit)), "used": .number(Double(used))])
    }
    return (key, used, limit)
  }

  /// `trial.commit()`: the count goes up from what was read when the trial
  /// was taken.
  func commit(_ trial: (key: String, used: Int, limit: Int)) -> JSONValue {
    state.withLock { $0.aiUsage[JSKey(trial.key)] = trial.used + 1 }
    return ["used": .number(Double(trial.used + 1)), "limit": .number(Double(trial.limit))]
  }

  /// `aiPause()`: a 503 when the AI is down, else the wait an answer takes.
  func aiPause() async throws {
    if ai == "down" { throw Coded(status: 503, body: ["error": "The AI gateway is unavailable right now."]) }
    let ms = ai == "slow" ? 14_000 : aiDelayMs
    if ms > 0 { await sleep(ms) }
  }

  /// POST /api/ai/analyze-post.
  func analyzePostRoute(_ did: String, _ given: JSONValue?) async throws -> ServerAnswer {
    let body = try Self.body(given)
    guard case .string(let text)? = body.objectValue?["text"], !text.jsTrimmed().isEmpty else {
      throw Coded(status: 400, body: ["error": "Missing or empty \"text\""])
    }
    if text.jsLength > FakeServer.maxAnalyzeText {
      throw Coded(status: 413, body: ["error": "Post text is too long to analyze"])
    }
    guard
      var result = FakeServer.analyzePost(
        text: text, goals: body.objectValue?["goals"], writingChecks: body.objectValue?["writingChecks"])?.objectValue
    else {
      return ServerAnswer(
        200,
        [
          "sentiment": ["label": "neutral", "score": 0], "checks": [], "suggestion": .null, "overallStatus": "ok",
        ])
    }
    let trial = try takeTrial(did, "adviser")
    try await aiPause()
    if let trial { result["usage"] = commit(trial) }
    return ServerAnswer(200, .object(result))
  }

  /// POST /api/ai/synthesize-style.
  func synthesizeStyleRoute(_ did: String, _ given: JSONValue?) async throws -> ServerAnswer {
    let body = try Self.body(given)
    let posts = (body.objectValue?["posts"]?.arrayValue ?? []).compactMap { p -> String? in
      let text = p.stringValue != nil ? p : p["text"]
      guard case .string(let t)? = text, !t.jsTrimmed().isEmpty else { return nil }
      return t
    }.prefix(500)
    if posts.count < 5 { throw Coded(status: 400, body: ["error": "not_enough_posts", "minimum": 5]) }
    let trial = try takeTrial(did, "style")
    try await aiPause()
    var out: [String: JSONValue] = [
      "summary": .string(FakeServer.styleSummary(Array(posts), body.objectValue?["guidance"])),
      "analyzedCount": .number(Double(posts.count)),
    ]
    if let trial { out["usage"] = commit(trial) }
    return ServerAnswer(200, .object(out))
  }

  /// `/^image\/(jpeg|png|webp|gif)$/.test(mimeType || '')`.
  static func isImageType(_ value: JSONValue?) -> Bool {
    let text = value?.isTruthy == true ? value!.jsString : ""
    return ["image/jpeg", "image/png", "image/webp", "image/gif"].contains { text.jsEquals($0) }
  }

  /// POST /api/ai/alt-text.
  func altTextRoute(_ did: String, _ given: JSONValue?) async throws -> ServerAnswer {
    let body = try Self.body(given)
    guard let image = body.objectValue?["imageBase64"], image.isTruthy else {
      throw Coded(status: 400, body: ["error": "Missing \"imageBase64\""])
    }
    if !Self.isImageType(body.objectValue?["mimeType"]) {
      throw Coded(status: 400, body: ["error": "Missing or unsupported \"mimeType\""])
    }
    if FakeServer.jsLengthOf(image) > 4 * 1024 * 1024 {
      throw Coded(status: 413, body: ["error": "Image is too large to analyze"])
    }
    let trial = try takeTrial(did, "altText")
    try await aiPause()
    var out: [String: JSONValue] = ["altText": .string(try FakeServer.altTextFor(body))]
    if let trial { out["usage"] = commit(trial) }
    return ServerAnswer(200, .object(out))
  }
}
