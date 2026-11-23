// Ports harness/fakeServer.js (the workers: runSchedule, runTimers, runCron; and the seeded rows)
//
// `runCron()` stands in for the server's two workers and Defense's list
// writer: due scheduled posts are written into the account's world (the
// harness's repo), as putRecord at the record keys reserved when they were
// scheduled, with their gates, a reply under its parent (and not at all if
// the parent is gone), a repeating post's next occurrence left waiting,
// and its timer armed; due timers read the post's counts and delete it,
// limit its replies or turn off its quotes, or spare it. A failure is
// retried with backoff until the row's attempts run out.
//
// `seedRows()` gives Mira a few rows to look at: the second of six monthly
// posts, one in the queue, a failed thread, a timer note, a live timer and
// a settled one, at times worked out from `now` on the world's clock.

import Foundation
import VirgaCore
import VirgaNetwork

/// A worker's failure: the message and code a row keeps, and whether to stop retrying.
struct WorkerFailure: Error, LocalizedError {
  var message: String
  var code: String
  var terminal = false

  var errorDescription: String? { message }
}

extension DemoServer {
  /// What the workers did in one run (`{ published, settled, listed }`).
  public struct CronRun: Sendable {
    /// The scheduled rows published, as they stand after the run.
    public var published: [ScheduledRow]
    /// The timers that were due, as they stand after the run.
    public var settled: [TimerRow]
    /// How many list items Defense wrote.
    public var listed: Int
  }

  /// `err.message` and `err.code || 'UNKNOWN'` of what a worker threw: a
  /// DOMException (atob's) carries its legacy number.
  static func failureOf(_ error: any Error) -> (message: String, code: JSONValue, terminal: Bool) {
    switch error {
    case let failure as WorkerFailure: return (failure.message, .string(failure.code), failure.terminal)
    case let js as HarnessJSError where js.name == "InvalidCharacterError": return (js.message, 5, false)
    default: return (jsMessage(error), "UNKNOWN", false)
    }
  }

  // MARK: Publishing

  /// `blobFor(world, row, mediaId)`: the stashed bytes, put in the account's repo.
  func blobFor(_ s: State, _ did: String, _ row: ScheduledRow, _ mediaId: JSONValue?) throws -> JSONValue {
    let m = Self.member(row.payload["media"], mediaId ?? .null)
    guard let m, m.isTruthy, let path = m["storagePath"], let stored = s.media[JSKey(path.jsString)] else {
      throw WorkerFailure(
        message: "the images for this scheduled post are missing. edit it and re-attach them.", code: "MEDIA_MISSING",
        terminal: true)
    }
    let bytes = try JSBase64.atob(stored.base64.jsString)
    let type: String? = stored.encoding.flatMap { $0.isNull ? nil : $0.jsString }
    return try world.storeBlob(did: did, bytes: bytes, mimeType: type)
  }

  /// `buildEmbed(world, row, spec)`: a payload's embed as the record's.
  func buildEmbed(_ s: State, _ did: String, _ row: ScheduledRow, _ spec: JSONValue?) throws -> JSONValue? {
    guard let spec, spec.isTruthy else { return nil }
    switch spec["type"] {
    case .some(.string("images")):
      var images: [JSONValue] = []
      for img in spec["images"]?.arrayValue ?? [] {
        var image: [String: JSONValue] = [
          "alt": img["alt"].jsTruthy ?? "",
          "image": try blobFor(s, did, row, img["mediaId"]),
        ]
        if let ratio = img["aspectRatio"], ratio.isTruthy { image["aspectRatio"] = ratio }
        images.append(.object(image))
      }
      if images.count > 4 {
        return [
          "$type": "app.bsky.embed.gallery",
          "items": .array(
            images.map { item in
              var out = item.objectValue ?? [:]
              out["$type"] = "app.bsky.embed.gallery#image"
              return .object(out)
            }),
        ]
      }
      return ["$type": "app.bsky.embed.images", "images": .array(images)]
    case .some(.string("external")):
      var external: [String: JSONValue] = [
        "title": spec["title"].jsTruthy ?? "",
        "description": spec["description"].jsTruthy ?? "",
      ]
      if let uri = spec["uri"] { external["uri"] = uri }
      if let thumb = spec["thumbMediaId"], thumb.isTruthy { external["thumb"] = try blobFor(s, did, row, thumb) }
      if case .array(let refs)? = spec["associatedRefs"], !refs.isEmpty { external["associatedRefs"] = .array(refs) }
      return ["$type": "app.bsky.embed.external", "external": .object(external)]
    case .some(.string("record")):
      return ["$type": "app.bsky.embed.record", "record": Self.ref(spec)]
    case .some(.string("recordWithMedia")):
      var out: [String: JSONValue] = [
        "$type": "app.bsky.embed.recordWithMedia",
        "record": ["$type": "app.bsky.embed.record", "record": Self.ref(spec)],
      ]
      if let media = try buildEmbed(s, did, row, spec["media"]) { out["media"] = media }
      return .object(out)
    default:
      return nil
    }
  }

