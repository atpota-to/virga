// Ports src/defense/pageModel.js
//
// The Defense page's words and lists, apart from the views, so the tests can
// pin them: which of your posts to offer for a scan, what each account's
// line says, how far along a scan is, and the scan as rows for an export.
// Numbers are written with locale.js's fmtInt in `locale` (nil: the active
// locale, as the web's).

import Foundation
import VirgaCore

/// The radar's callout for one account: `{ title, lines }`.
public struct RowDescription: Codable, Hashable, Sendable {
  public var title: String
  public var lines: [String]

  public init(title: String, lines: [String]) {
    self.title = title
    self.lines = lines
  }
}

/// What postsToScan reads of a post: its address, when it was posted, and
/// its replies, quotes and reposts (absent counts are 0).
public struct PostToScanFacts: Hashable, Sendable {
  public var uri: String?
  public var at: String?
  public var replies: Double
  public var quotes: Double
  public var reposts: Double

  public init(uri: String?, at: String?, replies: Double = 0, quotes: Double = 0, reposts: Double = 0) {
    self.uri = uri
    self.at = at
    self.replies = replies
    self.quotes = quotes
    self.reposts = reposts
  }
}

public enum PageModel {
  /// DAY_MS.
  static let dayMs: Double = 86_400_000

  /// `n || 0`.
  static func orZero(_ n: Double?) -> Double {
    guard let n, !n.isNaN else { return 0 }
    return n
  }

  /// `postsToScan(posts, { now, days, limit })`: your posts worth scanning:
  /// from the last `days`, the ones with the most replies and quotes (the
  /// engagement a pile-on is made of), reposts breaking a tie, then the
  /// newest. A post nobody answered isn't offered. `facts` reads a post; a
  /// post it can't read is skipped. A posted time without an offset is
  /// read in `timeZone` (nil: AppLocale's active zone).
  public static func postsToScan<Post>(
    _ posts: [Post]?,
    now: Date = Date(),
    days: Double = 30,
    limit: Int = 4,
    timeZone: TimeZone? = nil,
    facts: (Post) -> PostToScanFacts?
  ) -> [Post] {
    let zone = timeZone ?? AppLocale.activeTimeZone()
    let since = now.timeIntervalSince1970 * 1000 - days * dayMs
    let read = (posts ?? []).map { post in (post: post, facts: facts(post)) }
    func loud(_ f: PostToScanFacts) -> Double { f.replies + f.quotes }
    func at(_ f: PostToScanFacts) -> Double { f.at.map { JSDate.parse($0, timeZone: zone) } ?? .nan }
    let offered = read.compactMap { entry -> (post: Post, facts: PostToScanFacts)? in
      guard let f = entry.facts, let uri = f.uri, !uri.isEmpty, at(f) >= since, loud(f) > 0 else { return nil }
      return (entry.post, f)
    }
    let sorted = offered.jsSorted { a, b in
      let byLoud = loud(b.facts) - loud(a.facts)
      if byLoud != 0 { return byLoud }
      let byReposts = b.facts.reposts - a.facts.reposts
      if byReposts != 0 { return byReposts }
      return at(b.facts) - at(a.facts)
    }
    return sorted.jsSlice(0, limit).map(\.post)
  }

  /// `postsToScan` over posts as JSON (the archive's rows): `uri`, `at`,
  /// `replies`, `quotes` and `reposts`, the counts read as numbers.
  public static func postsToScan(
    _ posts: [JSONValue]?,
    now: Date = Date(),
    days: Double = 30,
    limit: Int = 4,
    timeZone: TimeZone? = nil
  ) -> [JSONValue] {
    postsToScan(posts, now: now, days: days, limit: limit, timeZone: timeZone) { p in
      guard case .object = p else { return nil }
      return PostToScanFacts(
        uri: p["uri"].truthy.map(\.jsString), at: p["at"].map(\.jsString),
        replies: orZero(p["replies"]?.doubleValue), quotes: orZero(p["quotes"]?.doubleValue),
        reposts: orZero(p["reposts"]?.doubleValue))
    }
  }

  /// `text.charAt(0).toUpperCase() + text.slice(1)`: the first code unit
  /// upper-cased (half of a surrogate pair is left as it is).
  static func capitalized(_ text: String) -> String {
    guard let first = text.utf16.first else { return text }
    if UTF16.isLeadSurrogate(first) || UTF16.isTrailSurrogate(first) { return text }
    return String(jsUnits: [first]).jsUppercased() + text.jsSlice(1)
  }

