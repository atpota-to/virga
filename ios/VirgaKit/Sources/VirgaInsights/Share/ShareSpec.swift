// Ports src/share/shareSpec.js
//
// What a card looks like as a picture to post, and the words that describe
// it. Pure: each shareable card type has a builder that reads the same
// model its card draws from and returns a spec the picture (ChartImage)
// draws and `shareAltText` puts into words.
//
//   series  { kind: 'series', title, subtitle, figure, series, mode, unit,
//             trend, zeroBase, format, marks, noun, ghost }
//   bars    { kind: 'bars', title, subtitle, figure, rows: [{ label, value,
//             display }], measure }
//
// `figure` is the headline over the chart: `{ value, label }`, both already
// written out. `noun` names what a series counts ("followers").

import Foundation
import VirgaArchive
import VirgaCore
import VirgaNetwork

/// The headline over a chart, written out.
public struct ShareFigure: Hashable, Sendable {
  public var value: String
  public var label: String

  public var json: JSONValue { ["value": .string(value), "label": .string(label)] }
}

/// One bucket of a series picture: its start and value (nil where a rate
/// has no posts), and a rate's sums.
public struct SharePoint: Hashable, Sendable {
  public var t: Double
  public var v: Double?
  public var total: Double?
  public var posts: Double?

  public init(t: Double, v: Double?, total: Double? = nil, posts: Double? = nil) {
    self.t = t
    self.v = v
    self.total = total
    self.posts = posts
  }

  init(_ p: SeriesPoint) { self.init(t: p.t, v: p.v) }
  init(_ p: TrendPoint) { self.init(t: p.t, v: p.v) }
  init(_ p: RatePoint) { self.init(t: p.t, v: p.v, total: p.total, posts: p.posts) }

  public var json: JSONValue {
    var members: [String: JSONValue] = ["t": .number(t), "v": ReportJSON.number(v)]
    if let total { members["total"] = .number(total) }
    if let posts { members["posts"] = .number(posts) }
    return .object(members)
  }
}

/// A row of a bar picture.
public struct ShareBarRow: Hashable, Sendable {
  public var label: String
  public var value: Double
  public var display: String

  public var json: JSONValue { ["label": .string(label), "value": .number(value), "display": .string(display)] }
}

/// How a series picture writes its numbers: the chart's `fmtCount` or `fmtRate`.
public enum ShareNumberFormat: String, Hashable, Sendable {
  case count = "fmtCount"
  case rate = "fmtRate"

  public func callAsFunction(_ v: Double?, locale: String? = nil) -> String {
    switch self {
    case .count: return ChartFormat.fmtCount(v, locale: locale)
    case .rate: return ChartFormat.fmtRate(v, locale: locale)
    }
  }
}

/// A card as a picture: a series (bars or a line over buckets) or bars by
/// label. `format` and the series fields are a series', `rows` and
/// `measure` the bars'.
public struct ShareSpecification: Hashable, Sendable {
  public enum Kind: String, Hashable, Sendable {
    case series, bars
  }

  public var kind: Kind
  public var title: String
  public var subtitle: String
  public var figure: ShareFigure?
  // A series.
  public var series: [SharePoint]
  public var unit: AnalyticsUnit
  /// "bars" or "line".
  public var mode: String
  public var trend: [SharePoint]?
  public var zeroBase: Bool
  public var format: ShareNumberFormat
  public var marks: [SeriesMark]
  public var noun: String
  /// The profile's own counter, drawn as a dashed reach past the line's end.
  public var ghost: Double?
  // Bars.
  public var rows: [ShareBarRow]
  public var measure: String

  public init(
    kind: Kind, title: String, subtitle: String = "", figure: ShareFigure?, series: [SharePoint] = [],
    unit: AnalyticsUnit = .day, mode: String = "bars", trend: [SharePoint]? = nil, zeroBase: Bool = true,
    format: ShareNumberFormat = .count, marks: [SeriesMark] = [], noun: String = "", ghost: Double? = nil,
    rows: [ShareBarRow] = [], measure: String = ""
  ) {
    self.kind = kind
    self.title = title
    self.subtitle = subtitle
    self.figure = figure
    self.series = series
    self.unit = unit
    self.mode = mode
    self.trend = trend
    self.zeroBase = zeroBase
    self.format = format
    self.marks = marks
    self.noun = noun
    self.ghost = ghost
    self.rows = rows
    self.measure = measure
  }