  /// `{ uri: spec.uri, cid: spec.cid }`, an absent one left out.
  static func ref(_ spec: JSONValue) -> JSONValue {
    var out: [String: JSONValue] = [:]
    if let uri = spec["uri"] { out["uri"] = uri }
    if let cid = spec["cid"] { out["cid"] = cid }
    return .object(out)
  }

  /// `publishRow(row)`: the row's posts written into the account's world
  /// from where it got to, its gates with the first. Answers the progress.
  func publishRow(_ s: inout State, _ index: Int) throws -> [JSONValue] {
    let row = s.scheduled[index]
    let did = row.user_did
    guard world.world(did) != nil, grantUsable(s, did) else {
      throw WorkerFailure(message: FakeServer.sessionUnavailable, code: "SESSION_UNAVAILABLE")
    }
    let posts = row.payload["posts"]?.arrayValue ?? []
    let base = dateParse(.string(row.scheduled_for))
    let reply = row.payload["reply"].jsTruthy
    // A reply isn't posted as an orphan: the post it answers has to be
    // there still. Asked once, before the first post.
    if let reply, row.progress.isEmpty {
      let parent = reply["parent"]?["uri"]
      let uri = parent?.isTruthy == true ? parent!.jsString : ""
      if try world.views.postView(uri, now: now()) == nil {
        throw WorkerFailure(
          message: "the post this replies to has been deleted, so the reply was not posted.", code: "REPLY_TARGET_GONE",
          terminal: true)
      }
    }
    var i = row.progress.count
    while i < posts.count {
      let spec = posts[i]
      var record: [String: JSONValue] = [
        "$type": "app.bsky.feed.post",
        "text": spec["record"]?["text"].jsTruthy ?? "",
        "createdAt": .string(iso(base + Double(i))),
      ]
      for k in ["facets", "langs", "labels", "tags"] {
        if let value = spec["record"]?[k], value.isTruthy { record[k] = value }
      }
      if let embed = try buildEmbed(s, did, s.scheduled[index], spec["embed"]) { record["embed"] = embed }
      // A reply's later posts answer the one before, under the same root.
      let progress = s.scheduled[index].progress
      if i > 0 {
        record["reply"] = ["root": reply?["root"] ?? progress[0], "parent": progress[i - 1]]
      } else if let reply {
        record["reply"] = ["root": reply["root"] ?? .null, "parent": reply["parent"] ?? .null]
      }
      let reserved = row.payload["rkeys"]?[i].flatMap { $0.isTruthy ? $0.jsString : nil }
      let rkey = try reserved ?? World.tidAt(base + Double(i))
      let written = try world.writeRecord(
        did: did, collection: "app.bsky.feed.post", rkey: rkey, record: .object(record), now: now())
      if i == 0 && reply == nil {
        let gates = row.payload["gates"]
        if case .array(let allow)? = gates?["threadgate"] {
          try world.writeRecord(
            did: did, collection: "app.bsky.feed.threadgate", rkey: rkey,
            record: [
              "$type": "app.bsky.feed.threadgate", "post": .string(written.uri), "createdAt": record["createdAt"]!,
              "allow": .array(allow), "hiddenReplies": [],
            ], now: now())
        }
        if case .array(let rules)? = gates?["postgate"], !rules.isEmpty {
          try world.writeRecord(
            did: did, collection: "app.bsky.feed.postgate", rkey: rkey,
            record: [
              "$type": "app.bsky.feed.postgate", "post": .string(written.uri), "createdAt": record["createdAt"]!,
              "detachedEmbeddingUris": [], "embeddingRules": .array(rules),
            ], now: now())
        }
      }
      s.scheduled[index].progress.append(["uri": .string(written.uri), "cid": .string(written.cid)])
      i += 1
    }
    return s.scheduled[index].progress
  }

