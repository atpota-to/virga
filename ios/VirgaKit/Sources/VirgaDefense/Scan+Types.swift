// Ports src/defense/scan.js: its data shapes.
//
// What `runScan` resolves to (a summary, with the post, the canary and when
// it ran) and the stages it reports, which the scan store keeps and the page
// shows. The scan itself is Scan.swift.

import Foundation

/// The post a scan is of, and its author.
public struct ScanPost: Codable, Hashable, Sendable {
  public var uri: String
  public var authorDid: String

  public init(uri: String, authorDid: String) {
    self.uri = uri
    self.authorDid = authorDid
  }
}

/// What `runScan` resolves to: the summary score.js gives, with the post,
/// the canary and when the scan started and finished (ISO strings). Encodes
/// flat, as the web's `{ ...summary, post, canary, startedAt, finishedAt }`.
public struct ScanResult: Codable, Hashable, Sendable {
  public var summary: ScanSummary
  public var post: ScanPost
  public var canary: String?
  public var startedAt: String
  public var finishedAt: String

  public init(summary: ScanSummary, post: ScanPost, canary: String?, startedAt: String, finishedAt: String) {
    self.summary = summary
    self.post = post
    self.canary = canary
    self.startedAt = startedAt
    self.finishedAt = finishedAt
  }

  private enum CodingKeys: String, CodingKey { case post, canary, startedAt, finishedAt }

  public init(from decoder: Decoder) throws {
    summary = try ScanSummary(from: decoder)
    let c = try decoder.container(keyedBy: CodingKeys.self)
    post = try c.decode(ScanPost.self, forKey: .post)
    canary = try c.decodeIfPresent(String.self, forKey: .canary)
    startedAt = try c.decode(String.self, forKey: .startedAt)
    finishedAt = try c.decode(String.self, forKey: .finishedAt)
  }

  public func encode(to encoder: Encoder) throws {
    try summary.encode(to: encoder)
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(post, forKey: .post)
    try c.encodeIfPresent(canary, forKey: .canary)
    try c.encode(startedAt, forKey: .startedAt)
    try c.encode(finishedAt, forKey: .finishedAt)
  }
}

/// A stage a scan reports as it goes (scan.js STAGES keys: "post",
/// "harvest", "canary", "score"), with how far it is when it can say.
public struct ScanStageReport: Codable, Hashable, Sendable {
  public var stage: String
  public var done: Int?
  public var total: Int?

  public init(stage: String, done: Int? = nil, total: Int? = nil) {
    self.stage = stage
    self.done = done
    self.total = total
  }
}

/// How a running scan hears about its stages: awaited, so the stages land
/// in the store in the order they were reported.
public typealias ScanStageHandler = @Sendable (ScanStageReport) async -> Void
