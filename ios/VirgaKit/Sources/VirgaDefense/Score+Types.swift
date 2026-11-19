// Ports src/defense/score.js: the shapes it works in.
//
// A band, the thresholds that draw them, the features one account is banded
// by, the score `createScorer` gives each account, and the summary
// `summarise` makes of a harvest and its scores. Field names are the web's,
// so each encodes to the JSON score.js builds (ios/parity/cases/
// defense-early.score.js holds them to it).

import Foundation
import VirgaCore

/// How close an account is to the owner (docs/DEFENSE.md, the table).
/// `allCases` is score.js's BANDS, nearest first.
public enum Band: String, Codable, Hashable, Sendable, CaseIterable, CodingKeyRepresentable {
  case protected = "PROTECTED"
  case connected = "CONNECTED"
  case peripheral = "PERIPHERAL"
  case notable = "NOTABLE"
  case unknown = "UNKNOWN"

  /// The band a string names, compared code unit by code unit as the web's
  /// `BANDS.includes(t)` does. (`Band(rawValue:)` compares as Swift does, by
  /// canonical equivalence, so "UN\u{212A}NOWN", with a Kelvin sign, would
  /// read as UNKNOWN; to the web it is no band.)
  public static func named(_ text: String) -> Band? {
    allCases.first { $0.rawValue.jsEquals(text) }
  }
}

/// Whether a score's vouches were checked against a canary.
public enum VouchCheck: String, Codable, Hashable, Sendable {
  case canary
  case unavailable
}

/// score.js's DEFAULT_THRESHOLDS, and the thresholds a scorer is given.
/// Decoding fills what a JSON object leaves out from the defaults, as the
/// web's `{ ...DEFAULT_THRESHOLDS, ...thresholds }` does.
public struct Thresholds: Codable, Hashable, Sendable {
  public var connectedVouches: Double = 3
  public var connectedVouchesWithReach: Double = 1
  public var connectedReach: Double = 5000
  public var notableReach: Double = 10000
  public var notableActivityPostsPerDay: Double = 20
  public var notableActivityReach: Double = 2000
  /// An account that follows you is CONNECTED. Off while vouches can be
  /// checked; on when they can't, so the people closest to you still stand out.
  public var followsYouConnects: Bool = false
  /// An account that follows you is at least PERIPHERAL, whoever vouches for
  /// it: it would notice being added, and "no connection" would be untrue.
  public var followsYouPeripheral: Bool = true

  public init() {}

  private enum CodingKeys: String, CodingKey {
    case connectedVouches, connectedVouchesWithReach, connectedReach, notableReach
    case notableActivityPostsPerDay, notableActivityReach, followsYouConnects, followsYouPeripheral
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let d = Thresholds()
    connectedVouches = try c.decodeIfPresent(Double.self, forKey: .connectedVouches) ?? d.connectedVouches
    connectedVouchesWithReach =
      try c.decodeIfPresent(Double.self, forKey: .connectedVouchesWithReach) ?? d.connectedVouchesWithReach
    connectedReach = try c.decodeIfPresent(Double.self, forKey: .connectedReach) ?? d.connectedReach
    notableReach = try c.decodeIfPresent(Double.self, forKey: .notableReach) ?? d.notableReach
    notableActivityPostsPerDay =
      try c.decodeIfPresent(Double.self, forKey: .notableActivityPostsPerDay) ?? d.notableActivityPostsPerDay
    notableActivityReach = try c.decodeIfPresent(Double.self, forKey: .notableActivityReach) ?? d.notableActivityReach
    followsYouConnects = try c.decodeIfPresent(Bool.self, forKey: .followsYouConnects) ?? d.followsYouConnects
    followsYouPeripheral = try c.decodeIfPresent(Bool.self, forKey: .followsYouPeripheral) ?? d.followsYouPeripheral
  }
}

/// What one account is banded by: score.js's `features`. Counts are doubles,
/// as JavaScript's numbers are. Decoding is lenient, as `assignBand` reads
/// a partial object (`f.vouches || 0`): what is missing or null is 0, false
/// or nil.
public struct Features: Codable, Hashable, Sendable {
  /// How many of the people you follow follow them.
  public var vouches: Double
  public var followers: Double
  public var follows: Double
  public var posts: Double
  /// Days since the account was made; nil when the profile didn't say.
  public var ageDays: Double?
  public var postsPerDay: Double?
  public var mutual: Bool
  public var followsYou: Bool
  public var youFollow: Bool
  /// Why the account is PROTECTED, or nil. Set is the whole of PROTECTED.
  public var protectedReason: String?