  /// `runSchedule()`: every due row published, or failed and retried
  /// later. Answers the rows published.
  @discardableResult
  public func runSchedule() -> [ScheduledRow] {
    state.withLock { s in
      let t = now()
      let due = s.scheduled.indices.filter { i in
        let r = s.scheduled[i]
        return r.status == "pending" && dateParse(.string(r.scheduled_for)) <= t
          && (r.next_attempt_at.map { $0.isEmpty || dateParse(.string($0)) <= t } ?? true)
      }
      var published: [Int] = []
      for i in due {
        s.scheduled[i].status = "publishing"
        s.scheduled[i].attempts += 1
        do {
          let progress = try publishRow(&s, i)
          // The next occurrence of a repeating post is written with the
          // status that ends this one; its images stay for it.
          try spawnNext(&s, i)
          s.scheduled[i].status = "published"
          s.scheduled[i].result_uri = progress[0]["uri"]?.stringValue
          s.scheduled[i].result_cid = progress[0]["cid"]?.stringValue
          s.scheduled[i].last_error = nil
          s.scheduled[i].last_error_code = .null
          s.scheduled[i].updated_at = iso(now())
          dropMedia(&s, s.scheduled[i], stored: i)
          published.append(i)
          note(&s, "published \(s.scheduled[i].id) as \(s.scheduled[i].result_uri ?? "null")")
          if let sd = s.scheduled[i].payload["selfDestruct"], sd.isTruthy {
            var spec: [String: JSONValue] = [
              "postUri": progress[0]["uri"] ?? .null, "postCid": progress[0]["cid"] ?? .null,
              "extraUris": .array(progress.dropFirst().map { $0["uri"] ?? .null }),
              "postedAt": .string(iso(now())),
            ]
            if let snippet = s.scheduled[i].payload["posts"]?[0]?["record"]?["text"] { spec["snippet"] = snippet }
            for (key, value) in sd.objectValue ?? [:] { spec[key] = value }
            switch validateArm(s.scheduled[i].user_did, .object(spec), missedDeadline: "window") {
            case .failure(let invalid):
              s.scheduled[i].last_error =
                "this post published, but its self-destruct timer could not be set: \(invalid.error). set a timer by hand from the posted page."
              s.scheduled[i].last_error_code = "TIMER_NOT_ARMED"
            case .success(let v):
              armTimer(&s, s.scheduled[i].user_did, v)
            }
          }
        } catch {
          let failure = Self.failureOf(error)
          let exhausted = failure.terminal || s.scheduled[i].attempts >= s.scheduled[i].max_attempts
          // A repeating post goes on from its schedule: the failed
          // occurrence stays to retry or dismiss, and an older failure
          // makes way for it.
          if exhausted, (try? spawnNext(&s, i)) != nil, let series = s.scheduled[i].series_id {
            let occurrence = s.scheduled[i].occurrence
            for j in s.scheduled.indices {
              let old = s.scheduled[j]
              guard old.series_id.map({ $0.jsEquals(series) }) ?? false, old.status == "failed",
                let a = old.occurrence, let b = occurrence, a < b
              else { continue }
              s.scheduled[j].status = "cancelled"
              dropMedia(&s, s.scheduled[j], stored: j)
            }
          }
          let attempts = Double(s.scheduled[i].attempts)
          s.scheduled[i].status = exhausted ? "failed" : "pending"
          s.scheduled[i].next_attempt_at =
            exhausted ? nil : iso(now() + Swift.min(JSMath.pow(2, attempts), 60) * FakeServer.minute)
          s.scheduled[i].last_error = failure.message.jsSlice(0, 500)
          s.scheduled[i].last_error_code = failure.code.isTruthy ? failure.code : "UNKNOWN"
          s.scheduled[i].updated_at = iso(now())
          note(&s, "couldn't publish \(s.scheduled[i].id): \(failure.message)")
        }
      }
      return published.map { s.scheduled[$0] }
    }
  }