  /// The web's spec, `format` by name.
  public var json: JSONValue {
    var members: [String: JSONValue] = [
      "kind": .string(kind.rawValue), "title": .string(title), "subtitle": .string(subtitle),
      "figure": figure?.json ?? .null,
    ]
    switch kind {
    case .series:
      members["series"] = .array(series.map(\.json))
      members["unit"] = .string(unit.rawValue)
      members["mode"] = .string(mode)
      members["trend"] = trend.map { .array($0.map(\.json)) } ?? .null
      members["zeroBase"] = .bool(zeroBase)
      members["format"] = .string(format.rawValue)
      members["marks"] = .array(marks.map(\.json))
      members["noun"] = .string(noun)
      members["ghost"] = ghost.map { ["v": .number($0)] } ?? .null
    case .bars:
      members["rows"] = .array(rows.map(\.json))
      members["measure"] = .string(measure)
    }
    return .object(members)
  }
}

/// A card's own settings as a picture reads them: `kind`, `rows`, its own
/// `title`, and `notes`, the account's chart notes.
public struct ShareOptions: Hashable, Sendable {
  public var kind: String
  public var rows: Double?
  public var title: String?
  public var notes: [Annotation]

  public init(kind: String = "all", rows: Double? = nil, title: String? = nil, notes: [Annotation] = []) {
    self.kind = kind
    self.rows = rows
    self.title = title
    self.notes = notes
  }
}

public enum ShareSpec {
  /// Alt text on Bluesky holds 2,000 characters; this leaves room to add to it.
  public static let altTextMax = 1800
  /// A chart with more buckets than this is described, not listed value by value.
  static let listUpTo = 40

  static let kindWordsTable = ["like": "likes", "repost": "reposts", "reply": "replies", "quote": "quotes"]

  static func kindWords(_ kind: String) -> String {
    kindWordsTable.jsValue(kind) ?? "likes, reposts, replies and quotes"
  }

  static func cap(_ s: String) -> String {
    s.jsCharAt(0).jsUppercased() + s.jsSlice(1)
  }

  static func fmtInt(_ n: Double, _ formats: ReportFormats) -> String {
    InteractionModel.fmtInt(n, locale: formats.locale)
  }

  static func fmtInt(_ n: Int, _ formats: ReportFormats) -> String { fmtInt(Double(n), formats) }

  static func phrase(_ period: AnalyticsPeriod, _ formats: ReportFormats) -> String {
    Periods.periodPhrase(period, locale: formats.locale, timeZone: formats.timeZone)
  }