  public init(
    vouches: Double = 0,
    followers: Double = 0,
    follows: Double = 0,
    posts: Double = 0,
    ageDays: Double? = nil,
    postsPerDay: Double? = nil,
    mutual: Bool = false,
    followsYou: Bool = false,
    youFollow: Bool = false,
    protectedReason: String? = nil
  ) {
    self.vouches = vouches
    self.followers = followers
    self.follows = follows
    self.posts = posts
    self.ageDays = ageDays
    self.postsPerDay = postsPerDay
    self.mutual = mutual
    self.followsYou = followsYou
    self.youFollow = youFollow
    self.protectedReason = protectedReason
  }

  private enum CodingKeys: String, CodingKey {
    case vouches, followers, follows, posts, ageDays, postsPerDay, mutual, followsYou, youFollow, protectedReason
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    vouches = try c.decodeIfPresent(Double.self, forKey: .vouches) ?? 0
    followers = try c.decodeIfPresent(Double.self, forKey: .followers) ?? 0
    follows = try c.decodeIfPresent(Double.self, forKey: .follows) ?? 0
    posts = try c.decodeIfPresent(Double.self, forKey: .posts) ?? 0
    ageDays = try c.decodeIfPresent(Double.self, forKey: .ageDays)
    postsPerDay = try c.decodeIfPresent(Double.self, forKey: .postsPerDay)
    mutual = try c.decodeIfPresent(Bool.self, forKey: .mutual) ?? false
    followsYou = try c.decodeIfPresent(Bool.self, forKey: .followsYou) ?? false
    youFollow = try c.decodeIfPresent(Bool.self, forKey: .youFollow) ?? false
    protectedReason = try c.decodeIfPresent(String.self, forKey: .protectedReason)
  }
}

/// One account as `createScorer`'s `score` gives it: who they are (as the
/// AppView said, or nil when it said nothing), their band and trust key, and
/// every feature they were banded by.
public struct AccountScore: Codable, Hashable, Sendable {
  public var did: String
  public var handle: String?
  public var displayName: String?
  public var avatar: String?
  /// The AppView gave no profile for them.
  public var missing: Bool
  public var band: Band
  /// The 0 to 99 sorting key; 100 for PROTECTED.
  public var trust: Int
  public var alreadyListed: Bool
  public var blocksYou: Bool
  public var vouches: Double
  public var followers: Double
  public var follows: Double
  public var posts: Double
  public var ageDays: Double?
  public var postsPerDay: Double?
  public var mutual: Bool
  public var followsYou: Bool
  public var youFollow: Bool
  public var protectedReason: String?

  public init(
    did: String,
    handle: String? = nil,
    displayName: String? = nil,
    avatar: String? = nil,
    missing: Bool = false,
    band: Band,
    trust: Int,
    alreadyListed: Bool = false,
    blocksYou: Bool = false,
    features: Features
  ) {
    self.did = did
    self.handle = handle
    self.displayName = displayName
    self.avatar = avatar
    self.missing = missing
    self.band = band
    self.trust = trust
    self.alreadyListed = alreadyListed
    self.blocksYou = blocksYou
    vouches = features.vouches
    followers = features.followers
    follows = features.follows
    posts = features.posts
    ageDays = features.ageDays
    postsPerDay = features.postsPerDay
    mutual = features.mutual
    followsYou = features.followsYou
    youFollow = features.youFollow
    protectedReason = features.protectedReason
  }

  /// The features the band and trust key were worked out from.
  public var features: Features {
    Features(
      vouches: vouches, followers: followers, follows: follows, posts: posts, ageDays: ageDays,
      postsPerDay: postsPerDay, mutual: mutual, followsYou: followsYou, youFollow: youFollow,
      protectedReason: protectedReason)
  }
}

/// What `score` resolves to: every account's score by DID, and whether the
/// vouches were checked.
public struct ScoreResult: Codable, Hashable, Sendable {
  public var scores: [String: AccountScore]
  public var vouchCheck: VouchCheck

  public init(scores: [String: AccountScore], vouchCheck: VouchCheck) {
    self.scores = scores
    self.vouchCheck = vouchCheck
  }
}

/// A row of a scan: a participant of the harvest joined to its score, as
/// summarise's `{ ...p, ...score }`. Encodes flat, as the web's object is;
/// an account that wasn't scored has only `band: 'UNKNOWN'` from the score.
public struct ScanRow: Codable, Hashable, Sendable {
  public var participant: Participant
  /// nil when nobody scored the account: its band is then UNKNOWN.
  public var score: AccountScore?

  public init(participant: Participant, score: AccountScore?) {
    self.participant = participant
    self.score = score
  }

