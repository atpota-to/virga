// Ports src/defense/plan.js
//
// From a scan to a plan: who would be added to a list, by the bands the
// owner ticks, and how long writing them takes.
//
// A plan names DIDs, their band and their trust key, and nothing else: no
// handles, no names, no text anyone else wrote (docs/DEFENSE.md, What's
// stored). PROTECTED is never in one, whatever is ticked, and the server
// refuses a plan that names anyone in it; the veto at the write (veto.js) is
// what finally decides. The pace is the server's (Pace).

import Foundation
import VirgaCore

/// One row of a plan: who, their band, and their trust key (nil when they
/// weren't scored).
public struct PlanRow: Codable, Hashable, Sendable {
  public var did: String
  public var band: Band
  public var trust: Int?

  public init(did: String, band: Band, trust: Int?) {
    self.did = did
    self.band = band
    self.trust = trust
  }
}

/// How long `writes` additions take: their cost against the write limit,
/// and the minutes at the server's pace or that limit, whichever is slower.
public struct WriteEstimate: Codable, Hashable, Sendable {
  public var writes: Int
  public var points: Int
  public var minutes: Int

  public init(writes: Int, points: Int, minutes: Int) {
    self.writes = writes
    self.points = points
    self.minutes = minutes
  }
}

public enum Plan {
  public static let batch = Pace.batch
  public static let batchGapMs = Pace.batchGapMs

  /// APPROVABLE_BANDS: the bands a plan may take, nearest last. PROTECTED is never one of them.
  public static let approvableBands: [Band] = [.unknown, .notable, .peripheral, .connected]

  /// DEFAULT_BANDS: what is ticked to start with, the strangers.
  public static let defaultBands: [Band] = [.unknown]

  /// PLAN_MAX: the most accounts one plan may add. A bigger pile-on is two plans.
  public static let planMax = 10_000

  /// NOTE_MAX: the words the owner may give a plan, at most (UTF-16 code units).
  public static let noteMax = 500

  /// The rows a plan would add: everyone in the ticked bands (never
  /// PROTECTED), not followed, not already on the list (`listed`, DIDs), in
  /// the scan's order.
  public static func planRows(_ summary: ScanSummary?, _ bands: [Band]?, listed: Set<String> = []) -> [PlanRow] {
    let ticked = Set((bands ?? []).filter { approvableBands.contains($0) })
    return (summary?.rows ?? [])
      .filter { r in
        !r.did.isEmpty && ticked.contains(r.band) && r.band != .protected && !r.youFollow && !listed.contains(r.did)
      }
      .map { PlanRow(did: $0.did, band: $0.band, trust: $0.trust) }
  }

  /// How many of the scan each approvable band would add, for the ticks' labels.
  public static func bandCounts(_ summary: ScanSummary?, listed: Set<String> = []) -> [Band: Int] {
    var out = Dictionary(uniqueKeysWithValues: approvableBands.map { ($0, 0) })
    for r in summary?.rows ?? [] where out[r.band] != nil && !r.youFollow && !listed.contains(r.did) {
      out[r.band]! += 1
    }
    return out
  }

  /// How long `n` additions take at the server's pace: the larger of the
  /// pace and the write limit. `n` is read as `Math.floor(n || 0)`, at
  /// least 0.
  public static func estimateWrites(_ n: Double) -> WriteEstimate {
    let floored = (n.isNaN ? 0 : n).rounded(.down)
    // At least 0, and kept to what an Int holds (the web's Infinity has no Int).
    let writes = Swift.min(floored > 0 ? floored : 0, 1e15)
    let points = writes * Double(Pace.pointsPerCreate)
    let batches = (writes / Double(Pace.batch)).rounded(.up)
    let byPace = Swift.max(0, batches - 1) * (Double(Pace.batchGapMs) / 60_000)
    let byPoints = (points / Double(Pace.pointsPerHour)) * 60
    let minutes = Swift.max(byPace, writes != 0 ? byPoints : 0).rounded(.up)
    return WriteEstimate(writes: Int(writes), points: Int(points), minutes: Int(minutes))
  }

  public static func estimateWrites(_ n: Int) -> WriteEstimate {
    estimateWrites(Double(n))
  }

  /// The estimate in words: "about 20 minutes", "about 3.5 hours", "a minute
  /// or two". Minutes are written in `locale` (nil: the active one, as the
  /// web's fmtInt); the hours are `toFixed(1)` in every locale, as on the web.
  public static func estimateWords(_ n: Double, locale: String? = nil) -> String {
    let estimate = estimateWrites(n)
    if estimate.writes == 0 { return "nothing to write" }
    if estimate.minutes < 2 { return "a minute or two" }
    if estimate.minutes < 90 { return "about \(DefenseFormat.fmtInt(Double(estimate.minutes), locale: locale)) minutes" }
    return "about \((Double(estimate.minutes) / 60).jsToFixed(1)) hours"
  }

  public static func estimateWords(_ n: Int, locale: String? = nil) -> String {
    estimateWords(Double(n), locale: locale)
  }

  /// The owner's words, on one line, trimmed and capped at NOTE_MAX, or nil.
  public static func cleanNote(_ text: String?) -> String? {
    let t = text.map { $0.jsCollapsingWhitespace().jsTrimmed() } ?? ""
    return t.isEmpty ? nil : t.jsSlice(0, noteMax)
  }
}
