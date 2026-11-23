// Ports src/lib/syncProgress.js
//
// The sync bar, as arithmetic. The sweeps report facts (rows read, how far
// back a walk has reached, which stage is under way) and this turns them
// into how much of each STEP is done: one segment per step, each filled by
// its own measurement, nil where there is nothing honest to measure by, and
// every share held under 1 until the step itself finishes.

import Foundation
import VirgaCore
import VirgaRepo

/// A sync step's segment label and status line.
public struct SyncStepInfo: Codable, Hashable, Sendable {
  public var label: String
  public var doing: String
}

/// One `sweepBlocks` progress report (`{ stage, fetched, done, total }`).
public struct BlocksProgress: Codable, Hashable, Sendable {
  /// "direct", "lists", "check" or "subscribers".
  public var stage: String
  public var fetched: Int
  public var done: Int
  public var total: Int?

  public init(stage: String, fetched: Int, done: Int, total: Int? = nil) {
    self.stage = stage
    self.fetched = fetched
    self.done = done
    self.total = total
  }
}

public enum SyncProgress {
  /// The highest a step's share may read before the step says it is done.
  static let ceiling = 0.99

  /// Every step a sync can take, in order: the segment's label and the
  /// status line while it runs.
  public static let syncSteps: [(key: String, info: SyncStepInfo)] = [
    ("followers", SyncStepInfo(label: "Followers", doing: "Sweeping followers")),
    ("following", SyncStepInfo(label: "Follows", doing: "Reading who you follow")),
    ("blocks", SyncStepInfo(label: "Blocks", doing: "Reading direct and list blocks")),
    ("repo", SyncStepInfo(label: "Repo", doing: "Downloading the repo")),
    ("posts", SyncStepInfo(label: "Posts", doing: "Archiving posts")),
    ("inbound", SyncStepInfo(label: "Notifications", doing: "Reading notifications")),
    ("outbound", SyncStepInfo(label: "Likes", doing: "Reading likes & reposts")),
  ]

  /// `SYNC_STEPS[key]`.
  public static func syncStep(_ key: String) -> SyncStepInfo? {
    syncSteps.first { $0.key.jsEquals(key) }?.info
  }

  /// The steps every sync plans for; `outbound` joins only when the repo fails.
  public static let syncPlan = ["followers", "following", "blocks", "repo", "posts", "inbound"]

  static func clamp01(_ v: Double) -> Double {
    ChartFormat.jsMin(ceiling, ChartFormat.jsMax(0, v))
  }

  /// `done` of `total` as a share, or nil with no total to measure by.
  public static func share(_ done: Double?, _ total: Double?) -> Double? {
    guard let done, let total, done.isFinite, total.isFinite, total > 0 else { return nil }
    return clamp01(done / total)
  }

  /// `share` for counts.
  public static func share(_ done: Int?, _ total: Int?) -> Double? {
    share(done.map(Double.init), total.map(Double.init))
  }

  /// Where a share sits inside a span: `[from, to]` scaled by `inner` (nil read as 0).
  static func within(_ span: (Double, Double), _ inner: Double?) -> Double {
    clamp01(span.0 + (span.1 - span.0) * (inner ?? 0))
  }

  // MARK: - Blocks

  /// The blocks sweep's four stages, as spans of its segment.
  public static let blockStages: [(key: String, span: (Double, Double))] = [
    ("direct", (0, 0.05)),
    ("lists", (0.05, 0.08)),
    ("check", (0.08, 0.2)),
    ("subscribers", (0.2, 1)),
  ]

  static func span(_ table: [(key: String, span: (Double, Double))], _ key: String?) -> (Double, Double)? {
    guard let key else { return nil }
    return table.first { $0.key.jsEquals(key) }?.span
  }

  /// The blocks step's share from one sweepBlocks report. `directEstimate`
  /// is the direct-block count the last sync found.
  public static func blocksFraction(_ p: BlocksProgress?, directEstimate: Int? = nil) -> Double? {
    guard let p, let span = span(blockStages, p.stage) else { return nil }
    if p.stage == "direct" { return within(span, share(p.done, directEstimate)) }
    if p.stage == "lists" { return within(span, 0) }
    if p.total == 0 { return within(span, 1) }
    return within(span, share(p.done, p.total))
  }

  // MARK: - Repo

  /// The repo step: a download, a parse, then the write.
  public static let repoSpans: [(key: String, span: (Double, Double))] = [
    ("download", (0, 0.4)),
    ("read", (0.4, 0.5)),
    ("save", (0.5, 1)),
  ]

  /// The parse's own stages (readRepoCar), as spans of the parse.
  public static let repoReadStages: [(key: String, span: (Double, Double))] = [
    ("index", (0, 0.25)),
    ("walk", (0.25, 0.45)),
    ("decode", (0.45, 1)),
  ]

  /// The repo step's share while downloading (nil with no size to go by).
  public static func repoDownloadFraction(_ bytes: Double?, _ totalBytes: Double?) -> Double? {
    guard let s = share(bytes, totalBytes) else { return nil }
    return within(span(repoSpans, "download")!, s)
  }

  /// The repo step's share while parsing, from one readRepoCar report.
  public static func repoReadFraction(_ p: RepoCarReadProgress?, expectedRecords: Int? = nil) -> Double? {
    guard let p, let stage = span(repoReadStages, p.stage.rawValue) else { return nil }
    let inner = p.stage == .walk ? share(p.done, expectedRecords) : share(p.done, p.total)
    return within(span(repoSpans, "read")!, within(stage, inner))
  }

  /// The repo step's share while writing rows into the archive.
  public static func repoSaveFraction(_ written: Int, _ total: Int) -> Double {
    if total == 0 { return within(span(repoSpans, "save")!, 1) }
    return within(span(repoSpans, "save")!, share(written, total))
  }

  // MARK: - Newest-first walks

  /// How many of the ascending `times` are at or after `ms`.
  public static func countAtOrAfter(_ timesAsc: [Double], _ ms: Double) -> Int {
    var lo = 0
    var hi = timesAsc.count
    while lo < hi {
      let mid = (lo + hi) >> 1
      if timesAsc[mid] < ms { lo = mid + 1 } else { hi = mid }
    }
    return timesAsc.count - lo
  }

  /// A newest-first walk measured against dates the archive holds: items
  /// newer than where it has reached over items newer than where it has to
  /// reach. Nil when nothing held lies in the range.
  public static func walkFraction(_ timesAsc: [Double], _ reachedMs: Double?, _ targetMs: Double) -> Double? {
    let want = countAtOrAfter(timesAsc, targetMs)
    if want == 0 { return nil }
    guard let reachedMs else { return 0 }
    return share(countAtOrAfter(timesAsc, reachedMs), want)
  }

  /// A newest-first walk measured by time alone: how far back from
  /// `startMs` it has reached, over how far it has to go.
  public static func timeFraction(_ startMs: Double?, _ reachedMs: Double?, _ targetMs: Double?) -> Double? {
    guard let startMs, let targetMs, startMs.isFinite, targetMs.isFinite, !(startMs <= targetMs) else { return nil }
    guard let reachedMs else { return 0 }
    return share(startMs - reachedMs, startMs - targetMs)
  }

  /// The likes-and-reposts fallback: two collections, each half the step.
  public static func partsFraction(_ part: Double?, _ parts: Double?, _ inner: Double?) -> Double? {
    guard let part, let parts, part.isFinite, parts.isFinite, parts > 0 else { return nil }
    return clamp01((part + (inner ?? 0)) / parts)
  }
}
