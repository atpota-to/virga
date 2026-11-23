// Ports src/defense/score.js
//
// How close an account is to you, so a block list can't take your own
// people. This answers "what am I about to do, and who will notice", not
// "does this person deserve it": it measures social proximity, a proxy for
// blast radius, not for harm.
//
// The bands rest on one number, how many of the people you follow also
// follow this account (a "vouch" each), read live from the AppView's
// `viewer.knownFollowers` with the owner's own session. The AppView leaves
// that count off a whole batch when its lookup runs out of time, so every
// batch carries a canary, an account you follow known to have a count: if
// the canary comes back without it, nobody in the batch was counted, and the
// batch is asked again (score.js's header and docs/DEFENSE.md say why).
//
// Here: the bands and their thresholds, the trust key, reading a count, the
// canary's pick and its checks (`findCanary`), the scorer (Score+Scorer.swift)
// and the summary. Every read is injected: `getProfiles` (the owner's signed-
// in `app.bsky.actor.getProfiles`, as `[JSONValue]` profiles, read loosely as
// the web reads them) and `getRelationships` (the public
// `app.bsky.graph.getRelationships`), which defaults to score.js's own
// `publicRelationships` (Score+Relationships.swift), the one read it makes
// itself.

import Foundation
import VirgaCore

/// The owner's signed-in `getProfiles` for up to 25 DIDs: the profiles as the
/// AppView answered (`res.data.profiles`). Cancellation is the web's signal.
public typealias GetProfiles = @Sendable (_ dids: [String]) async throws -> [JSONValue]

/// The public `getRelationships` for the owner and up to 30 others: the
/// `relationships` list as answered.
public typealias GetRelationships = @Sendable (_ ownerDid: String, _ dids: [String]) async throws -> [JSONValue]

public enum Score {
  /// `getRelationships` takes at most 30 `others` per call.
  public static let relBatch = 30

  /// `getProfiles` takes at most 25 actors per call; one place is the canary's.
  public static let profileBatch = 25

  /// BANDS, nearest first.
  public static let bands: [Band] = Band.allCases

  /// DEFAULT_THRESHOLDS: nearly frictionless on strangers, hard to get past
  /// for people near you.
  public static let defaultThresholds = Thresholds()

  /// RETRY_DELAYS_MS: the pauses before asking again, two more tries after the first.
  public static let retryDelaysMs: [Double] = [1000, 3000]

  /// CANARY_BATCHES: how many batches of your follows `findCanary` reads before giving up.
  public static let canaryBatches = 4

  /// The days a millisecond count is, as score.js divides.
  static let dayMs: Double = 86_400_000

  static func clamp(_ n: Double, _ lo: Double, _ hi: Double) -> Double {
    JSMath.max(lo, JSMath.min(hi, n))
  }

  /// A 0 to 99 sorting key. Higher means more embedded in your world. It
  /// orders a review list; the band does the gating. `ageDays` is read as
  /// `Number(ageDays) || 0`. The JavaScript number exactly, NaN included
  /// (a negative count makes one).
  public static func trustScore(
    vouches: Double = 0,
    followers: Double = 0,
    ageDays: Double? = 0,
    mutual: Bool = false,
    followsYou: Bool = false
  ) -> Double {
    let vouchTerm = 55 * JSMath.min(1, log1p(vouches) / log1p(12))
    let reachTerm = 25 * JSMath.min(1, log10(1 + followers) / 5)
    let age = ageDays ?? 0
    let tenureTerm = 10 * clamp((age.isNaN ? 0 : age) / 365, 0, 1)
    let tieTerm: Double = mutual ? 10 : followsYou ? 5 : 0
    return clamp((vouchTerm + reachTerm + tenureTerm + tieTerm).jsRounded, 0, 99)
  }

  /// `trustScore(features)`.
  public static func trustScore(_ f: Features) -> Double {
    trustScore(vouches: f.vouches, followers: f.followers, ageDays: f.ageDays, mutual: f.mutual, followsYou: f.followsYou)
  }