  // MARK: Timers

  /// `selfReplyChain(world, uri)`: the account's own replies under a post,
  /// depth first. A chain too deep to walk (a cycle of replies) throws as
  /// V8's stack does. Walked with a stack of its own, not by recursion, so a
  /// deep chain can't overflow a task's small stack on iOS.
  static func selfReplyChain(_ world: AccountWorld, _ uri: String) throws -> [String] {
    let parents = world.posts.map { $0.record?["reply"]?["parent"]?["uri"]?.stringValue }
    var out: [String] = []
    // Each frame is a `walk(parent)` call: the parent, and the next post to look at.
    var stack: [(parent: String, next: Int)] = [(uri, 0)]
    while var frame = stack.popLast() {
      while frame.next < parents.count {
        let i = frame.next
        frame.next += 1
        guard let parent = parents[i], parent.jsEquals(frame.parent) else { continue }
        let child = "at://\(world.me.did)/app.bsky.feed.post/\(world.posts[i].rkey)"
        out.append(child)
        stack.append(frame)
        // The child's call is this deep.
        if stack.count > 9000 { throw HarnessJSError(name: "RangeError", message: "Maximum call stack size exceeded") }
        stack.append((child, 0))
        break
      }
    }
    return out
  }

  /// `limitReplies(world, row, post, effect, t)`: the server's
  /// applyLimitReplies. A gate governs a thread from its root, so a reply is
  /// left alone, and the rule only narrows the gate already there.
  func limitReplies(_ row: TimerRow, _ post: HarnessRepo.Row, _ effect: JSONValue, _ t: Double) throws -> JSONValue {
    if post.value["reply"]?.isTruthy == true {
      return [
        "ok": false,
        "detail":
          "replies can only be limited on the first post of a thread, and this post is a reply, so its replies were left as they were",
      ]
    }
    guard let owner = world.world(row.user_did) else { throw DemoWorldError.noAccount(row.user_did) }
    let existing = try HarnessRepo.readRecord(owner, FakeServer.gate, row.rkey)
    let wanted = effect["allow"].jsTruthy ?? []
    let narrowed = try FakeServer.narrowAllow(wanted, existing?.value["allow"])
    guard let allow = narrowed.allow else {
      return ["ok": .bool(narrowed.ok), "detail": narrowed.detail.map(JSONValue.string) ?? .null]
    }
    try world.writeRecord(
      did: row.user_did, collection: FakeServer.gate, rkey: row.rkey,
      record: [
        "$type": .string(FakeServer.gate), "post": .string(row.post_uri), "createdAt": .string(iso(t)),
        "allow": .array(allow), "hiddenReplies": existing?.value["hiddenReplies"].jsTruthy ?? [],
      ], now: now())
    return ["ok": true, "detail": .string(try FakeServer.describeAllow(.array(allow.compactMap(FakeServer.allowEntryFromRecord))))]
  }

