// Ports harness/fakeServer.js (the scheduled posts and the limits on them)
//
// /api/schedule/{create,list,get,media,update,reorder,cancel}, in the
// server's own request and response shapes, with the rules that matter to
// a reader of the Scheduled page: an account sees and changes only its own
// rows, and every row says it is Virga's (`clientKey: 'virga'`); the
// limits are flat, unlimited unless set, with the caps always held; a
// scheduled post can't carry a video, a reply can be scheduled for a set
// time but not queued or repeated; a post at a set time can repeat, one
// occurrence waiting at a time, with skip and stop.
//
// Rows are held as the table holds them (snake_case, `ScheduledRow`); a
// payload is the JSON the client sent, read with JavaScript's semantics,
// as the web fake reads it. A time without an offset is read in the
// world's zone (the web's browser zone).

import Foundation
import VirgaCore
import VirgaNetwork

/// A scheduled post, as the server's table holds it.
public struct ScheduledRow: Codable, Hashable, Sendable {
  public var id: String
  public var user_did: String
  public var scheduled_for: String
  /// 'pending' | 'publishing' | 'published' | 'failed' | 'cancelled'.
  public var status: String
  public var target: String
  public var queued: Bool
  /// `{ posts, gates, media, rkeys, tz?, selfDestruct, reply?, replyTo?, repeat? }`.
  public var payload: JSONValue
  public var series_id: String?
  public var occurrence: Double?
  /// The posts written so far: `{ uri, cid }`.
  public var progress: [JSONValue]
  public var result_uri: String?
  public var result_cid: String?
  public var attempts: Int
  public var max_attempts: Int
  public var next_attempt_at: String?
  public var last_error: String?
  /// The code a failure carries: the server's word, or (for a DOMException) a number.
  public var last_error_code: JSONValue
  public var created_at: String
  public var updated_at: String

  /// The row as the web object, every key present.
  public var json: JSONValue {
    var out: [String: JSONValue] = [:]
    out["id"] = .string(id)
    out["user_did"] = .string(user_did)
    out["scheduled_for"] = .string(scheduled_for)
    out["status"] = .string(status)
    out["target"] = .string(target)
    out["queued"] = .bool(queued)
    out["payload"] = payload
    out["series_id"] = series_id.map(JSONValue.string) ?? .null
    out["occurrence"] = occurrence.map(JSONValue.number) ?? .null
    out["progress"] = .array(progress)
    out["result_uri"] = result_uri.map(JSONValue.string) ?? .null
    out["result_cid"] = result_cid.map(JSONValue.string) ?? .null
    out["attempts"] = .number(Double(attempts))
    out["max_attempts"] = .number(Double(max_attempts))
    out["next_attempt_at"] = next_attempt_at.map(JSONValue.string) ?? .null
    out["last_error"] = last_error.map(JSONValue.string) ?? .null
    out["last_error_code"] = last_error_code
    out["created_at"] = .string(created_at)
    out["updated_at"] = .string(updated_at)
    return .object(out)
  }
}

/// Stashed bytes of a scheduled post's media: `{ base64, encoding }`.
struct StashedMedia: Hashable, Sendable {
  var base64: JSONValue
  var encoding: JSONValue?
}

/// What validateCreate makes of a body: the row's parts, read.
struct ScheduleValue: Sendable {
  var scheduledFor: String
  var target: String
  var posts: [JSONValue]
  var gates: JSONValue
  var queued: Bool
  var selfDestruct: JSONValue
  var tz: String?
  var reply: JSONValue?
  var replyTo: JSONValue
  var repeatRule: JSONValue?
}

extension DemoServer {
  /// `iso(ms)`.
  func iso(_ ms: Double) -> String { World.iso(ms) }

  /// `Date.parse(value)`: `String(value)` read as a date, a time without
  /// an offset in the world's zone. `undefined` is NaN.
  func dateParse(_ value: JSONValue?) -> Double {
    guard let value else { return .nan }
    return JSDate.parse(value.jsString, timeZone: timeZone)
  }

  /// `a === b` for an id from a body and a stored one.
  static func same(_ id: JSONValue?, _ stored: String) -> Bool {
    id?.stringValue?.jsEquals(stored) ?? false
  }

  /// `String(v)` for a value JSON can hold, `undefined` included.
  static func text(_ value: JSONValue?) -> String { value.map(\.jsString) ?? "undefined" }

  /// `codedError(status, { success: false, error, code, ...extra })`.
  static func refusal(_ status: Int, _ error: String, code: String? = nil, _ extra: [String: JSONValue] = [:]) -> Coded {
    Coded(status: status, body: FakeServer.failure(error, code: code, extra))
  }

  /// `o.key` where `o` is the web's `body`: a null body throws, as reading
  /// a member of null does.
  static func body(_ given: JSONValue?) throws -> JSONValue {
    let body = given ?? [:]
    if body.isNull { throw HarnessJSError.typeError("Cannot destructure 'body' as it is null.") }
    return body
  }

  // MARK: Limits

  func limitFor(_ feature: String) -> Int? { featureLimits[feature] }

  /// `activeScheduled(did, exceptId)`: the account's rows waiting or going out.
  func activeScheduled(_ s: State, _ did: String, except: JSONValue? = nil) -> [Int] {
    s.scheduled.indices.filter { i in
      let r = s.scheduled[i]
      return r.user_did.jsEquals(did) && !Self.same(except, r.id) && (r.status == "pending" || r.status == "publishing")
    }
  }

  /// `liveTimers(did)`.
  func liveTimers(_ s: State, _ did: String) -> [Int] {
    s.timers.indices.filter { s.timers[$0].user_did.jsEquals(did) && ["armed", "checking"].contains(s.timers[$0].status) }
  }

  /// `timerUsage(did, { exceptScheduledId, exceptPostUri })`: timers in use
  /// per bucket, live ones plus scheduled posts waiting with one.
  func timerUsage(_ s: State, _ did: String, exceptScheduledId: JSONValue? = nil, exceptPostUri: String? = nil)
    -> (plain: Int, conditional: Int)
  {
    var plain = 0
    var conditional = 0
    func count(_ bucket: String) {
      if bucket == "plain" { plain += 1 } else { conditional += 1 }
    }
    for i in liveTimers(s, did) where !(exceptPostUri.map { s.timers[i].post_uri.jsEquals($0) } ?? false) {
      count(FakeServer.timerBucket(conditions: s.timers[i].conditions, effects: s.timers[i].effects))
    }
    for i in activeScheduled(s, did, except: exceptScheduledId) {
      let r = s.scheduled[i]
      if r.status == "pending", let sd = r.payload["selfDestruct"], sd.isTruthy {
        count(FakeServer.timerBucket(conditions: sd["conditions"], effects: sd["effects"]))
      }
    }
    return (plain, conditional)
  }