  /// "@mira.example.com, the last 30 days": whose numbers and over what.
  static func subtitleOf(_ archive: ReportArchive, _ period: AnalyticsPeriod, _ formats: ReportFormats) -> String {
    let who = archive.handle.flatMap { $0.isEmpty ? nil : "@\($0)" }
    return [who, phrase(period, formats)].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: ", ")
  }

  static func marksFor(
    _ archive: ReportArchive, _ series: [Double], _ unit: AnalyticsUnit, _ notes: [Annotation], _ milestones: Bool,
    _ formats: ReportFormats
  ) -> [SeriesMark] {
    var marks = notes.map { Annotations.noteMark($0, timeZone: formats.timeZone) }
    if milestones { marks += Annotations.followerMilestones(archive.followers, locale: formats.locale, timeZone: formats.timeZone) }
    return Annotations.marksOnSeries(series, unit, marks, timeZone: formats.timeZone, weekStart: formats.weekStart)
  }

  static func seriesSpec(
    title: String, figure: ShareFigure, series: [SharePoint], unit: AnalyticsUnit, mode: String = "bars",
    trend: [SharePoint]? = nil, zeroBase: Bool = true, format: ShareNumberFormat = .count, marks: [SeriesMark] = [],
    noun: String, ghost: Double? = nil
  ) -> ShareSpecification {
    ShareSpecification(
      kind: .series, title: title, figure: figure, series: series, unit: unit, mode: mode, trend: trend,
      zeroBase: zeroBase, format: format, marks: marks, noun: noun, ghost: ghost)
  }

  typealias Builder = @Sendable (ReportArchive, AnalyticsPeriod, Double, ShareOptions, ReportFormats) -> ShareSpecification?

  static let builders: [String: Builder] = [
    "follower-growth": { archive, period, nowMs, options, f in
      let m = ReportModels.followersModel(archive, period, nowMs, formats: f)
      if archive.followers.isEmpty { return nil }
      return seriesSpec(
        title: "Follower growth",
        figure: ShareFigure(
          value: fmtInt(Double(m.profileCount ?? m.total), f), label: "followers, +\(fmtInt(m.gained, f)) in \(phrase(period, f))"),
        series: m.cumulative.map(SharePoint.init), unit: m.unit, mode: "line", zeroBase: false,
        marks: marksFor(archive, m.cumulative.map(\.t), m.unit, options.notes, true, f), noun: "followers",
        // As on the card: the dashed reach from the curve's end up to the
        // profile's own counter, which still counts accounts that can't be listed.
        ghost: (m.counterGap ?? 0) > 0 ? m.profileCount.map(Double.init) : nil)
    },
    "new-followers": { archive, period, nowMs, options, f in
      let m = ReportModels.followersModel(archive, period, nowMs, formats: f)
      if archive.followers.isEmpty { return nil }
      return seriesSpec(
        title: "New followers",
        figure: ShareFigure(value: "+\(fmtInt(m.gained, f))", label: "new followers in \(phrase(period, f))"),
        series: m.counts.map(SharePoint.init), unit: m.unit,
        marks: marksFor(archive, m.counts.map(\.t), m.unit, options.notes, true, f), noun: "new followers")
    },
    "engagement-over-time": { archive, period, nowMs, options, f in
      let kind = options.kind
      let m = ReportModels.engagementModel(archive, period, nowMs, kind: kind, formats: f)
      return seriesSpec(
        title: kind == "all" ? "Engagement" : cap(kindWords(kind)),
        figure: ShareFigure(value: fmtInt(m.total, f), label: "\(kindWords(kind)) on \(fmtInt(m.posts, f)) posts"),
        series: m.series.map(SharePoint.init), unit: m.unit, trend: m.trend.map(SharePoint.init),
        marks: marksFor(archive, m.series.map(\.t), m.unit, options.notes, false, f),
        noun: kind == "all" ? "interactions" : kindWords(kind))
    },
    "engagement-rate": { archive, period, nowMs, options, f in
      let kind = options.kind
      let m = ReportModels.engagementModel(archive, period, nowMs, kind: kind, formats: f)
      return seriesSpec(
        title: kind == "all" ? "Engagement per post" : "\(cap(kindWords(kind))) per post",
        figure: ShareFigure(
          value: m.ownRate == nil ? "—" : ChartFormat.fmtRate(m.ownRate, locale: f.locale),
          label: "per post, over \(fmtInt(m.ownPosts, f)) posts and threads"),
        series: m.rate.map(SharePoint.init), unit: m.rateUnit, trend: m.rateTrend.map(SharePoint.init), format: .rate,
        marks: marksFor(archive, m.rate.map(\.t), m.rateUnit, options.notes, false, f),
        noun: "\(kind == "all" ? "interactions" : kindWords(kind)) per post")
    },
    "engagement-given": { archive, period, nowMs, options, f in
      let kind = options.kind
      let m = ReportModels.givenModel(archive, period, nowMs, kind: kind, formats: f)
      return seriesSpec(
        title: kind == "all" ? "Engagement given" : "\(cap(kindWords(kind))) given",
        figure: ShareFigure(value: fmtInt(m.total, f), label: "\(kindWords(kind)) given to \(fmtInt(m.accounts, f)) accounts"),
        series: m.series.map(SharePoint.init), unit: m.unit, trend: m.trend.map(SharePoint.init),
        noun: "\(kind == "all" ? "interactions" : kindWords(kind)) given")
    },
    "posting-cadence": { archive, period, nowMs, options, f in
      let m = ReportModels.postsModel(archive, period, nowMs, formats: f)
      return seriesSpec(
        title: "Posts", figure: ShareFigure(value: fmtInt(m.count, f), label: "posts and replies in \(phrase(period, f))"),
        series: m.counts.map(SharePoint.init), unit: m.unit, trend: m.trend.map(SharePoint.init),
        marks: marksFor(archive, m.counts.map(\.t), m.unit, options.notes, false, f), noun: "posts")
    },
    "repo-activity": { archive, period, nowMs, _, f in
      guard let m = ReportModels.atmosphereModel(archive, period, nowMs, formats: f) else { return nil }
      return seriesSpec(
        title: "Repo activity",
        figure: ShareFigure(value: fmtInt(m.total, f), label: "records written across \(fmtInt(m.collections, f)) collections"),
        series: m.series.map(SharePoint.init), unit: m.unit, trend: m.trend.map(SharePoint.init), noun: "records")
    },
    "engagement-by-type": { archive, period, nowMs, _, f in
      let m = ReportModels.engagementModel(archive, period, nowMs, formats: f)
      return ShareSpecification(
        kind: .bars, title: "Engagement by type",
        figure: ShareFigure(value: fmtInt(m.total, f), label: "likes, reposts, replies and quotes"),
        rows: m.byKind.map { ShareBarRow(label: $0.label, value: Double($0.value), display: fmtInt($0.value, f)) },
        measure: "received")
    },
    "content-formats": { archive, period, nowMs, _, f in
      groupSpec(ReportModels.contentModel(archive, period, nowMs, formats: f), \.formats, "What a typical post earns, by format", f)
    },
    "content-length": { archive, period, nowMs, _, f in
      groupSpec(ReportModels.contentModel(archive, period, nowMs, formats: f), \.lengths, "What a typical post earns, by length", f)
    },
    "top-tags": { archive, period, nowMs, options, f in
      usedSpec(ReportModels.contentModel(archive, period, nowMs, formats: f), \.tags, "Tags", { "#\($0)" }, options.rows, f)
    },
    "top-links": { archive, period, nowMs, options, f in
      usedSpec(ReportModels.contentModel(archive, period, nowMs, formats: f), \.links, "Sites linked to", { $0 }, options.rows, f)
    },
  ]

  static func groupSpec(
    _ m: ContentReport, _ key: KeyPath<ContentReport, [ContentGroup]>, _ title: String, _ f: ReportFormats
  ) -> ShareSpecification? {
    if !m.ready { return nil }
    let rows = m[keyPath: key].filter { $0.posts > 0 && $0.typical != nil }
    if rows.isEmpty { return nil }
    return ShareSpecification(
      kind: .bars, title: title,
      figure: ShareFigure(
        value: m.typical == nil ? "—" : ChartFormat.fmtRate(m.typical, locale: f.locale),
        label: "for a typical post, across \(fmtInt(m.posts, f)) posts and threads"),
      rows: rows.map { ShareBarRow(label: $0.label, value: $0.typical!, display: ChartFormat.fmtRate($0.typical, locale: f.locale)) },
      measure: "for a typical post")
  }

  static func usedSpec(
    _ m: ContentReport, _ key: KeyPath<ContentReport, [ContentUse]>, _ title: String, _ render: (String) -> String,
    _ limit: Double?, _ f: ReportFormats
  ) -> ShareSpecification? {
    let used = m[keyPath: key]
    if !m.ready || used.isEmpty { return nil }
    // `slice(0, Math.min(limit || 8, 8))`.
    let wanted = limit.flatMap { $0 == 0 || $0.isNaN ? nil : $0 } ?? 8
    let shown = slice(used, Swift.min(wanted, 8))
    return ShareSpecification(
      kind: .bars, title: title,
      figure: ShareFigure(
        value: fmtInt(used.count, f), label: "\(title.jsLowercased()) across \(fmtInt(m.posts, f)) posts and threads"),
      rows: shown.map { ShareBarRow(label: render($0.name), value: Double($0.posts), display: fmtInt($0.posts, f)) },
      measure: "posts")
  }

  /// `list.slice(0, end)`: a negative end counts from the back.
  static func slice<T>(_ list: [T], _ end: Double) -> [T] {
    let n = Double(list.count)
    let e = end < 0 ? Swift.max(0, n + end.rounded(.towardZero)) : Swift.min(n, end.rounded(.towardZero))
    return Array(list.prefix(Int(e)))
  }

  /// A figure tile shares the chart it is the headline of.
  static let sameAs = [
    "stat-followers": "follower-growth",
    "stat-new-followers": "new-followers",
    "stat-engagement": "engagement-over-time",
    "stat-per-post": "engagement-rate",
    "stat-given": "engagement-given",
    "stat-posts": "posting-cadence",
  ]

  static func builder(_ type: String) -> Builder? {
    builders.jsValue(type) ?? sameAs.jsValue(type).flatMap { builders.jsValue($0) }
  }

  /// Whether a card type can be made into a picture.
  public static func canShare(_ type: String) -> Bool {
    builders.jsValue(type) != nil || sameAs.jsValue(type) != nil
  }

  /// The spec for a card: `type` is its widget type, `options` its own
  /// settings plus the account's notes. Nil when the card has nothing to
  /// draw yet.
  public static func shareSpec(
    _ type: String, _ archive: ReportArchive, _ period: AnalyticsPeriod, _ nowMs: Double,
    _ options: ShareOptions = ShareOptions(), formats: ReportFormats = .active
  ) -> ShareSpecification? {
    guard let build = builder(type), var spec = build(archive, period, nowMs, options, formats) else { return nil }
    if spec.kind == .series && spec.series.isEmpty { return nil }
    if let title = options.title, !title.isEmpty { spec.title = title }
    spec.subtitle = subtitleOf(archive, period, formats)
    return spec
  }

  // MARK: - In words

  static func extremes(_ series: [SharePoint]) -> (hi: SharePoint?, lo: SharePoint?) {
    var hi: SharePoint?
    var lo: SharePoint?
    for p in series {
      guard let v = p.v else { continue }
      if hi == nil || v > hi!.v! { hi = p }
      if lo == nil || v < lo!.v! { lo = p }
    }
    return (hi, lo)
  }

  /// The description to post beside the picture, written from the same
  /// numbers the chart's table holds: what it is, whose, over what window,
  /// where it starts and ends, its highest and lowest point, anything marked
  /// on it, and (when the chart is short enough to list) every value.
  public static func shareAltText(_ spec: ShareSpecification?, formats: ReportFormats = .active) -> String {
    guard let spec else { return "" }
    let head = "\(spec.title)\(spec.subtitle.isEmpty ? "" : ", \(spec.subtitle)")."
    let headline = spec.figure.map { " \($0.value) \($0.label)." } ?? ""

    if spec.kind == .bars {
      let rows = spec.rows.map { "\($0.label): \($0.display)" }.joined(separator: "; ")
      return clip("\(head)\(headline) Bar chart, \(spec.measure). \(rows).")
    }

    let series = spec.series
    let format = { (v: Double?) in spec.format(v, locale: formats.locale) }
    let live = series.filter { $0.v != nil }
    guard let first = live.first, let last = live.last else { return clip("\(head)\(headline) Nothing in this window.") }
    let (hi, lo) = extremes(series)
    // A week reads "the week of Oct 18" in a sentence and "week of Oct 18"
    // in the list of values; a day or a month is its own name in both.
    let label = { (t: Double) -> String in
      let text = Analytics.bucketLabel(t, spec.unit, locale: formats.locale, timeZone: formats.timeZone)
      return text.utf16.starts(with: "wk of ".utf16) ? "week of " + text.jsSlice(6) : text
    }
    let named = { (t: Double) in spec.unit == .week ? "the \(label(t))" : label(t) }
    let shape = spec.mode == "line" ? "Line chart" : "Bar chart"
    var text =
      "\(head)\(headline) \(shape) of \(spec.noun) per \(ChartFormat.unitNoun(spec.unit)), from \(named(series[0].t)) to \(named(series[series.count - 1].t))."
    if spec.mode == "line" {
      text += " It starts at \(format(first.v)) and ends at \(format(last.v))."
    } else if let hi, let lo {
      let lowest = lo.v != hi.v ? ", the lowest \(named(lo.t)) with \(format(lo.v))" : ""
      text += " The highest is \(named(hi.t)) with \(format(hi.v))\(lowest)."
    }
    if let ghost = spec.ghost {
      text += " Bluesky’s profile counter says \(fmtInt(ghost, formats)), which still counts accounts that can’t be listed."
    }
    if !spec.marks.isEmpty {
      text += " Marked: \(spec.marks.map { "\(named($0.t)), \($0.items.map(\.label).joined(separator: " and "))" }.joined(separator: "; "))."
    }
    if series.count <= listUpTo {
      let values = " Values: \(series.map { "\(label($0.t)): \($0.v == nil ? "none" : format($0.v))" }.joined(separator: "; "))."
      if (text + values).utf16.count <= altTextMax { text += values }
    }
    return clip(text)
  }

  static func clip(_ text: String) -> String {
    text.utf16.count <= altTextMax ? text : "\(text.jsSlice(0, altTextMax - 1).jsTrimmingEnd())…"
  }

  /// A first line for the post itself, for the writer to change:
  /// "Follower growth, the last 30 days."
  public static func sharePostText(_ spec: ShareSpecification?, _ period: AnalyticsPeriod, formats: ReportFormats = .active) -> String {
    guard let spec else { return "" }
    return "\(spec.title), \(phrase(period, formats))."
  }
}