  public var did: String { score?.did ?? participant.did }
  public var band: Band { score?.band ?? .unknown }
  /// `row.trust`: nil (the web's undefined) for an account nobody scored.
  public var trust: Int? { score?.trust }
  public var youFollow: Bool { score?.youFollow ?? false }
  public var followsYou: Bool { score?.followsYou ?? false }
  public var alreadyListed: Bool { score?.alreadyListed ?? false }
  public var blocksYou: Bool { score?.blocksYou ?? false }
  public var followers: Double? { score?.followers }
  public var handle: String? { score?.handle }
  public var displayName: String? { score?.displayName }
  public var avatar: String? { score?.avatar }
  /// The row's loudest engagement (harvest.js KIND_ORDER).
  public var primary: String? { participant.primary }

  private enum ScoreKey: String, CodingKey { case band, trust, missing }

  public init(from decoder: Decoder) throws {
    participant = try Participant(from: decoder)
    let c = try decoder.container(keyedBy: ScoreKey.self)
    // A scored row always has its trust key and `missing`; an unscored one
    // has only the band, which is UNKNOWN.
    if c.contains(.trust) || c.contains(.missing) {
      score = try AccountScore(from: decoder)
    } else {
      score = nil
      let band = try c.decodeIfPresent(Band.self, forKey: .band) ?? .unknown
      if band != .unknown {
        throw DecodingError.dataCorruptedError(
          forKey: .band, in: c, debugDescription: "An unscored row's band is UNKNOWN")
      }
    }
  }

  public func encode(to encoder: Encoder) throws {
    try participant.encode(to: encoder)
    if let score {
      try score.encode(to: encoder)
    } else {
      var c = encoder.container(keyedBy: ScoreKey.self)
      try c.encode(Band.unknown, forKey: .band)
    }
  }
}

/// A summary's totals: the harvest's, counted again over the rows, with the
/// bands, the reach of the people to review, and how many are listed already
/// or block the owner.
public struct SummaryTotals: Codable, Hashable, Sendable {
  public var participants: Int
  public var engagements: [String: Int]
  public var records: Int?
  public var byBand: [Band: Int]
  public var reviewReach: Double
  public var alreadyListed: Int
  public var blocksYou: Int

  public init(
    participants: Int,
    engagements: [String: Int],
    records: Int? = nil,
    byBand: [Band: Int],
    reviewReach: Double,
    alreadyListed: Int,
    blocksYou: Int
  ) {
    self.participants = participants
    self.engagements = engagements
    self.records = records
    self.byBand = byBand
    self.reviewReach = reviewReach
    self.alreadyListed = alreadyListed
    self.blocksYou = blocksYou
  }
}

/// What `summarise` makes of a harvest and its scores.
public struct ScanSummary: Codable, Hashable, Sendable {
  public var uri: String
  public var harvestedAt: String?
  public var truncated: Bool
  public var unread: [UnreadKind]
  public var vouchCheck: VouchCheck
  public var totals: SummaryTotals
  public var rows: [ScanRow]
  /// Everyone but UNKNOWN, highest trust first: the list a person reads.
  public var requiresReview: [ScanRow]
  /// The UNKNOWN rows, and only when vouches were counted.
  public var autoEligible: [ScanRow]

  public init(
    uri: String,
    harvestedAt: String?,
    truncated: Bool,
    unread: [UnreadKind],
    vouchCheck: VouchCheck,
    totals: SummaryTotals,
    rows: [ScanRow],
    requiresReview: [ScanRow],
    autoEligible: [ScanRow]
  ) {
    self.uri = uri
    self.harvestedAt = harvestedAt
    self.truncated = truncated
    self.unread = unread
    self.vouchCheck = vouchCheck
    self.totals = totals
    self.rows = rows
    self.requiresReview = requiresReview
    self.autoEligible = autoEligible
  }
}

/// score.js's ScoreError: nothing was scored, and why. `message` is the
/// sentence the page shows.
public struct ScoreError: Error, LocalizedError, CustomStringConvertible, Sendable {
  public enum Code: String, Codable, Sendable {
    /// A read failed (after its retries, or outright).
    case read
    /// The canary never came back counted.
    case vouches
  }

  public var code: Code
  public var message: String
  public var cause: (any Error)?

  public init(_ message: String, code: Code, cause: (any Error)? = nil) {
    self.message = message
    self.code = code
    self.cause = cause
  }

  public var errorDescription: String? { message }
  public var description: String { message }
}

/// A failed read that says what HTTP status it got, if any (score.js reads
/// `err.status`). VirgaNetwork's errors conform to it in wave 2; an error
/// that doesn't is read as no answer at all, which is worth asking again.
public protocol HTTPStatusError: Error {
  /// The HTTP status, or nil (or 0) when there was no answer.
  var httpStatus: Int? { get }
}