  /// `enforceTimerLimit(did, rule, except)`.
  func enforceTimerLimit(
    _ s: State, _ did: String, conditions: JSONValue?, effects: JSONValue?, exceptScheduledId: JSONValue? = nil,
    exceptPostUri: String? = nil
  ) throws {
    let bucket = FakeServer.timerBucket(conditions: conditions, effects: effects)
    let feature = FakeServer.bucketFeature(bucket)
    guard let limit = limitFor(feature) else { return }
    let usage = timerUsage(s, did, exceptScheduledId: exceptScheduledId, exceptPostUri: exceptPostUri)
    guard (bucket == "plain" ? usage.plain : usage.conditional) >= limit else { return }
    let kind = bucket == "conditional" ? "conditional timer" : "plain timer"
    throw Self.refusal(
      409, "this account can keep \(limit == 1 ? "one \(kind)" : "\(limit) \(kind)s") at a time, counting scheduled posts.",
      code: "QUOTA_EXCEEDED", ["feature": .string(feature), "limit": .number(Double(limit))])
  }

  /// `enforceFlatTimerCap(did, postUri)`: the flat cap, held where a timer
  /// is armed. A post that already has a live timer gets its own row back
  /// before anything is counted.
  func enforceFlatTimerCap(_ s: State, _ did: String, _ postUri: String) throws {
    let live = liveTimers(s, did)
    if live.contains(where: { s.timers[$0].post_uri.jsEquals(postUri) }) { return }
    if live.count >= FakeServer.maxLiveTimers {
      throw Self.refusal(
        409, "you can have at most \(FakeServer.maxLiveTimers) posts on a timer", code: "QUOTA_EXCEEDED",
        ["limit": .number(Double(FakeServer.maxLiveTimers))])
    }
  }

  /// `enforceScheduledLimit(did, exceptId)`: the cap, or a lower
  /// scheduledPosts limit.
  func enforceScheduledLimit(_ s: State, _ did: String, except: JSONValue? = nil) throws {
    let count = activeScheduled(s, did, except: except).count
    let ceiling = limitFor("scheduledPosts").map { Swift.min($0, FakeServer.maxPendingScheduled) } ?? FakeServer.maxPendingScheduled
    if count >= ceiling {
      throw Self.refusal(
        409, "you can have at most \(ceiling) scheduled posts", code: "QUOTA_EXCEEDED",
        ["feature": "scheduledPosts", "limit": .number(Double(ceiling))])
    }
  }

  // MARK: Validation

  /// `validateTime(scheduledFor)`.
  func validateTime(_ scheduledFor: JSONValue?) -> String? {
    guard let scheduledFor, scheduledFor.isTruthy else { return "scheduledFor is required" }
    let when = dateParse(scheduledFor)
    if !when.isFinite { return "scheduledFor is not a valid datetime" }
    let t = now()
    if when <= t { return "scheduledFor must be in the future" }
    if when > t + Double(FakeServer.maxHorizonDays) * FakeServer.day {
      return "scheduledFor must be within \(FakeServer.maxHorizonDays) days"
    }
    return nil
  }

  /// `validateEmbed(embed, nested)`. Throws the web's TypeError for an
  /// image that is null.
  func validateEmbed(_ embed: JSONValue?, nested: Bool = false) throws -> String? {
    guard let embed, embed.isTruthy else { return nil }
    switch embed["type"] {
    case .some(.string("images")):
      guard case .array(let images)? = embed["images"], !images.isEmpty else {
        return "images embed needs at least one image"
      }
      if images.count > 10 { return "a post can have at most 10 images" }
      for image in images {
        if image.isNull { throw HarnessJSError.typeError("Cannot read properties of null (reading 'mediaId')") }
        if image["mediaId"]?.isTruthy != true { return "each image needs a mediaId" }
      }
      return nil
    case .some(.string("external")):
      return embed["uri"]?.isTruthy == true ? nil : "external embed needs a uri"
    case .some(.string("record")):
      return embed["uri"]?.isTruthy == true && embed["cid"]?.isTruthy == true ? nil : "record embed needs uri and cid"
    case .some(.string("recordWithMedia")):
      if nested { return "nested recordWithMedia is not allowed" }
      guard embed["uri"]?.isTruthy == true, embed["cid"]?.isTruthy == true else {
        return "recordWithMedia needs the quoted uri and cid"
      }
      return try validateEmbed(embed["media"], nested: true)
    default:
      return "unknown embed type: \(Self.text(embed["type"]))"
    }
  }

  /// `mediaIdsOf(embed)`: the media an embed names.
  static func mediaIdsOf(_ embed: JSONValue?) -> [JSONValue] {
    guard let embed, embed.isTruthy else { return [] }
    switch embed["type"] {
    case .some(.string("images")): return (embed["images"]?.arrayValue ?? []).map { $0["mediaId"] ?? .null }
    case .some(.string("external")):
      if let thumb = embed["thumbMediaId"], thumb.isTruthy { return [thumb] }
      return []
    case .some(.string("recordWithMedia")): return mediaIdsOf(embed["media"])
    default: return []
    }
  }