  /// Assign a band. Vetoes win over everything: `protectedReason` being set
  /// is the whole of PROTECTED, so there is one place to look when asking
  /// why someone was spared.
  public static func assignBand(_ f: Features, _ t: Thresholds = defaultThresholds) -> Band {
    if let reason = f.protectedReason, !reason.isEmpty { return .protected }
    let vouches = f.vouches.isNaN ? 0 : f.vouches
    let followers = f.followers.isNaN ? 0 : f.followers
    if t.followsYouConnects && f.followsYou { return .connected }
    if vouches >= t.connectedVouches || (vouches >= t.connectedVouchesWithReach && followers >= t.connectedReach) {
      return .connected
    }
    if vouches >= 1 { return .peripheral }
    if t.followsYouPeripheral && f.followsYou { return .peripheral }
    let postsPerDay = f.postsPerDay.flatMap { $0.isNaN ? nil : $0 } ?? 0
    if followers >= t.notableReach || (postsPerDay >= t.notableActivityPostsPerDay && followers >= t.notableActivityReach) {
      return .notable
    }
    return .unknown
  }

  /// The known-followers count on a profile, or nil when the AppView left it
  /// off. Nil is not zero: it means "no one you follow follows them" OR "the
  /// lookup ran out of time", and only a canary tells the two apart.
  public static func knownFollowersOf(_ profile: JSONValue?) -> Double? {
    guard let known = profile?["viewer"]?["knownFollowers"], known.isTruthy else { return nil }
    let count = known["count"].jsNumber
    if count.isFinite && count > 0 { return count }
    if let followers = known["followers"]?.arrayValue, !followers.isEmpty { return Double(followers.count) }
    return nil
  }

  /// Whether a failed read is worth asking again: not a stop, and either no
  /// answer at all or a 408, a 429 or a 5xx.
  public static func retryable(_ error: any Error) -> Bool {
    if error is CancellationError { return false }
    guard let status = (error as? any HTTPStatusError)?.httpStatus, status != 0 else { return true }
    return status == 408 || status == 429 || status >= 500
  }

  /// `read()` again after each pause in `delays` while it throws something
  /// worth retrying. A failed request is not an empty answer: read as one, a
  /// rate limit would turn every account in the batch into a stranger.
  static func withRetries<T: Sendable>(
    delays: [Double],
    what: String,
    _ read: () async throws -> T
  ) async throws -> T {
    var attempt = 0
    while true {
      try Task.checkCancellation()
      do {
        return try await read()
      } catch {
        if Task.isCancelled { throw error is CancellationError ? error : CancellationError() }
        if !retryable(error) || attempt >= delays.count {
          throw ScoreError(
            "Couldn't read \(what) from Bluesky, so nothing was scored. Try again in a minute.", code: .read, cause: error)
        }
        await Limit.pause(delays[attempt])
      }
      attempt += 1
    }
  }

  /// An account you follow whose known-followers count the AppView reports,
  /// to ride along in every batch as the canary. `candidates` are accounts
  /// you follow, best first. Nil when none of the first `maxBatches` batches
  /// has one: you follow no one, or no two of your follows follow each
  /// other, or the lookup is down.
  public static func findCanary(
    ownerDid: String,
    candidates: [String]?,
    getProfiles: GetProfiles,
    maxBatches: Int = canaryBatches,
    retryDelaysMs: [Double] = retryDelaysMs
  ) async throws -> String? {
    let pool = (candidates ?? []).jsUnique().filter { !$0.isEmpty && !$0.jsEquals(ownerDid) }
    for batch in Limit.chunks(pool, profileBatch).jsSlice(0, maxBatches) {
      let found = try await withRetries(delays: retryDelaysMs, what: "who you know in common") {
        try await getProfiles(batch)
      }
      var best: (did: String, n: Double)?
      for p in found {
        guard let n = knownFollowersOf(p), n != 0, let did = p["did"]?.stringValue, !did.isEmpty else { continue }
        if best == nil || n > best!.n { best = (did, n) }
      }
      if let best { return best.did }
    }
    return nil
  }