  /// A row's vouches: `row.vouches || 0`.
  static func vouches(_ row: ScanRow) -> Double {
    orZero(row.score?.vouches)
  }

  /// `vouchPhrase(row, vouchCheck)`: how many of the people you follow
  /// follow this account, in words.
  public static func vouchPhrase(_ row: ScanRow, _ vouchCheck: VouchCheck = .canary, locale: String? = nil) -> String {
    if row.youFollow { return "You follow them" }
    if vouchCheck != .canary { return "Who you know in common couldn’t be checked" }
    let n = vouches(row)
    if n == 0 { return "Nobody you follow follows them" }
    return n == 1 ? "1 person you follow follows them" : "\(DefenseFormat.fmtInt(n, locale: locale)) people you follow follow them"
  }

  /// `didPhrase(row)`: what an account did to the post, its loudest
  /// engagement first ("Quoted, reposted and liked").
  public static func didPhrase(_ row: ScanRow) -> String {
    let kinds = Array(row.participant.engagements.keys)
    let words = Radar.scanSectors.filter { s in kinds.contains { Radar.sectorKey($0) == s.key } }.map(\.verb)
    guard let last = words.last else { return "Engaged" }
    let text = words.count == 1 ? last : "\(words.dropLast().joined(separator: ", ")) and \(last)"
    return capitalized(text)
  }

  /// `protectedPhrase(row)`: why an account is protected, when it is, as
  /// the score says it.
  public static func protectedPhrase(_ row: ScanRow) -> String? {
    guard row.band == .protected, let reason = row.score?.protectedReason, !reason.isEmpty else { return nil }
    return capitalized(reason)
  }

  /// `describeRow(row, vouchCheck)`: the radar's callout for one account.
  public static func describeRow(_ row: ScanRow, _ vouchCheck: VouchCheck = .canary, locale: String? = nil) -> RowDescription {
    let title: String
    if let handle = row.handle, !handle.isEmpty {
      title = "@\(handle)"
    } else if let name = row.displayName, !name.isEmpty {
      title = name
    } else {
      title = row.did
    }
    var lines = [
      "\(BandWords.bandWord[row.band] ?? row.band.rawValue). \(vouchPhrase(row, vouchCheck, locale: locale))",
      didPhrase(row),
    ]
    if row.followsYou { lines.append("Follows you") }
    if row.blocksYou { lines.append("Blocks you") }
    return RowDescription(title: title, lines: lines)
  }

  /// `rowFacts(row, vouchCheck)`: the facts on an account's line in the
  /// list: how you know it (or why it is protected), what it did, its
  /// reach. The page puts dots between them; a phone's line keeps the first.
  public static func rowFacts(_ row: ScanRow, _ vouchCheck: VouchCheck = .canary, locale: String? = nil) -> [String] {
    var out = [(row.band == .protected ? protectedPhrase(row) : nil) ?? vouchPhrase(row, vouchCheck, locale: locale), didPhrase(row)]
    let followers = orZero(row.followers)
    if followers != 0 {
      out.append("\(DefenseFormat.fmtInt(followers, locale: locale)) \(followers == 1 ? "follower" : "followers")")
    }
    if row.blocksYou { out.append("blocks you") }
    return out
  }

  static func stage(_ key: String?) -> (index: Int, stage: ScanStage)? {
    guard let key, let i = Scan.stages.firstIndex(where: { $0.key.jsEquals(key) }) else { return nil }
    return (i, Scan.stages[i])
  }

  /// `stageLine(state)`: where a scan is, in a line: the stage, and how far
  /// through it when that's known.
  public static func stageLine(stage key: String?, progress: ScanState.Progress?, locale: String? = nil) -> String {
    guard let stage = stage(key)?.stage else { return "Starting…" }
    guard let p = progress, p.total != 0 else { return "\(stage.label)…" }
    let shown = Double(Swift.min(p.done, p.total))
    let of = "\(DefenseFormat.fmtInt(shown, locale: locale)) of \(DefenseFormat.fmtInt(Double(p.total), locale: locale))"
    if stage.key == "harvest" { return "\(stage.label): \(of) \(p.total == 1 ? "kind" : "kinds") of engagement" }
    if stage.key == "score" { return "\(stage.label): \(of) \(p.total == 1 ? "account" : "accounts")" }
    return "\(stage.label): \(of)"
  }

  /// `stageLine(state)` for a scan's state (nil: none).
  public static func stageLine(_ state: ScanState?, locale: String? = nil) -> String {
    stageLine(stage: state?.stage, progress: state?.progress, locale: locale)
  }