  /// `validateSelfDestructSpec(raw, scheduledForMs)`.
  func validateSelfDestructSpec(_ raw: JSONValue?, _ scheduledForMs: Double) -> FakeServer.Reading {
    guard let raw, !raw.isNull else { return .value(.null) }
    switch raw {
    case .object, .array: break
    default: return .error("selfDestruct must be an object")
    }
    let seconds = raw["lifespanSeconds"].jsNumber.rounded(.down)
    if !seconds.isFinite { return .error("selfDestruct.lifespanSeconds is required") }
    if seconds < Double(FakeServer.minLifespanSeconds) { return .error("a post has to stand for at least 5 minutes") }
    if seconds > Double(FakeServer.maxLifespanSeconds) { return .error("a timer can run for at most 30 days") }
    var deleteAt: JSONValue = .null
    if let wanted = raw["deleteAt"], wanted.isTruthy {
      let at = dateParse(wanted)
      if !at.isFinite { return .error("selfDestruct.deleteAt is not a valid datetime") }
      if at < scheduledForMs + Double(FakeServer.minLifespanSeconds) * 1000 {
        return .error(
          "the delete time is before this post would even publish. pick a later delete time, or use a duration instead.")
      }
      deleteAt = .string(iso(at))
    }
    let effects = FakeServer.parseEffects(raw["effects"])
    if let error = effects.error { return .error(error) }
    let conditions = FakeServer.parseConditions(raw["conditions"])
    if let error = conditions.error { return .error(error) }
    return .value([
      "lifespanSeconds": .number(seconds), "deleteAt": deleteAt, "conditions": conditions.value ?? .null,
      "effects": effects.value ?? .null,
    ])
  }

  /// `validateReply(raw)`: the reply's two strong refs, post addresses and
  /// a cid each.
  static func validateReply(_ raw: JSONValue?) -> FakeServer.Reading {
    guard let raw, !raw.isNull else { return .value(.null) }
    guard case .object = raw else { return .error("reply must be an object") }
    var out: [String: JSONValue] = [:]
    for name in ["root", "parent"] {
      let ref = raw[name]
      guard let ref, ref.isTruthy, ref.objectValue != nil || ref.arrayValue != nil else {
        return .error("reply.\(name) needs a uri and a cid")
      }
      let at = parseAtUri(ref["uri"])
      guard let at, at.collection == "app.bsky.feed.post", at.did.jsHasPrefix("did:") else {
        return .error("reply.\(name).uri must be the at:// address of a post")
      }
      // The fixtures' posts by other people carry a short stand-in cid, so
      // only its presence is checked here; the server checks its shape.
      guard case .string(let cid)? = ref["cid"], !cid.isEmpty else { return .error("reply.\(name).cid must be a CID") }
      out[name] = ["uri": ref["uri"] ?? .null, "cid": .string(cid)]
    }
    return .value(.object(out))
  }

  /// `parseAtUri(uri)`: `String(uri || '')` read as an AT-URI.
  static func parseAtUri(_ uri: JSONValue?) -> HarnessRepo.ParsedAtUri? {
    HarnessRepo.parseAtUri(uri?.isTruthy == true ? uri!.jsString : "")
  }

  /// `replyHint(raw)`: who and what a reply answers, clipped, or null.
  static func replyHint(_ raw: JSONValue?) -> JSONValue {
    guard let raw, raw.isTruthy, raw.objectValue != nil || raw.arrayValue != nil else { return .null }
    func clip(_ v: JSONValue?, _ max: Int) -> String {
      guard case .string(let text)? = v else { return "" }
      return text.jsTrimmed().jsSlice(0, max)
    }
    let handle = clip(raw["handle"], 253)
    let displayName = clip(raw["displayName"], 128)
    let text = clip(raw["text"], 300)
    if handle.isEmpty && displayName.isEmpty && text.isEmpty { return .null }
    return ["handle": .string(handle), "displayName": .string(displayName), "text": .string(text)]
  }

  /// `validateRepeat(raw, { scheduledFor, occurrence, tz })`: the rule as
  /// the server stores it, anchored at the row's time. Throws where the
  /// web's reading of a rule it can't anchor would.
  func validateRepeat(_ raw: JSONValue?, scheduledFor: JSONValue?, occurrence given: JSONValue?, tz: JSONValue?) throws
    -> FakeServer.Reading
  {
    guard let raw, !raw.isNull, raw != .bool(false) else { return .value(.null) }
    guard case .object = raw else { return .error("repeat must be an object") }
    guard case .string(let every)? = raw["every"], ServerRepeat.repeatEvery.contains(every) else {
      return .error("repeat.every must be one of: \(ServerRepeat.repeatEvery.joined(separator: ", "))")
    }
    let occurrence = given ?? 1
    guard let zone = [raw["tz"], tz].first(where: ServerRepeat.isZone) ?? nil else {
      return .error("repeat.tz must be a time zone this server knows")
    }
    func blank(_ v: JSONValue?) -> Bool { v == nil || v == .null || v == .string("") }
    if !blank(raw["until"]) && !blank(raw["count"]) {
      return .error("a repeating post ends on a date or after a number of times, not both.")
    }
    guard
      var value = ServerRepeat.anchoredRepeat(
        ["every": .string(every)], .string(iso(dateParse(scheduledFor))), zone, occurrence: occurrence)?.objectValue
    else {
      throw HarnessJSError.typeError("Cannot read properties of null (reading 'anchor')")
    }
    if !blank(raw["until"]) {
      guard case .string(let until)? = raw["until"], ServerRepeat.fields(.string(until), [4, 2, 2], 0x2D) != nil else {
        return .error("repeat.until must be a date, as YYYY-MM-DD")
      }
      let anchorDate = value["anchor"]?["date"]?.stringValue ?? ""
      if Array(until.utf16).lexicographicallyPrecedes(Array(anchorDate.utf16)) {
        return .error("the date a repeating post ends on is before it next goes out.")
      }
      value["until"] = .string(until)
    }
    if !blank(raw["count"]) {
      let count = raw["count"].jsNumber
      if !(count.isFinite && count.rounded(.towardZero) == count) || count < 2 {
        return .error("a post that repeats a number of times goes out at least twice.")
      }
      if count > Double(ServerRepeat.maxRepeatCount) {
        return .error(
          "a post can repeat at most \(ServerRepeat.maxRepeatCount) times. choose an end date, or no end, for more.")
      }
      let n = FakeServer.jsCompare(.number(count), occurrence, orEqual: true)
      if !n && FakeServer.jsCompare(occurrence, .number(count), orEqual: false) {
        return .error(
          "this post has already gone out \(JSNumber.format(occurrence.jsNumber - 1)) times, so it can't end after \(JSNumber.format(count)).")
      }
      value["count"] = .number(count)
    }
    return .value(.object(value))
  }

  /// A refusal of validateCreate: its sentence, and its code when it has one.
  struct Invalid: Error {
    var error: String
    var code: String?

    var coded: Coded { DemoServer.refusal(400, error, code: code) }
  }

