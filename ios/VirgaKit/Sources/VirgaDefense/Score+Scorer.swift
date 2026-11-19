// Ports src/defense/score.js: createScorer.
//
// A scorer for one owner. Reads are injected, so the same scorer runs on
// iOS (the signed-in `getProfiles`), against Virga's server, and against
// fixtures. It reads profiles (with the canary) and relationships side by
// side, at most `concurrency` batches of each in flight, and stops the other
// half as soon as one fails: a score is all or nothing.
//
// An actor, because the canary can change under the batches in flight (one
// re-pick, shared by every batch that needs it), as the web's closure
// variables do between its awaits.

import Foundation
import VirgaCore

public actor Scorer {
  let ownerDid: String
  let getProfiles: GetProfiles
  let getRelationships: GetRelationships
  /// The canary the scorer was made with; only a batch that used it may ask for a re-pick.
  let canary: String?
  let refindCanary: (@Sendable () async throws -> String?)?
  let protectedSet: [String: String]
  let selfSet: Set<String>
  let alreadyListed: Set<String>
  let blockers: Set<String>
  let thresholds: Thresholds
  let retryDelaysMs: [Double]
  let concurrency: Int
  let now: @Sendable () -> Date
  let timeZone: TimeZone?

  private var currentCanary: String?
  /// The one re-pick, shared by every batch that needs it.
  private var refind: Task<String?, Never>?

  init(
    ownerDid: String,
    getProfiles: @escaping GetProfiles,
    getRelationships: @escaping GetRelationships,
    canary: String?,
    refindCanary: (@Sendable () async throws -> String?)?,
    protectedSet: [String: String],
    selves: [String],
    alreadyListed: Set<String>,
    blockers: Set<String>,
    thresholds: Thresholds,
    retryDelaysMs: [Double],
    concurrency: Int,
    now: @escaping @Sendable () -> Date,
    timeZone: TimeZone?
  ) {
    self.ownerDid = ownerDid
    self.getProfiles = getProfiles
    self.getRelationships = getRelationships
    // An empty canary is none, as JavaScript's falsy "" is.
    let canary = canary.flatMap { $0.isEmpty ? nil : $0 }
    self.canary = canary
    self.currentCanary = canary
    self.refindCanary = refindCanary
    self.protectedSet = protectedSet
    self.selfSet = Set(selves.filter { !$0.isEmpty })
    self.alreadyListed = alreadyListed
    self.blockers = blockers
    self.thresholds = thresholds
    self.retryDelaysMs = retryDelaysMs
    self.concurrency = concurrency
    self.now = now
    self.timeZone = timeZone
  }

  /// Whether vouches are being checked against a canary right now.
  public var vouchCheck: VouchCheck { currentCanary == nil ? .unavailable : .canary }

  /// The canary the batches carry now (the re-pick, once there was one).
  public var activeCanary: String? { currentCanary }

  /// How far a score has got: `done` of `total` accounts read.
  public struct Progress: Sendable, Hashable {
    public var done: Int
    public var total: Int
  }

  /// One ask of a batch, with the canary riding along: the profiles by DID
  /// (the canary dropped unless it is one of the batch), whether the batch
  /// was counted, and the canary it carried.
  private func askBatch(_ batch: [String]) async throws -> (byDid: [String: JSONValue], counted: Bool, used: String?) {
    let used = currentCanary
    let withCanary = used.map { batch.jsContains($0) ? batch : batch + [$0] } ?? batch
    let getProfiles = self.getProfiles
    let found = try await Score.withRetries(delays: retryDelaysMs, what: "profiles") {
      try await getProfiles(withCanary)
    }
    var byDid: [String: JSONValue] = [:]
    for p in found {
      if let did = p["did"]?.stringValue, !did.isEmpty { byDid[did] = p }
    }
    let counted = used.map { Score.knownFollowersOf(byDid[$0]) != nil } ?? true
    if let used, !batch.jsContains(used) { byDid[used] = nil }
    return (byDid, counted, used)
  }

  /// One batch of profiles whose vouches can be trusted, or a throw. A
  /// batch whose canary came back without its count is asked again; if the
  /// canary never answers, it is picked again once (someone may have
  /// unfollowed), and if that fails too, nothing is scored.
  private func profileBatch(_ batch: [String]) async throws -> [String: JSONValue] {
    var attempt = 0
    while true {
      try Task.checkCancellation()
      let (byDid, counted, used) = try await askBatch(batch)
      if counted { return byDid }
      if attempt < retryDelaysMs.count {
        await Limit.pause(retryDelaysMs[attempt])
        attempt += 1
        continue
      }
      if let refindCanary, used == canary {
        let repick: Task<String?, Never>
        if let refind {
          repick = refind
        } else {
          repick = Task { (try? await refindCanary()) ?? nil }
          refind = repick
        }
        // The re-pick is shared, so it isn't a child of this batch: a score
        // that is stopped (or has failed elsewhere) stops it, as the web's
        // re-pick reads with the scan's signal, rather than waiting it out.
        let next = await withTaskCancellationHandler {
          await repick.value
        } onCancel: {
          repick.cancel()
        }
        try Task.checkCancellation()
        if let next, !next.isEmpty, next != used {
          currentCanary = next
          attempt = 0  // a fresh set of tries with the new canary
          continue
        }
      }
      throw ScoreError(
        "Bluesky didn't say who you know in common with these accounts, so they weren't scored. Try again in a minute.",
        code: .vouches)
    }
  }

  private func profiles(
    _ dids: [String],
    onProgress: (@Sendable (Progress) async -> Void)?
  ) async throws -> [String: JSONValue] {
    let size = currentCanary == nil ? Score.profileBatch : Score.profileBatch - 1
    let total = dids.count
    // The web calls onProgress synchronously as each batch lands, so its
    // reports only ever count up. Batches land side by side here, so each
    // report is queued as it is counted and handed over one at a time, in
    // that order, and all of them before the score returns or throws.
    let (reports, queue) = AsyncStream.makeStream(of: Progress.self)
    let reporter = Task {
      for await progress in reports { await onProgress?(progress) }
    }
    // This score's own count of what has been read, as the web's `done`.
    let done = Locked(0)
    let found: [[String: JSONValue]]
    do {
      found = try await Limit.mapLimit(Limit.chunks(dids, size), concurrency) { batch, _ in
        let byDid = try await self.profileBatch(batch)
        done.withLock { n in
          n += batch.count
          queue.yield(Progress(done: n, total: total))
        }
        return byDid
      }
    } catch {
      queue.finish()
      await reporter.value
      throw error
    }
    queue.finish()
    await reporter.value
    var out: [String: JSONValue] = [:]
    for byDid in found { out.merge(byDid) { _, last in last } }
    return out
  }

  private func relationships(_ dids: [String]) async throws -> [String: Relationship] {
    let ownerDid = self.ownerDid
    let getRelationships = self.getRelationships
    let delays = retryDelaysMs
    let found = try await Limit.mapLimit(Limit.chunks(dids, Score.relBatch), concurrency) { batch, _ in
      try await Score.withRetries(delays: delays, what: "who you follow") {
        try await getRelationships(ownerDid, batch)
      }
    }
    var out: [String: Relationship] = [:]
    for list in found {
      for r in list {
        guard let did = r["did"], did.isTruthy, let key = did.stringValue else { continue }
        out[key] = Relationship(
          youFollow: r["following"]?.isTruthy ?? false, followsYou: r["followedBy"]?.isTruthy ?? false)
      }
    }
    return out
  }

  private enum Half: Sendable {
    case profiles([String: JSONValue])
    case relationships([String: Relationship])
  }

  private struct Relationship: Sendable {
    var youFollow: Bool
    var followsYou: Bool
  }

  /// Score a list of DIDs. Throws a ScoreError when any batch can't be read
  /// (or counted), rather than scoring part of the list from defaults, and
  /// CancellationError when the calling task is cancelled. `onProgress`
  /// hears of each batch as it lands, one report at a time and counting
  /// up, as the web's synchronous callback does, and every report is
  /// handed over before this returns or throws.
  public func score(
    _ dids: [String],
    onProgress: (@Sendable (Progress) async -> Void)? = nil
  ) async throws -> ScoreResult {
    let unique = dids.jsUnique().filter { !$0.isEmpty }
    // When either half fails the whole score is thrown away, so the other
    // half stops asking rather than spending the AppView on an answer no
    // one will read: the group cancels it.
    var profs: [String: JSONValue] = [:]
    var rels: [String: Relationship] = [:]
    try await withThrowingTaskGroup(of: Half.self) { group in
      group.addTask { .profiles(try await self.profiles(unique, onProgress: onProgress)) }
      group.addTask { .relationships(try await self.relationships(unique)) }
      for try await half in group {
        switch half {
        case .profiles(let p): profs = p
        case .relationships(let r): rels = r
        }
      }
    }

    // Without a canary an absent count can't be read as zero with any
    // confidence, so the one closeness sign that needs no count stands in.
    let vouchCheck: VouchCheck = currentCanary == nil ? .unavailable : .canary
    var t = thresholds
    if vouchCheck == .unavailable { t.followsYouConnects = true }
    // Whole milliseconds, as the web's Date.now() gives.
    let nowMs = (now().timeIntervalSince1970 * 1000).rounded()
    let zone = timeZone ?? AppLocale.activeTimeZone()

    var scores: [String: AccountScore] = [:]
    for did in unique {
      let p = profs[did]
      let rel = rels[did] ?? Relationship(youFollow: false, followsYou: false)
      let youFollow = rel.youFollow || (p?["viewer"]?["following"]?.isTruthy ?? false)
      let followsYou = rel.followsYou || (p?["viewer"]?["followedBy"]?.isTruthy ?? false)
      let vouches = Score.knownFollowersOf(p) ?? 0
      let createdAt = p?["createdAt"].flatMap { $0.isNull ? nil : $0.jsString } ?? ""
      let created = JSDate.parse(createdAt, timeZone: zone)
      let ageDays: Double? =
        created.isFinite ? JSMath.max(0, ((nowMs - created) / Score.dayMs).jsRounded) : nil
      let followers = Self.count(p?["followersCount"])
      let posts = Self.count(p?["postsCount"])

      // A follow counts the moment it is made, from either source, and the
      // owner and Virga's own accounts are never offered at all.
      let listedReason = protectedSet[did].flatMap { $0.isEmpty ? nil : $0 }
      let protectedReason =
        listedReason
        ?? (youFollow ? "you follow them" : nil)
        ?? (did == ownerDid ? "your own account" : nil)
        ?? (selfSet.contains(did) ? "one of Virga’s accounts" : nil)

      var postsPerDay: Double?
      if let ageDays, ageDays != 0, ageDays > 1, posts != 0, !posts.isNaN {
        postsPerDay = JSNumber.toNumber((posts / ageDays).jsToFixed(2))
      }
      let features = Features(
        vouches: vouches,
        followers: followers,
        follows: Self.count(p?["followsCount"]),
        posts: posts,
        ageDays: ageDays,
        postsPerDay: postsPerDay,
        mutual: youFollow && followsYou,
        followsYou: followsYou,
        youFollow: youFollow,
        protectedReason: protectedReason)
      let trust = protectedReason != nil ? 100 : Score.trustScore(features)
      scores[did] = AccountScore(
        did: did,
        handle: p?["handle"]?.stringValue,
        displayName: p?["displayName"]?.stringValue,
        avatar: p?["avatar"]?.stringValue,
        missing: p == nil,
        band: Score.assignBand(features, t),
        trust: trust.isFinite ? Int(trust) : 0,
        alreadyListed: alreadyListed.contains(did),
        blocksYou: blockers.contains(did) || (p?["viewer"]?["blockedBy"]?.isTruthy ?? false),
        features: features)
    }
    return ScoreResult(scores: scores, vouchCheck: vouchCheck)
  }

  /// `p?.followersCount ?? 0` for the counts the AppView gives: a number,
  /// or 0 where it gave none. (A count that isn't a number reads as 0 here.)
  static func count(_ value: JSONValue?) -> Double {
    value?.doubleValue ?? 0
  }
}
