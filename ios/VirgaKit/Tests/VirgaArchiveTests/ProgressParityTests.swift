// Parity with src/lib/syncProgress.js, src/lib/followerLog.js and
// src/archive/postChanges.js (fixture archive.progress).

import Foundation
import Testing
import VirgaCore
import VirgaRepo
import VirgaTestSupport
@testable import VirgaArchive

/// A number the web code sees as a number: a JSON number or a marker; any
/// other value (null, a string) is nil, which `Number.isFinite` refuses.
private func measured(_ value: JSONValue?) -> Double? {
  switch value {
  case .some(.number(let n)): return n
  case .some(.string(let s)) where s.hasPrefix("$"): return num(value)
  default: return nil
  }
}

private func spans(_ table: [(key: String, span: (Double, Double))]) -> JSONValue {
  .object(Dictionary(uniqueKeysWithValues: table.map { ($0.key, JSONValue.array([.number($0.span.0), .number($0.span.1)])) }))
}

@Suite struct SyncProgressParity {
  @Test func constants() throws {
    try forEachCase("archive.progress", "constants") { _ in
      [
        "SYNC_STEPS": .object(
          Dictionary(uniqueKeysWithValues: SyncProgress.syncSteps.map { ($0.key, encoded($0.info)) })),
        "SYNC_PLAN": .array(SyncProgress.syncPlan.map(JSONValue.string)),
        "BLOCK_STAGES": spans(SyncProgress.blockStages),
        "REPO_SPANS": spans(SyncProgress.repoSpans),
        "REPO_READ_STAGES": spans(SyncProgress.repoReadStages),
        "FOLLOWER_LOG_LIMIT": .number(Double(FollowerLog.followerLogLimit)),
      ]
    }
  }

  @Test func share() throws {
    try forEachCase("archive.progress", "share") { c in
      js(SyncProgress.share(measured(c.input["done"]), measured(c.input["total"])))
    }
  }

  @Test func blocksFraction() throws {
    try forEachCase("archive.progress", "blocksFraction") { c in
      let p = c["p"]
      let report: BlocksProgress? =
        p.isNull
        ? nil
        : BlocksProgress(
          stage: p["stage"]?.stringValue ?? "", fetched: p["fetched"]?.intValue ?? 0, done: p["done"]?.intValue ?? 0,
          total: p["total"]?.intValue)
      return js(SyncProgress.blocksFraction(report, directEstimate: c["directEstimate"].intValue))
    }
  }

  @Test func repoDownloadFraction() throws {
    try forEachCase("archive.progress", "repoDownloadFraction") { c in
      js(SyncProgress.repoDownloadFraction(measured(c.input["bytes"]), measured(c.input["total"])))
    }
  }

  @Test func repoReadFraction() throws {
    try forEachCase("archive.progress", "repoReadFraction") { c in
      let p = c["p"]
      guard let stage = p["stage"]?.stringValue.flatMap(RepoCarReadProgress.Stage.init(rawValue:)) else { return .null }
      let report = RepoCarReadProgress(stage: stage, done: p["done"]?.intValue ?? 0, total: p["total"]?.intValue)
      return js(SyncProgress.repoReadFraction(report, expectedRecords: c["expectedRecords"].intValue))
    }
  }

  @Test func repoSaveFraction() throws {
    try forEachCase("archive.progress", "repoSaveFraction") { c in
      js(SyncProgress.repoSaveFraction(c["written"].intValue ?? 0, c["total"].intValue ?? 0))
    }
  }

  @Test func countAtOrAfter() throws {
    try forEachCase("archive.progress", "countAtOrAfter") { c in
      .number(Double(SyncProgress.countAtOrAfter((c["times"].arrayValue ?? []).map { num($0) }, c.number("ms"))))
    }
  }

  @Test func walkFraction() throws {
    try forEachCase("archive.progress", "walkFraction") { c in
      js(SyncProgress.walkFraction((c["times"].arrayValue ?? []).map { num($0) }, c.optionalNumber("reached"), c.number("target")))
    }
  }

  @Test func timeFraction() throws {
    try forEachCase("archive.progress", "timeFraction") { c in
      js(SyncProgress.timeFraction(c.optionalNumber("start"), c.optionalNumber("reached"), c.optionalNumber("target")))
    }
  }

  @Test func partsFraction() throws {
    try forEachCase("archive.progress", "partsFraction") { c in
      js(SyncProgress.partsFraction(c.optionalNumber("part"), c.optionalNumber("parts"), c.optionalNumber("inner")))
    }
  }
}

@Suite struct FollowerLogParity {
  @Test func followerChanges() throws {
    try forEachCase("archive.progress", "followerChanges") { c in
      json(
        FollowerLog.followerChanges(
          rows(c["before"]), rows(c["after"]), at: c.optionalNumber("at"), since: c.optionalNumber("since")))
    }
  }

  @Test func mergeFollowerLog() throws {
    for c in try Parity.cases("archive.progress", fn: "mergeFollowerLog") {
      let changes: [FollowerLogEntry]? = rows(c["changes"])
      let actual: JSONValue
      if let count = c["heldCount"].intValue {
        let many = (0..<count).map {
          FollowerLogEntry(
            did: "did:plc:\($0)", handle: nil, displayName: nil, avatar: nil, followedAt: nil, kind: "lost", at: 1, since: nil)
        }
        let log = FollowerLog.mergeFollowerLog(
          FollowerLogRecord(entries: many, lastSyncAt: 1, firstSyncAt: 1), changes, c.optionalNumber("at"))
        actual = [
          "count": .number(Double(log.entries.count)),
          "first": json(Array(log.entries.prefix(3))),
          "last": log.entries.last?.json ?? .null,
          "lastSyncAt": js(log.lastSyncAt),
          "firstSyncAt": js(log.firstSyncAt),
        ]
      } else {
        let held = c.input["held"].flatMap { FollowerLogRecord(json: $0) }
        actual = FollowerLog.mergeFollowerLog(held, changes, c.optionalNumber("at")).json
      }
      let d = exactDiff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }
}

@Suite struct PostChangesParity {
  @Test func isOwnPostUri() throws {
    try forEachCase("archive.progress", "isOwnPostUri") { c in
      .bool(PostChanges.isOwnPostUri(c["did"].stringValue, c["uri"].stringValue))
    }
  }

  @Test func postRowsFor() throws {
    try forEachCase("archive.progress", "postRowsFor") { c in
      let added = c["added"].arrayValue?.map(PostedItem.init(json:))
      return json(PostChanges.postRowsFor("did:plc:owner", added))
    }
  }

  @Test func applyPostChanges() throws {
    try forEachCase("archive.progress", "applyPostChanges") { c in
      let posts: [PostRow]? = rows(c["posts"])
      let next = PostChanges.applyPostChanges(
        posts, rows: rows(c["rows"]) ?? [], removed: (c["removed"].arrayValue ?? []).compactMap(\.stringValue))
      return ["rows": json(next ?? posts ?? []), "same": .bool(next == nil)]
    }
  }
}