  /// `validateCreate({ scheduledFor, target, payload, queued, occurrence })`.
  func validateCreate(_ body: JSONValue, occurrence: JSONValue? = nil) throws -> ScheduleValue {
    let field: (String) -> JSONValue? = { body.objectValue?[$0] }
    let scheduledFor = field("scheduledFor")
    if let error = validateTime(scheduledFor) { throw Invalid(error: error) }
    let target = field("target") ?? "bluesky"
    guard target == .string("bluesky") else { throw Invalid(error: "target must be one of: bluesky") }
    guard let payload = field("payload"), payload.isTruthy, payload.objectValue != nil || payload.arrayValue != nil else {
      throw Invalid(error: "payload is required")
    }
    guard case .array(let posts)? = payload["posts"], !posts.isEmpty else {
      throw Invalid(error: "payload.posts must be a non-empty array")
    }
    if posts.count > 25 { throw Invalid(error: "a thread can have at most 25 posts") }
    for (i, p) in posts.enumerated() {
      guard p.isTruthy, let record = p["record"], record.objectValue != nil || record.arrayValue != nil || record.isNull
      else { throw Invalid(error: "posts[\(i)].record is required") }
      if record.isNull { throw HarnessJSError.typeError("Cannot read properties of null (reading 'text')") }
      let text = record["text"]?.stringValue ?? ""
      if text.jsLength > 3000 { throw Invalid(error: "posts[\(i)] text exceeds 3000 characters") }
      if text.jsTrimmed().isEmpty && p["embed"]?.isTruthy != true { throw Invalid(error: "posts[\(i)] needs text or an embed") }
      // The server's payload has no video: the composer refuses it first.
      if let embed = p["embed"], !embed.isNull, embed["type"] == .string("video") {
        throw Invalid(error: "posts[\(i)]: unknown embed type: video")
      }
      if let error = try validateEmbed(p["embed"]) { throw Invalid(error: "posts[\(i)]: \(error)") }
    }
    let reply = Self.validateReply(payload["reply"])
    if let error = reply.error { throw Invalid(error: error) }
    let replyValue = reply.value.nonNull
    let queued = field("queued")?.isTruthy ?? false
    if replyValue != nil && queued {
      throw Invalid(error: "a reply can't wait in the queue. schedule it for a set time instead.", code: "QUEUE_REPLY")
    }
    let rule = try validateRepeat(
      payload["repeat"], scheduledFor: scheduledFor, occurrence: occurrence ?? field("occurrence"), tz: payload["tz"])
    if let error = rule.error { throw Invalid(error: error) }
    let repeatValue = rule.value.nonNull
    if repeatValue != nil && queued {
      throw Invalid(error: "a post in the queue can't repeat. schedule it for a set time instead.", code: "QUEUE_REPEAT")
    }
    if repeatValue != nil && replyValue != nil {
      throw Invalid(error: "a reply can't repeat: it would answer the same post again each time.", code: "REPEAT_REPLY")
    }
    let sd = validateSelfDestructSpec(payload["selfDestruct"], dateParse(scheduledFor))
    if let error = sd.error { throw Invalid(error: error) }
    // A reply takes no gates.
    let gates: JSONValue = replyValue != nil ? [:] : (payload["gates"].jsTruthy ?? [:])
    func gate(_ name: String) -> JSONValue {
      guard let value = gates.objectValue?[name] else { return .null }
      return value
    }
    return ScheduleValue(
      scheduledFor: iso(dateParse(scheduledFor)),
      target: "bluesky",
      posts: posts,
      gates: ["threadgate": gate("threadgate"), "postgate": gate("postgate")],
      queued: queued,
      selfDestruct: sd.value ?? .null,
      tz: payload["tz"]?.stringValue,
      reply: replyValue,
      replyTo: replyValue != nil ? Self.replyHint(payload["replyTo"]) : .null,
      repeatRule: repeatValue)
  }

  // MARK: Rows

  /// `assignRkeys(did, scheduledFor, count, exceptId)`: record keys for each
  /// post of a row, minted from its time and kept clear of every other row's.
  func assignRkeys(_ s: State, _ did: String, _ scheduledFor: String, _ count: Int, except: String? = nil) throws
    -> [String]
  {
    var taken = Set<JSKey>()
    for r in s.scheduled where r.user_did.jsEquals(did) && !(except.map { r.id.jsEquals($0) } ?? false) {
      for k in r.payload["rkeys"]?.arrayValue ?? [] { taken.insert(JSKey(k.jsString)) }
    }
    let base = dateParse(.string(scheduledFor))
    var clock = World.hashOf("\(did)\(scheduledFor)") % 1024
    // Every clock id is tried before giving up on a collision.
    for _ in 0..<1024 {
      let keys = try (0..<count).map { try World.tidAt(base + Double($0), Double(clock)) }
      if keys.allSatisfy({ !taken.contains(JSKey($0)) }) { return keys }
      clock = (clock + 7) % 1024
    }
    throw HarnessJSError(name: "Error", message: "no free record keys at that time")
  }

  /// `mediaBytes?.[id]`: an object's member, an array's element.
  static func member(_ container: JSONValue?, _ key: JSONValue) -> JSONValue? {
    switch container {
    case .some(.object(let members)): return members.jsValue(key.jsString)
    case .some(.array(let items)):
      let text = key.jsString
      guard let i = Int(text), String(i) == text, i >= 0, i < items.count else { return nil }
      return items[i]
    default: return nil
    }
  }

  /// `String(id).replace(/[^a-zA-Z0-9_-]/g, '_')`, by code unit.
  static func pathSafe(_ text: String) -> String {
    String(
      decoding: text.utf16.map { u -> UInt16 in
        (0x30...0x39).contains(u) || (0x41...0x5A).contains(u) || (0x61...0x7A).contains(u) || u == 0x5F || u == 0x2D
          ? u : 0x5F
      }, as: UTF16.self)
  }

