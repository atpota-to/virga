// Ports src/defense/harvest.js: its data shapes.
//
// What `harvestPost` resolves to: everyone who engaged with a post, how, and
// what Constellation left unread. score.js (`withoutSelves`, `summarise`)
// and radar.js read these; the harvest itself is Harvest.swift. Field names
// are the web's, so a harvest encodes to the JSON harvest.js gives.

import Foundation

/// One record that engaged with the post: its kind (harvest.js's
/// `engagementKind`), its record key and collection.
public struct EngagementRecord: Codable, Hashable, Sendable {
  public var kind: String
  public var rkey: String?
  public var collection: String?

  public init(kind: String, rkey: String? = nil, collection: String? = nil) {
    self.kind = kind
    self.rkey = rkey
    self.collection = collection
  }
}

/// One account that engaged: how many times each way, every record, and its
/// loudest kind (`primary`, by KIND_ORDER; nil for none).
public struct Participant: Codable, Hashable, Sendable {
  public var did: String
  public var engagements: [String: Int]
  public var records: [EngagementRecord]
  public var total: Int
  public var primary: String?

  public init(
    did: String,
    engagements: [String: Int] = [:],
    records: [EngagementRecord] = [],
    total: Int = 0,
    primary: String? = nil
  ) {
    self.did = did
    self.engagements = engagements
    self.records = records
    self.total = total
    self.primary = primary
  }
}

/// A Constellation source (constellation.js `flattenSources`) as the harvest
/// read it: its engagement kind, and whether it was cut short or never
/// answered.
public struct HarvestSource: Codable, Hashable, Sendable {
  public var collection: String
  public var path: String
  public var source: String
  public var count: Int
  public var distinctDids: Int?
  public var kind: String
  public var truncated: Bool
  public var failed: Bool

  public init(
    collection: String,
    path: String,
    source: String,
    count: Int,
    distinctDids: Int? = nil,
    kind: String,
    truncated: Bool = false,
    failed: Bool = false
  ) {
    self.collection = collection
    self.path = path
    self.source = source
    self.count = count
    self.distinctDids = distinctDids
    self.kind = kind
    self.truncated = truncated
    self.failed = failed
  }
}

/// The kinds of the sources that never answered, with Constellation's count
/// of their records.
public struct UnreadKind: Codable, Hashable, Sendable {
  public var kind: String
  public var count: Int

  public init(kind: String, count: Int) {
    self.kind = kind
    self.count = count
  }
}

/// A harvest's totals: participants, engagements by kind, and records read.
public struct HarvestTotals: Codable, Hashable, Sendable {
  public var participants: Int
  public var engagements: [String: Int]
  public var records: Int?

  public init(participants: Int, engagements: [String: Int], records: Int? = nil) {
    self.participants = participants
    self.engagements = engagements
    self.records = records
  }
}

/// What harvest.js's `harvestPost` resolves to.
public struct Harvest: Codable, Hashable, Sendable {
  public var uri: String
  public var harvestedAt: String?
  public var sources: [HarvestSource]?
  public var participants: [Participant]
  public var totals: HarvestTotals
  public var truncated: Bool
  public var unread: [UnreadKind]?

  public init(
    uri: String,
    harvestedAt: String? = nil,
    sources: [HarvestSource]? = nil,
    participants: [Participant],
    totals: HarvestTotals,
    truncated: Bool = false,
    unread: [UnreadKind]? = nil
  ) {
    self.uri = uri
    self.harvestedAt = harvestedAt
    self.sources = sources
    self.participants = participants
    self.totals = totals
    self.truncated = truncated
    self.unread = unread
  }
}