  /// `settleTimer(row)`: the post's counts read, and the rule acted on:
  /// spared (or run again, when the rule extends), or its effects done.
  func settleTimer(_ s: inout State, _ i: Int) throws {
    let row = s.timers[i]
    let owner = world.world(row.user_did)
    let t = now()
    func resolve(_ status: String, _ resolution: String, _ acted: JSONValue = .null) {
      s.timers[i].status = status
      s.timers[i].resolution = resolution
      s.timers[i].acted = acted
      s.timers[i].resolved_at = iso(t)
      s.timers[i].attempts += 1
    }
    guard let owner, let post = try HarnessRepo.readRecord(owner, row.collection, row.rkey) else {
      resolve("deleted", "the post was already gone")
      return
    }
    if !grantUsable(s, row.user_did) {
      s.timers[i].attempts += 1
      s.timers[i].check_at = iso(t + 2 * FakeServer.minute)
      s.timers[i].last_error =
        "couldn't reach your account session, so this post was left up. reconnect your account if this keeps happening."
      s.timers[i].last_error_code = "SESSION_UNAVAILABLE"
      if s.timers[i].attempts >= s.timers[i].max_attempts { resolve("failed", "the post is still up") }
      return
    }
    let view = try world.views.postView(row.post_uri, now: now())
    func count(_ key: String) -> JSONValue { view?[key].jsTruthy ?? 0 }
    let counts: JSONValue = [
      "likes": count("likeCount"), "replies": count("replyCount"), "reposts": count("repostCount"),
      "quotes": count("quoteCount"), "selfReplies": .number(Double(try Self.selfReplyChain(owner, row.post_uri).count)),
    ]
    s.timers[i].last_counts = counts
    var why = "on time"
    let conditions = row.conditions
    if FakeServer.jsLengthOf(conditions["clauses"].jsTruthy) > 0 {
      let verdict = try FakeServer.evaluateConditions(conditions, counts)
      if verdict.spare {
        if conditions["onSpare"] == .string("extend"),
          FakeServer.jsCompare(.number(Double(row.extensions)), conditions["maxExtensions"], orEqual: false) == false,
          FakeServer.jsCompare(conditions["maxExtensions"], .number(Double(row.extensions)), orEqual: false)
        {
          s.timers[i].check_at = iso(t + row.lifespan_seconds * 1000)
          s.timers[i].extensions += 1
          s.timers[i].attempts = 0
          note(&s, "timer \(row.id) spared for now (\(verdict.reason)), runs again")
          return
        }
        resolve("spared", "kept: \(verdict.reason)")
        return
      }
      why = FakeServer.describeCounts(counts)
    }
    var acted: [JSONValue] = []
    let effects = row.effects.arrayValue.flatMap { $0.isEmpty ? nil : $0 } ?? [["action": "delete"]]
    for effect in effects {
      if effect["action"] == .string("limitReplies") {
        var entry: [String: JSONValue] = ["action": "limitReplies"]
        for (key, value) in try limitReplies(s.timers[i], post, effect, t).objectValue ?? [:] { entry[key] = value }
        acted.append(.object(entry))
      } else if effect["action"] == .string("disableQuotes") {
        let existing = try HarnessRepo.readRecord(world.world(row.user_did) ?? owner, "app.bsky.feed.postgate", row.rkey)
        let rules = existing?.value["embeddingRules"].jsTruthy ?? []
        guard case .array(let list) = rules else {
          throw HarnessJSError.typeError("(existing?.value?.embeddingRules || []).some is not a function")
        }
        let already = list.contains { $0["$type"] == .string("app.bsky.feed.postgate#disableRule") }
        if !already {
          try world.writeRecord(
            did: row.user_did, collection: "app.bsky.feed.postgate", rkey: row.rkey,
            record: [
              "$type": "app.bsky.feed.postgate", "post": .string(row.post_uri), "createdAt": .string(iso(t)),
              "detachedEmbeddingUris": existing?.value["detachedEmbeddingUris"].jsTruthy ?? [],
              "embeddingRules": [["$type": "app.bsky.feed.postgate#disableRule"]],
            ], now: now())
        }
        acted.append([
          "action": "disableQuotes", "ok": true, "detail": already ? "quoting was already off" : "quoting turned off",
        ])
      } else {
        let current = world.world(row.user_did) ?? owner
        var seen = Set<JSKey>()
        var chain: [String] = []
        for uri in row.extra_uris.map({ $0["uri"].map(\.jsString) ?? "undefined" }) + (try Self.selfReplyChain(current, row.post_uri))
        where seen.insert(JSKey(uri)).inserted {
          chain.append(uri)
        }
        chain.reverse()
        for uri in chain + [row.post_uri] {
          guard let p = HarnessRepo.parseAtUri(uri) else {
            throw HarnessJSError.typeError("Cannot read properties of null (reading 'collection')")
          }
          try world.removeRecord(did: row.user_did, collection: p.collection, rkey: p.rkey)
          try world.removeRecord(did: row.user_did, collection: "app.bsky.feed.threadgate", rkey: p.rkey)
          try world.removeRecord(did: row.user_did, collection: "app.bsky.feed.postgate", rkey: p.rkey)
        }
        acted.append([
          "action": "delete", "ok": true,
          "detail": .string(chain.isEmpty ? "deleted" : "deleted with \(chain.count) more"),
        ])
      }
    }
    let deleted = acted.contains { $0["action"] == .string("delete") }
    // As the server's markActed: an acted row's resolution is just the
    // counts, since `acted` already says what was done.
    resolve(deleted ? "deleted" : "acted", deleted ? "deleted, \(why)" : why, .array(acted))
    note(&s, "timer \(row.id) \(s.timers[i].resolution ?? "null")")
  }