  /// Build a scorer for one owner (Score+Scorer.swift). Throws when there is
  /// no owner, as the web's does. `getRelationships` defaults to
  /// `publicRelationships()`, as the web's does. `now` is the web's `Date.now()` (an
  /// account's age is counted from it); `timeZone` is the zone a profile's
  /// `createdAt` without an offset is read in (nil: AppLocale's active zone,
  /// the web's local time).
  public static func createScorer(
    ownerDid: String,
    getProfiles: @escaping GetProfiles,
    getRelationships: @escaping GetRelationships = Score.publicRelationships(),
    canary: String? = nil,
    refindCanary: (@Sendable () async throws -> String?)? = nil,
    protectedSet: [String: String] = [:],
    selves: [String] = [],
    alreadyListed: Set<String> = [],
    blockers: Set<String> = [],
    thresholds: Thresholds = defaultThresholds,
    retryDelaysMs: [Double] = retryDelaysMs,
    concurrency: Int = Limit.appviewConcurrency,
    now: @escaping @Sendable () -> Date = { Date() },
    timeZone: TimeZone? = nil
  ) throws -> Scorer {
    guard !ownerDid.isEmpty else { throw CreateScorerError(message: "createScorer needs the owner") }
    return Scorer(
      ownerDid: ownerDid, getProfiles: getProfiles, getRelationships: getRelationships, canary: canary,
      refindCanary: refindCanary, protectedSet: protectedSet, selves: selves, alreadyListed: alreadyListed,
      blockers: blockers, thresholds: thresholds, retryDelaysMs: retryDelaysMs, concurrency: concurrency, now: now,
      timeZone: timeZone)
  }

  /// A harvest without these accounts, its totals counted again without
  /// them. The owner, Virga's accounts and the post's author can all show up
  /// among a post's participants; none of them engaged with it.
  public static func withoutSelves(_ harvest: Harvest, _ dids: [String?]) -> Harvest {
    let skip = Set(dids.compactMap { $0 }.filter { !$0.isEmpty })
    let participants = harvest.participants.filter { !skip.contains($0.did) }
    var engagements: [String: Int] = [:]
    for p in participants {
      for (k, n) in p.engagements { engagements[k, default: 0] += n }
    }
    var out = harvest
    out.participants = participants
    out.totals.participants = participants.count
    out.totals.engagements = engagements
    return out
  }

  /// Join a harvest to scores and summarise it. `requiresReview` is
  /// everything that is not UNKNOWN: the list a person is expected to read.
  /// Only a scan whose vouches were counted can say who has no connection,
  /// so `autoEligible` is empty without the canary.
  public static func summarise(
    _ harvest: Harvest,
    _ scores: [String: AccountScore],
    vouchCheck: VouchCheck = .canary
  ) -> ScanSummary {
    let rows = harvest.participants.map { ScanRow(participant: $0, score: scores[$0.did]) }
    var byBand = Dictionary(uniqueKeysWithValues: bands.map { ($0, 0) })
    for r in rows { byBand[r.band, default: 0] += 1 }
    let requiresReview = rows.filter { $0.band != .unknown }
      .jsSorted { a, b in Double(b.trust ?? 0) - Double(a.trust ?? 0) }
    let reviewReach = requiresReview.reduce(0.0) { n, r in
      let followers = r.followers ?? 0
      return n + (followers.isNaN ? 0 : followers)
    }
    let totals = SummaryTotals(
      participants: rows.count,
      engagements: harvest.totals.engagements,
      records: harvest.totals.records,
      byBand: byBand,
      reviewReach: reviewReach,
      alreadyListed: rows.filter(\.alreadyListed).count,
      blocksYou: rows.filter(\.blocksYou).count)
    return ScanSummary(
      uri: harvest.uri,
      harvestedAt: harvest.harvestedAt,
      truncated: harvest.truncated,
      unread: harvest.unread ?? [],
      vouchCheck: vouchCheck,
      totals: totals,
      rows: rows,
      requiresReview: requiresReview,
      autoEligible: vouchCheck == .canary ? rows.filter { $0.band == .unknown } : [])
  }
}

/// `createScorer` with no owner.
public struct CreateScorerError: Error, LocalizedError, Sendable {
  public var message: String
  public var errorDescription: String? { message }
}