  /// `stageLabel(state)`: the stage alone, for the line a screen reader
  /// hears change: "Sorting by who you know".
  public static func stageLabel(stage key: String?) -> String {
    stage(key)?.stage.label ?? "Starting"
  }

  public static func stageLabel(_ state: ScanState?) -> String {
    stageLabel(stage: state?.stage)
  }

  /// `stageCount(state)`: the stage's count after its label, or nothing:
  /// ": 300 of 1,250 accounts".
  public static func stageCount(stage key: String?, progress: ScanState.Progress?, locale: String? = nil) -> String {
    let line = stageLine(stage: key, progress: progress, locale: locale)
    let label = stageLabel(stage: key)
    return line.jsStartsWith("\(label):") ? line.jsSlice(label.jsLength) : ""
  }

  public static func stageCount(_ state: ScanState?, locale: String? = nil) -> String {
    stageCount(stage: state?.stage, progress: state?.progress, locale: locale)
  }

  /// `stageFraction(state)`: how far along a scan is, from 0 to 1, for the
  /// bar under its line.
  public static func stageFraction(stage key: String?, progress: ScanState.Progress?) -> Double {
    guard let i = stage(key)?.index else { return 0 }
    let within: Double
    if let p = progress, p.total != 0 {
      within = JSMath.min(1, Double(p.done) / Double(p.total))
    } else {
      within = 0
    }
    return (Double(i) + within) / Double(Scan.stages.count)
  }

  public static func stageFraction(_ state: ScanState?) -> Double {
    stageFraction(stage: state?.stage, progress: state?.progress)
  }

  /// `inertCell(value)`: a cell from someone else's profile, safe to open in
  /// a spreadsheet: one that starts with = + - @ or a tab or a return would
  /// be read as a formula, so it gets a quote in front.
  public static func inertCell(_ value: String) -> String {
    guard let first = value.utf16.first, [0x3D, 0x2B, 0x2D, 0x40, 0x09, 0x0D].contains(first) else { return value }
    return "'\(value)"
  }

  /// `inertCell(value)` for a cell of any type: only a string changes.
  public static func inertCell(_ value: JSONValue) -> JSONValue {
    guard case .string(let text) = value else { return value }
    return .string(inertCell(text))
  }

  /// The kinds a row engaged with, as the web's `Object.keys(engagements)`
  /// lists them: in the order the harvest first counted each, which is the
  /// order of the row's records. A kind with no record (a row put together
  /// by hand) follows, by KIND_ORDER, then by name.
  public static func engagementKinds(_ participant: Participant) -> [String] {
    var out: [String] = []
    for record in participant.records where participant.engagements[record.kind] != nil && !out.jsContains(record.kind) {
      out.append(record.kind)
    }
    let rest = participant.engagements.keys.filter { !out.jsContains($0) }.sorted { a, b in
      let ia = Harvest.kindOrder.firstIndex(of: a) ?? Harvest.kindOrder.count
      let ib = Harvest.kindOrder.firstIndex(of: b) ?? Harvest.kindOrder.count
      return ia != ib ? ia < ib : Array(a.utf16).lexicographicallyPrecedes(Array(b.utf16))
    }
    return out + rest
  }

  /// The export's header row, the first of scanCsvRows.
  public static let scanCsvHeader = [
    "did", "handle", "display_name", "band", "trust", "vouches", "you_follow", "follows_you", "followers", "engagement",
    "records",
  ]

  /// `scanCsvRows(summary)`: every account in a scan as a CSV's rows, header
  /// first. Cells are strings or numbers, as the web's.
  public static func scanCsvRows(_ summary: ScanSummary?) -> [[JSONValue]] {
    let header = scanCsvHeader.map(JSONValue.string)
    let rows = (summary?.rows ?? []).map { r -> [JSONValue] in
      let s = r.score
      return [
        .string(r.did),
        inertCell(.string(r.handle ?? "")),
        inertCell(.string(r.displayName ?? "")),
        .string(r.band.rawValue),
        r.trust.map { .number(Double($0)) } ?? .string(""),
        summary?.vouchCheck == .canary ? .number(s?.vouches ?? 0) : .string(""),
        .string(r.youFollow ? "yes" : "no"),
        .string(r.followsYou ? "yes" : "no"),
        r.followers.map(JSONValue.number) ?? .string(""),
        .string(engagementKinds(r.participant).joined(separator: " ")),
        .number(Double(r.participant.total)),
      ]
    }
    return [header] + rows
  }
}