  /// `stashMedia(rowId, posts, mediaBytes)`: each image's bytes, kept by
  /// the server until the row publishes.
  func stashMedia(_ s: inout State, _ rowId: String, _ posts: [JSONValue], _ mediaBytes: JSONValue?) throws -> JSONValue {
    var map: [String: JSONValue] = [:]
    for p in posts {
      for id in Self.mediaIdsOf(p["embed"]) {
        let bytes = Self.member(mediaBytes, id)
        guard let bytes, bytes.objectValue != nil, let base64 = bytes["base64"], base64.isTruthy else {
          throw Self.refusal(400, "missing bytes for media \"\(id.jsString)\"")
        }
        let storagePath = "\(rowId)/\(Self.pathSafe(id.jsString))"
        s.media[JSKey(storagePath)] = StashedMedia(base64: base64, encoding: bytes["encoding"])
        var entry: [String: JSONValue] = ["storagePath": .string(storagePath)]
        if let encoding = bytes["encoding"] { entry["encoding"] = encoding }
        map[id.jsString] = .object(entry)
      }
    }
    return .object(map)
  }

  /// The storage paths a payload's media names.
  static func storagePaths(_ payload: JSONValue) -> [String] {
    (payload["media"]?.objectValue ?? [:]).values.compactMap { $0["storagePath"].map(\.jsString) }
  }

  /// `dropMedia(row)`: let go of a row's stashed images, but not those
  /// another row of its series could still publish. `stored` is the row's
  /// index when `row` is the stored row itself (the web's `r === row`).
  func dropMedia(_ s: inout State, _ row: ScheduledRow, stored: Int?) {
    var held = Set<JSKey>()
    if let series = row.series_id {
      for (i, r) in s.scheduled.enumerated() {
        if i == stored || !(r.series_id.map { $0.jsEquals(series) } ?? false) { continue }
        if !["pending", "publishing", "failed"].contains(r.status) { continue }
        for path in Self.storagePaths(r.payload) { held.insert(JSKey(path)) }
      }
    }
    for path in Self.storagePaths(row.payload) where !held.contains(JSKey(path)) { s.media[JSKey(path)] = nil }
  }

  /// `carries(row)`: whether a row is the one its series goes on from.
  static func carries(_ row: ScheduledRow?) -> Bool {
    guard let row, row.series_id.map({ !$0.isEmpty }) ?? false else { return false }
    return row.payload["repeat"]?.isTruthy ?? false
  }

  /// `payloadOf(value, { media, rkeys })`: the payload a row stores, the
  /// optional parts only when it has them.
  static func payloadOf(_ value: ScheduleValue, media: JSONValue, rkeys: [String]) -> JSONValue {
    var out: [String: JSONValue] = [
      "posts": .array(value.posts), "gates": value.gates, "media": media, "rkeys": .array(rkeys.map(JSONValue.string)),
      "selfDestruct": value.selfDestruct,
    ]
    if let tz = value.tz { out["tz"] = .string(tz) }
    if let reply = value.reply, reply.isTruthy {
      out["reply"] = reply
      if value.replyTo.isTruthy { out["replyTo"] = value.replyTo }
    }
    if let rule = value.repeatRule, rule.isTruthy { out["repeat"] = rule }
    return .object(out)
  }

  /// `spawnNext(row)`: settle a row that carries a series, writing the
  /// occurrence that follows it and moving the rule on to it. The new
  /// row's index, or nil when the row carries none or the series is over.
  @discardableResult
  func spawnNext(_ s: inout State, _ index: Int) throws -> Int? {
    let row = s.scheduled[index]
    guard Self.carries(row), let series = row.series_id else { return nil }
    guard
      let next = ServerRepeat.nextOccurrence(
        row.payload["repeat"], row.occurrence.map(JSONValue.number) ?? .null, nowMs: now())
    else { return nil }
    if s.scheduled.contains(where: { ($0.series_id.map { $0.jsEquals(series) } ?? false) && $0.occurrence == next.occurrence }) {
      return nil
    }
    let id = uuid()
    var payload = row.payload
    payload["rkeys"] = .array(
      try assignRkeys(s, row.user_did, next.scheduledFor, row.payload["posts"]?.arrayValue?.count ?? 0).map(JSONValue.string))
    // A pinned delete time belonged to the occurrence it was set for.
    if let sd = row.payload["selfDestruct"], sd["deleteAt"]?.isTruthy == true {
      var cleared = sd.objectValue ?? [:]
      cleared["deleteAt"] = .null
      payload["selfDestruct"] = .object(cleared)
    }
    let at = iso(now())
    var fresh = row
    fresh.id = id
    fresh.scheduled_for = next.scheduledFor
    fresh.status = "pending"
    fresh.occurrence = next.occurrence
    fresh.payload = payload
    fresh.progress = []
    fresh.result_uri = nil
    fresh.result_cid = nil
    fresh.attempts = 0
    fresh.next_attempt_at = nil
    fresh.last_error = nil
    fresh.last_error_code = .null
    fresh.created_at = at
    fresh.updated_at = at
    var rest = row.payload.objectValue ?? [:]
    rest["repeat"] = nil
    s.scheduled[index].payload = .object(rest)
    s.scheduled.append(fresh)
    note(&s, "occurrence \(JSNumber.format(next.occurrence)) of \(series) waits for \(fresh.scheduled_for)")
    return s.scheduled.count - 1
  }

  /// `rowShape(row, { list })`.
  static func rowShape(_ row: ScheduledRow, list: Bool = false) -> JSONValue {
    var out: [String: JSONValue] = [
      "id": .string(row.id), "scheduledFor": .string(row.scheduled_for), "status": .string(row.status),
      "target": .string(row.target), "queued": .bool(row.queued), "payload": row.payload, "clientKey": "virga",
      "createdAt": .string(row.created_at),
    ]
    out["seriesId"] = row.series_id.flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null
    out["occurrence"] = row.occurrence.map(JSONValue.number) ?? .null
    if list { out["partial"] = .bool(!row.progress.isEmpty) }
    out["resultUri"] = row.result_uri.flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null
    out["attempts"] = .number(Double(row.attempts))
    out["maxAttempts"] = .number(Double(row.max_attempts))
    out["lastError"] = row.last_error.flatMap { $0.isEmpty ? nil : JSONValue.string($0) } ?? .null
    out["lastErrorCode"] = row.last_error_code.isTruthy ? row.last_error_code : .null
    return .object(out)
  }

  /// `visibleRows(auth)`: the account's rows, in the table's order.
  static func visibleRows(_ s: State, _ did: String) -> [Int] {
    s.scheduled.indices.filter { s.scheduled[$0].user_did.jsEquals(did) }
  }