  /// `runTimers()`: every armed timer whose time has come, settled.
  /// Answers the timers that were due.
  @discardableResult
  public func runTimers() -> [TimerRow] {
    state.withLock { s in
      let due = s.timers.indices.filter { s.timers[$0].status == "armed" && dateParse(.string(s.timers[$0].check_at)) <= now() }
      for i in due {
        s.timers[i].status = "checking"
        do {
          try settleTimer(&s, i)
          if s.timers[i].status == "checking" { s.timers[i].status = "armed" }
        } catch {
          s.timers[i].status = "failed"
          s.timers[i].resolution = "the post is still up"
          s.timers[i].resolved_at = iso(now())
          s.timers[i].last_error = jsMessage(error)
          s.timers[i].last_error_code = "UNKNOWN"
        }
      }
      return due.map { s.timers[$0] }
    }
  }

  /// `runCron()`: one run of both workers and Defense's list writer.
  @discardableResult
  public func runCron() async -> CronRun {
    let published = runSchedule()
    let settled = runTimers()
    let listed = await defense.run()
    return CronRun(published: published, settled: settled, listed: listed)
  }

  /// `runDefense()`: Defense's list writer alone.
  @discardableResult
  public func runDefense() async -> Int { await defense.run() }

  // MARK: Seeds