  /// `ownedRow(auth, id)`.
  static func ownedRow(_ s: State, _ did: String, _ id: JSONValue?) -> Int? {
    visibleRows(s, did).first { same(id, s.scheduled[$0].id) }
  }

  /// `insertScheduled({ did, value, mediaBytes, id, status, extra })`.
  @discardableResult
  func insertScheduled(
    _ s: inout State, did: String, value: ScheduleValue, mediaBytes: JSONValue?, id given: String? = nil,
    status: String = "pending", extra: (inout ScheduledRow) -> Void = { _ in }
  ) throws -> Int {
    let id = given ?? uuid()
    let rkeys = try assignRkeys(s, did, value.scheduledFor, value.posts.count)
    let payload = Self.payloadOf(value, media: [:], rkeys: rkeys)
    // A post that repeats starts a series as its first occurrence.
    let starts = value.repeatRule?.isTruthy ?? false
    let series = starts ? uuid() : nil
    let at = iso(now())
    var row = ScheduledRow(
      id: id, user_did: did, scheduled_for: value.scheduledFor, status: status, target: value.target,
      queued: value.queued, payload: payload, series_id: series, occurrence: starts ? 1 : nil, progress: [],
      result_uri: nil, result_cid: nil, attempts: 0, max_attempts: 5, next_attempt_at: nil, last_error: nil,
      last_error_code: .null, created_at: at, updated_at: at)
    extra(&row)
    row.payload["media"] = try stashMedia(&s, row.id, value.posts, mediaBytes.jsTruthy ?? [:])
    s.scheduled.append(row)
    return s.scheduled.count - 1
  }

  /// `strandsDeleteTime(payload, scheduledFor)`: the pinned delete time a
  /// move would put too close, or nil.
  func strandsDeleteTime(_ payload: JSONValue, _ scheduledFor: JSONValue?) -> JSONValue? {
    guard let deleteAt = payload["selfDestruct"]?["deleteAt"], deleteAt.isTruthy else { return nil }
    guard dateParse(scheduledFor) > dateParse(deleteAt) - Double(FakeServer.minLifespanSeconds) * 1000 else {
      return Optional<JSONValue>.none
    }
    return deleteAt
  }

  // MARK: Routes

  /// POST /api/schedule/create.
  func scheduleCreate(_ did: String, _ given: JSONValue?) throws -> ServerAnswer {
    try state.withLock { s in
      let body = given.jsTruthy ?? [:]
      let v: ScheduleValue
      do { v = try validateCreate(body) } catch let invalid as Invalid { throw invalid.coded }
      if v.selfDestruct.isTruthy {
        try enforceTimerLimit(s, did, conditions: v.selfDestruct["conditions"], effects: v.selfDestruct["effects"])
      }
      try enforceScheduledLimit(s, did)
      let i = try insertScheduled(&s, did: did, value: v, mediaBytes: body["payload"]?["mediaBytes"])
      note(&s, "scheduled \(s.scheduled[i].id) for \(s.scheduled[i].scheduled_for)")
      return ServerAnswer(201, ["success": true, "data": Self.rowShape(s.scheduled[i])])
    }
  }

  /// GET /api/schedule/list: what is waiting, going out or failed, and the
  /// timer notes, soonest first.
  func scheduleList(_ did: String) -> ServerAnswer {
    state.withLock { s in
      let rows = Self.visibleRows(s, did).map { s.scheduled[$0] }.filter { r in
        ["pending", "publishing", "failed"].contains(r.status)
          || (r.status == "published" && r.last_error_code == .string("TIMER_NOT_ARMED"))
      }.jsSorted { $0.scheduled_for.jsLess($1.scheduled_for) ? -1 : 1 }
      return ServerAnswer(200, ["success": true, "data": .array(rows.map { Self.rowShape($0, list: true) })])
    }
  }

  /// GET /api/schedule/get.
  func scheduleGet(_ did: String, _ query: [(String, String)]) throws -> ServerAnswer {
    try state.withLock { s in
      guard let id = Self.get(query, "id"), !id.isEmpty else { throw Self.refusal(400, "Missing id") }
      guard let i = Self.visibleRows(s, did).first(where: { s.scheduled[$0].id.jsEquals(id) }) else {
        throw Self.refusal(404, "Not found")
      }
      return ServerAnswer(200, ["success": true, "data": Self.rowShape(s.scheduled[i])])
    }
  }

  /// GET /api/schedule/media: a row's stashed bytes.
  func scheduleMedia(_ did: String, _ query: [(String, String)]) throws -> ServerAnswer {
    try state.withLock { s in
      let id = Self.get(query, "id")
      guard let id, let i = Self.visibleRows(s, did).first(where: { s.scheduled[$0].id.jsEquals(id) }) else {
        throw Self.refusal(404, "Not found")
      }
      var out: [String: JSONValue] = [:]
      for (key, m) in s.scheduled[i].payload["media"]?.objectValue ?? [:] {
        guard let path = m["storagePath"], let stored = s.media[JSKey(path.jsString)] else { continue }
        var entry: [String: JSONValue] = ["base64": stored.base64]
        if let encoding = stored.encoding { entry["encoding"] = encoding }
        out[key] = .object(entry)
      }
      return ServerAnswer(200, ["success": true, "data": .object(out)])
    }
  }

  /// POST /api/schedule/update: clear a timer note, retry, skip an
  /// occurrence, stop repeating, edit, or move.
  func scheduleUpdate(_ did: String, _ given: JSONValue?) throws -> ServerAnswer {
    try state.withLock { s in
      let body = try Self.body(given)
      let field: (String) -> JSONValue? = { body.objectValue?[$0] }
      let id = field("id")
      guard let id, id.isTruthy else { throw Self.refusal(400, "Missing id") }
      let found = Self.ownedRow(s, did, id)
      func refuse(_ error: String, _ code: String, _ extra: [String: JSONValue] = [:]) -> Coded {
        Self.refusal(409, error, code: code, extra)
      }
      let t = { self.iso(self.now()) }
      if field("acknowledgeTimer")?.isTruthy == true {
        guard let i = found, s.scheduled[i].status == "published",
          s.scheduled[i].last_error_code == .string("TIMER_NOT_ARMED")
        else { throw refuse("there is no timer note on that post to clear.", "NOT_ACKNOWLEDGEABLE") }
        s.scheduled[i].last_error = nil
        s.scheduled[i].last_error_code = .null
        s.scheduled[i].updated_at = t()
      } else if field("retry")?.isTruthy == true {
        guard let i = found, s.scheduled[i].status == "failed" else {
          throw refuse(
            "this post can no longer be retried — it may have been dismissed, or already be back in the queue.",
            "NOT_RETRIABLE")
        }
        if let sd = s.scheduled[i].payload["selfDestruct"], sd.isTruthy {
          try enforceTimerLimit(s, did, conditions: sd["conditions"], effects: sd["effects"], exceptScheduledId: id)
        }
        try enforceScheduledLimit(s, did, except: id)
        s.scheduled[i].status = "pending"
        s.scheduled[i].attempts = 0
        s.scheduled[i].next_attempt_at = nil
        s.scheduled[i].updated_at = t()
      } else if field("skip")?.isTruthy == true {
        guard let i = found, s.scheduled[i].status == "pending", s.scheduled[i].progress.isEmpty,
          Self.carries(s.scheduled[i])
        else {
          throw refuse(
            "there is nothing to skip here: this post is not repeating, or is already on its way out.", "NOT_SKIPPABLE")
        }
        let next = try spawnNext(&s, i)
        s.scheduled[i].status = "cancelled"
        s.scheduled[i].updated_at = t()
        dropMedia(&s, s.scheduled[i], stored: i)
        note(&s, "skipped \(s.scheduled[i].id)")
        let data: JSONValue = next.map { Self.rowShape(s.scheduled[$0]) } ?? .null
        return ServerAnswer(200, ["success": true, "data": data, "skipped": id, "ended": .bool(next == nil)])
      } else if field("stopRepeat")?.isTruthy == true {
        guard let i = found, ["pending", "failed"].contains(s.scheduled[i].status),
          s.scheduled[i].payload["repeat"]?.isTruthy == true
        else {
          throw refuse(
            "this post is not repeating, or is already on its way out, so there is nothing to stop.", "NOT_REPEATING")
        }
        var rest = s.scheduled[i].payload.objectValue ?? [:]
        rest["repeat"] = nil
        s.scheduled[i].payload = .object(rest)
        s.scheduled[i].updated_at = t()
      } else if let payload = field("payload"), payload.isTruthy {
        // A rule is anchored at this row's number when it is the row its
        // series goes on from; anywhere else it starts a series at one.
        let carried = found.map { Self.carries(s.scheduled[$0]) } ?? false
        let occurrence: JSONValue = carried ? (found.flatMap { s.scheduled[$0].occurrence }.map(JSONValue.number) ?? .null) : 1
        let v: ScheduleValue
        do { v = try validateCreate(body, occurrence: occurrence) } catch let invalid as Invalid { throw invalid.coded }
        guard let i = found, ["pending", "failed"].contains(s.scheduled[i].status) else {
          throw refuse("This post can no longer be rescheduled — it may already be publishing.", "NOT_RESCHEDULABLE")
        }
        if !s.scheduled[i].progress.isEmpty {
          throw refuse(
            "part of this thread is already posted. the rest will follow on its own — cancel it here if you would rather finish by hand.",
            "PARTIALLY_PUBLISHED")
        }
        if v.selfDestruct.isTruthy {
          try enforceTimerLimit(
            s, did, conditions: v.selfDestruct["conditions"], effects: v.selfDestruct["effects"], exceptScheduledId: id)
        }
        if s.scheduled[i].status == "failed" { try enforceScheduledLimit(s, did, except: id) }
        let startsSeries = (v.repeatRule?.isTruthy ?? false) && !Self.carries(s.scheduled[i])
        // The edit's bytes go in a folder of their own, so the old ones can
        // stay for a failed occurrence of the series that still names them.
        let old = s.scheduled[i].payload
        let folder = "\(s.scheduled[i].id)/e-\(Self.base36(now()))"
        let fresh = try stashMedia(&s, folder, v.posts, payload["mediaBytes"].jsTruthy ?? [:])
        let rkeys = try assignRkeys(s, did, v.scheduledFor, v.posts.count, except: s.scheduled[i].id)
        s.scheduled[i].scheduled_for = v.scheduledFor
        s.scheduled[i].target = v.target
        s.scheduled[i].queued = v.queued
        s.scheduled[i].status = "pending"
        s.scheduled[i].attempts = 0
        s.scheduled[i].next_attempt_at = nil
        s.scheduled[i].last_error = nil
        s.scheduled[i].last_error_code = .null
        s.scheduled[i].payload = Self.payloadOf(v, media: fresh, rkeys: rkeys)
        s.scheduled[i].updated_at = t()
        var before = s.scheduled[i]
        before.payload = old
        dropMedia(&s, before, stored: nil)
        if startsSeries {
          s.scheduled[i].series_id = uuid()
          s.scheduled[i].occurrence = 1
        }
      } else {
        let scheduledFor = field("scheduledFor")
        if let error = validateTime(scheduledFor) { throw Self.refusal(400, error) }
        guard let i = found, s.scheduled[i].status == "pending" else {
          throw refuse("This post can no longer be rescheduled — it may already be publishing.", "NOT_RESCHEDULABLE")
        }
        if !s.scheduled[i].progress.isEmpty {
          throw refuse(
            "part of this thread is already posted. the rest will follow on its own — cancel it here if you would rather finish by hand.",
            "PARTIALLY_PUBLISHED")
        }
        if let stranded = strandsDeleteTime(s.scheduled[i].payload, scheduledFor) {
          throw refuse(
            "this post's delete time would come before it goes out, or within five minutes of it. pick an earlier slot, or change its lifespan first.",
            "DELETE_TIME_TOO_EARLY", ["deleteAt": stranded])
        }
        s.scheduled[i].scheduled_for = iso(dateParse(scheduledFor))
        let rkeys = try assignRkeys(
          s, did, s.scheduled[i].scheduled_for, s.scheduled[i].payload["posts"]?.arrayValue?.count ?? 0,
          except: s.scheduled[i].id)
        s.scheduled[i].payload["rkeys"] = .array(rkeys.map(JSONValue.string))
        // A repeating post moved to a new time repeats from there.
        if let rule = s.scheduled[i].payload["repeat"], rule.isTruthy {
          guard
            let anchor = ServerRepeat.anchoredRepeat(
              rule, .string(s.scheduled[i].scheduled_for), rule["tz"],
              occurrence: s.scheduled[i].occurrence.map(JSONValue.number) ?? .null)?["anchor"]
          else { throw HarnessJSError.typeError("Cannot read properties of null (reading 'anchor')") }
          var moved = rule.objectValue ?? [:]
          moved["anchor"] = anchor
          s.scheduled[i].payload["repeat"] = .object(moved)
        }
        s.scheduled[i].updated_at = t()
      }
      let i = found!
      note(&s, "updated \(s.scheduled[i].id)")
      return ServerAnswer(200, ["success": true, "data": Self.rowShape(s.scheduled[i])])
    }
  }