  /// `seedRows()`: Mira's rows to look at, dated from `now`.
  func seedRows(_ s: inout State) throws {
    guard let mira = world.worlds.first(where: { $0.me.handle == "mira.example.com" }) else { return }
    let did = mira.me.did
    let t = now()
    func at(_ days: Double, _ hour: Double) -> String {
      let day = t + days * FakeServer.day
      guard let f = JSDate.fields(day, timeZone: timeZone) else { return iso(day) }
      return iso(JSDate.local(Double(f.year), Double(f.month), Double(f.date), hour, 0, 0, 0, timeZone: timeZone))
    }
    func text(_ words: String) -> JSONValue { ["record": ["text": .string(words), "langs": ["en"]]] }
    func value(_ scheduledFor: String, _ posts: [JSONValue], queued: Bool = false, rule: JSONValue? = nil) -> ScheduleValue {
      ScheduleValue(
        scheduledFor: scheduledFor, target: "bluesky", posts: posts, gates: ["threadgate": .null, "postgate": .null],
        queued: queued, selfDestruct: .null, tz: "Europe/London", reply: nil, replyTo: .null, repeatRule: rule)
    }
    // At a time of its own, outside the weekly queue, and repeating: the
    // second of six monthly posts.
    let swapAt = at(1, 10)
    let swap = try insertScheduled(
      &s, did: did,
      value: value(
        swapAt, [text("Seed swap at the library on Saturday morning. Bring envelopes and labels.")],
        rule: ServerRepeat.anchoredRepeat(["every": "month", "count": 6], .string(swapAt), "Europe/London", occurrence: 2)),
      mediaBytes: nil, id: FakeServer.seededUuid("virga-seed-swap"))
    s.scheduled[swap].series_id = FakeServer.seededUuid("virga-seed-swap-series")
    s.scheduled[swap].occurrence = 2
    try insertScheduled(
      &s, did: did,
      value: value(
        at(2, 9),
        [text("Repair café this Sunday, 11 till 3. Lamps, zips, bikes, anything with one thing wrong with it.")],
        queued: true), mediaBytes: nil, id: FakeServer.seededUuid("virga-queued"))
    let failedCreated = at(-5, 12)
    try insertScheduled(
      &s, did: did,
      value: value(
        at(-3, 18),
        [
          text("A thread on what the tool library lent out this year."),
          text("Most borrowed: the long ladder. Least returned: the good secateurs."),
        ]), mediaBytes: nil, id: FakeServer.seededUuid("virga-failed"), status: "failed"
    ) { row in
      row.attempts = 5
      row.last_error = FakeServer.sessionUnavailable
      row.last_error_code = "SESSION_UNAVAILABLE"
      row.created_at = failedCreated
    }
    let recent = Array(mira.posts.filter { $0.replyTo == nil }.prefix(3))
    if let first = recent.first {
      try insertScheduled(
        &s, did: did, value: value(at(-1, 8), [text(first.text.isEmpty ? "Morning." : first.text)]), mediaBytes: nil,
        id: FakeServer.seededUuid("virga-timer-note"), status: "published"
      ) { row in
        row.result_uri = "at://\(did)/app.bsky.feed.post/\(first.rkey)"
        row.result_cid = "bafyharness"
        row.last_error =
          "this post published, but its self-destruct timer could not be set: this account can keep one plain timer at a time, counting scheduled posts. set a timer by hand from the posted page."
        row.last_error_code = "TIMER_NOT_ARMED"
      }
    }
    if recent.count > 1 {
      let second = recent[1]
      let conditions =
        FakeServer.parseConditions(["clauses": [["metric": "likes", "op": "gte", "value": 20]], "sense": "unless"]).value
        ?? .null
      armTimer(
        &s, did,
        ArmValue(
          uri: "at://\(did)/app.bsky.feed.post/\(second.rkey)", collection: "app.bsky.feed.post", rkey: second.rkey,
          cid: "bafyharness", extra: [], snippet: second.text.jsSlice(0, 200), postedAt: second.at,
          checkAt: iso(t + 2 * FakeServer.day), seconds: 3 * 86400, conditions: conditions,
          effects: [["action": "delete"]], resolution: nil),
        id: FakeServer.seededUuid("virga-timer-live"))
    }
    let doneKey = World.tid(t - 4 * FakeServer.day, 77)
    s.timers.append(
      TimerRow(
        id: FakeServer.seededUuid("virga-timer-done"), user_did: did, post_uri: "at://\(did)/app.bsky.feed.post/\(doneKey)",
        post_cid: nil, collection: "app.bsky.feed.post", rkey: doneKey, extra_uris: [],
        snippet: "Lost a glove on the towpath. Black, left hand, very loved.", posted_at: iso(t - 4 * FakeServer.day),
        check_at: iso(t - 3 * FakeServer.day), status: "deleted", conditions: FakeServer.parseConditions([:]).value ?? .null,
        effects: [["action": "delete"]], acted: [["action": "delete", "ok": true, "detail": "deleted"]],
        lifespan_seconds: 86400, extensions: 0,
        last_counts: ["likes": 3, "replies": 1, "reposts": 0, "quotes": 0, "selfReplies": 0],
        resolution: "deleted, on time", resolved_at: iso(t - 3 * FakeServer.day), attempts: 1, max_attempts: 5,
        last_error: nil, last_error_code: nil, created_at: iso(t - 4 * FakeServer.day)))
  }
}