  /// `now().toString(36)` for a whole number of milliseconds.
  static func base36(_ ms: Double) -> String {
    guard ms.isFinite, abs(ms) < 9e15 else { return JSNumber.format(ms) }
    return String(Int64(ms), radix: 36)
  }

  /// POST /api/schedule/reorder: new times for up to fifty waiting posts,
  /// all or none.
  func scheduleReorder(_ did: String, _ given: JSONValue?) throws -> ServerAnswer {
    try state.withLock { s in
      let body = try Self.body(given)
      func bad(_ error: String) -> Coded { Self.refusal(400, error, code: "BAD_REQUEST") }
      guard case .array(let moves)? = body.objectValue?["moves"] else {
        throw bad("a reorder needs a list of posts to move.")
      }
      if moves.isEmpty || moves.count > 50 { throw bad("a reorder carries between one and 50 posts.") }
      var wanted: [(id: JSONValue, at: String)] = []
      func key(_ id: JSONValue) -> Int? { wanted.firstIndex { FakeServer.strictEquals($0.id, id) } }
      for m in moves {
        guard let id = m["id"], id.isTruthy, key(id) == nil else { throw bad("a post appears twice in that reorder.") }
        if validateTime(m["scheduledFor"]) != nil {
          throw bad(
            "a reorder needs a new time for every post — in the future, and within \(FakeServer.maxHorizonDays) days.")
        }
        wanted.append((id, iso(dateParse(m["scheduledFor"]))))
      }
      let rows = wanted.map { w in Self.visibleRows(s, did).first { Self.same(w.id, s.scheduled[$0].id) } }
      if rows.contains(where: { $0 == nil || s.scheduled[$0!].status != "pending" || !s.scheduled[$0!].progress.isEmpty }) {
        throw Self.refusal(
          409,
          "one of these posts can no longer be moved — it may already be publishing, or part of it may already be posted. your queue is unchanged.",
          code: "NOT_REORDERABLE")
      }
      let found = rows.map { $0! }
      for (n, i) in found.enumerated() {
        if let stranded = strandsDeleteTime(s.scheduled[i].payload, .string(wanted[n].at)) {
          throw Self.refusal(
            409,
            "the delete time on one of these posts would come before it goes out in this order, or within five minutes of it. move it earlier, or change its lifespan first. your queue is unchanged.",
            code: "DELETE_TIME_TOO_EARLY", ["id": .string(s.scheduled[i].id), "deleteAt": stranded])
        }
      }
      for (n, i) in found.enumerated() {
        s.scheduled[i].scheduled_for = wanted[n].at
        let rkeys = try assignRkeys(
          s, did, wanted[n].at, s.scheduled[i].payload["posts"]?.arrayValue?.count ?? 0, except: s.scheduled[i].id)
        s.scheduled[i].payload["rkeys"] = .array(rkeys.map(JSONValue.string))
        s.scheduled[i].updated_at = iso(now())
      }
      return ServerAnswer(200, ["success": true, "moved": .number(Double(found.count))])
    }
  }

  /// POST /api/schedule/cancel.
  func scheduleCancel(_ did: String, _ given: JSONValue?, _ query: [(String, String)]) throws -> ServerAnswer {
    try state.withLock { s in
      let body = try Self.body(given)
      let id = body.objectValue?["id"].jsTruthy ?? Self.get(query, "id").map(JSONValue.string)
      guard let id, id.isTruthy else { throw Self.refusal(400, "Missing id") }
      guard let i = Self.visibleRows(s, did).first(where: { Self.same(id, s.scheduled[$0].id) }),
        ["pending", "failed"].contains(s.scheduled[i].status)
      else {
        throw Self.refusal(409, "that post can no longer be cancelled. it may already be publishing.", code: "NOT_CANCELLABLE")
      }
      s.scheduled[i].status = "cancelled"
      s.scheduled[i].updated_at = iso(now())
      dropMedia(&s, s.scheduled[i], stored: i)
      note(&s, "cancelled \(s.scheduled[i].id)")
      return ServerAnswer(200, ["success": true, "data": ["id": .string(s.scheduled[i].id), "status": "cancelled"]])
    }
  }

  /// GET /api/limits/status: flat, unlimited unless set, the caps always
  /// reported.
  func limitsStatus(_ did: String) -> ServerAnswer {
    state.withLock { s in
      var features: [String: JSONValue] = [:]
      for key in FakeServer.features {
        if let limit = limitFor(key) {
          features[key] = ["isUnlimited": false, "limit": .number(Double(limit))]
        } else {
          features[key] = ["isUnlimited": true, "limit": .null]
        }
      }
      let usage = timerUsage(s, did)
      return ServerAnswer(
        200,
        [
          "success": true, "policy": "flat", "tier": .null, "isMember": false, "features": .object(features),
          "usage": [
            "scheduledPosts": .number(Double(activeScheduled(s, did).count)),
            "postTimers": .number(Double(usage.plain)), "conditionalTimers": .number(Double(usage.conditional)),
          ],
          "caps": [
            "scheduledPosts": .number(Double(FakeServer.maxPendingScheduled)),
            "timers": .number(Double(FakeServer.maxLiveTimers)),
          ],
        ])
    }
  }
}

extension FakeServer {
  /// `a === b` for two values JSON can hold: strings by code unit.
  static func strictEquals(_ a: JSONValue, _ b: JSONValue) -> Bool {
    switch (a, b) {
    case (.string(let x), .string(let y)): return x.jsEquals(y)
    case (.number(let x), .number(let y)): return x == y
    case (.bool(let x), .bool(let y)): return x == y
    case (.null, .null): return true
    default: return false  // objects and arrays are equal only to themselves
    }
  }
}
