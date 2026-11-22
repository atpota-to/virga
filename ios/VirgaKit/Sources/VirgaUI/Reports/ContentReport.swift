// Ports src/reports/ContentReport.jsx
//
// What posts carry and what they typically earn: the figures (posts and
// threads, a typical post, with pictures or video, media described, with a
// tag), then by format and by length (each with its insight sentence,
// typical post or posts, and its table), tags and sites (ranked, the first
// twelve, Show all), threads, and the languages where there is more than
// one. The words are the web's; "None of this says one thing causes
// another" included.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

enum ContentWords {
  static func postsWord(_ n: Int) -> String { "\(AppLocale.formatNumber(n)) \(n == 1 ? "post" : "posts")" }
  static func typicalText(_ typical: Double?) -> String { typical == nil ? "—" : ChartFormat.fmtRate(typical) }
  static func pct(_ share: Double) -> Int { Int((share * 100).jsRounded) }

  /// `barRow(g, measure, label)`.
  static func barRow(key: String, label: String, posts: Int, share: Double, typical: Double?, measure: String) -> BarListRow {
    let byTypical = measure == "typical"
    let title =
      byTypical
      ? (typical == nil
        ? "\(postsWord(posts)): too few to say what’s typical" : "\(postsWord(posts)), typically earning \(ChartFormat.fmtRate(typical))")
      : "\(postsWord(posts)), \(pct(share))% of them"
    return BarListRow(
      key: key, label: label, value: byTypical ? typical ?? 0 : Double(posts),
      display: byTypical ? typicalText(typical) : AppLocale.formatNumber(posts), title: title)
  }

  /// `standoutSentence(groups, overall, against, noun)`.
  static func standout(_ groups: [ContentGroup], _ overall: Double?, _ against: String?, noun: (ContentGroup) -> String) -> String? {
    guard let s = ReportModels.contentStandout(groups, overall, against) else { return nil }
    let versus = s.base.map { "\(ChartFormat.fmtRate(s.baseline)) for \(noun($0).jsLowercased())" } ?? "\(ChartFormat.fmtRate(s.baseline)) for your posts overall"
    let best = noun(s.best)
    return "\(best) typically earn\(best.hasSuffix("s") ? "" : "s") \(ChartFormat.fmtRate(s.best.typical)), against \(versus)."
  }

  static func formatNoun(_ g: ContentGroup) -> String {
    switch g.key {
    case "text": return "Text-only posts"
    case "image": return "Posts with images"
    case "video": return "Posts with video"
    case "link": return "Posts with a link card"
    case "gif": return "Posts with a GIF"
    default: return "Quote posts"
    }
  }

  static let measures = [
    SegmentedOption("typical", "Typical post", accessibilityLabel: "What the middle post of each group earns"),
    SegmentedOption("posts", "Posts", accessibilityLabel: "How many posts are in each group"),
  ]

  static func columns(_ head: String) -> [DataTableColumn] {
    [
      DataTableColumn(head), DataTableColumn("Posts", numeric: true), DataTableColumn("Share", numeric: true),
      DataTableColumn("Typical post", numeric: true), DataTableColumn("All engagement", numeric: true),
    ]
  }

  static func cells(_ label: String, posts: Int, share: Double, typical: Double?, total: Int) -> [String] {
    [label, AppLocale.formatNumber(posts), "\(pct(share))%", typicalText(typical), AppLocale.formatNumber(total)]
  }
}

/// `GroupTable`: a bar list's table, behind Show as table.
struct GroupTable: View {
  let columns: [DataTableColumn]
  let rows: [[String]]

  var body: some View {
    if !rows.isEmpty {
      ShowAsTable {
        ScrollView([.vertical, .horizontal]) {
          DataTable(columns: columns, rows: rows)
        }
        .frame(maxHeight: Measure.Chart.tableMaxHeight)
      }
    }
  }
}

/// `Grouped`: a band of groups, by typical post or by posts.
struct ContentGrouped: View {
  @Environment(\.virgaTheme) private var theme
  let title: String
  let sub: String
  let head: String
  let label: String
  let groups: [ContentGroup]
  var insight: String? = nil
  @State private var measure = "typical"

  var body: some View {
    let shown = groups.filter { $0.posts > 0 }
    ReportCard(
      title: title, sub: sub,
      tools: AnyView(Segmented(label: "\(title): measure", options: ContentWords.measures, selection: $measure, size: .small))
    ) {
      if let insight {
        Text(insight).virgaText(.textBase).foregroundStyle(theme.ink2).fixedSize(horizontal: false, vertical: true)
      }
      if shown.isEmpty {
        EmptyState("No posts in this window.")
      } else {
        BarList(
          rows: shown.map { ContentWords.barRow(key: $0.key, label: $0.label, posts: $0.posts, share: $0.share, typical: $0.typical, measure: measure) },
          accessibilityLabel: label)
        GroupTable(
          columns: ContentWords.columns(head),
          rows: shown.map { ContentWords.cells($0.label, posts: $0.posts, share: $0.share, typical: $0.typical, total: $0.total) })
      }
    }
  }
}

/// `Ranked`: tags or sites, the first twelve, by posts or typical post.
struct ContentRanked: View {
  @Environment(\.virgaTheme) private var theme
  let title: String
  let sub: String
  let head: String
  let rows: [ContentUse]
  let render: (String) -> String
  let empty: String
  @State private var measure = "posts"
  @State private var all = false
  static let limit = 12

  var body: some View {
    let ordered =
      measure == "typical"
      ? rows.filter { $0.typical != nil }.sorted { ($0.typical ?? 0, $0.posts) > ($1.typical ?? 0, $1.posts) } : rows
    let shown = all ? ordered : Array(ordered.prefix(Self.limit))
    ReportCard(
      title: title, sub: sub,
      tools: rows.isEmpty
        ? nil : AnyView(Segmented(label: "\(title): measure", options: ContentWords.measures, selection: $measure, size: .small))
    ) {
      if shown.isEmpty {
        EmptyState(rows.isEmpty ? empty : "None used in \(ReportModels.contentMinPosts) posts or more yet.")
      } else {
        BarList(
          rows: shown.map {
            ContentWords.barRow(key: $0.name, label: render($0.name), posts: $0.posts, share: $0.share, typical: $0.typical, measure: measure)
          }, accessibilityLabel: title)
        if ordered.count > Self.limit {
          Button(all ? "Show fewer" : "Show all \(AppLocale.formatNumber(ordered.count))") { all.toggle() }
            .buttonStyle(.linkAction(isOpen: all))
        }
        GroupTable(
          columns: ContentWords.columns(head),
          rows: ordered.map { ContentWords.cells(render($0.name), posts: $0.posts, share: $0.share, typical: $0.typical, total: $0.total) })
      }
    }
  }
}

struct ContentReportView: View {
  @Environment(\.virgaTheme) private var theme
  let archive: ReportArchive
  let period: AnalyticsPeriod

  var body: some View {
    let m = ReportModels.contentModel(archive, period, archive.nowMs ?? SyncStatus.now())
    if archive.posts.isEmpty {
      SyncEmpty(text: "The post archive is empty. Run a sync to build it.")
    } else if !m.ready {
      SyncEmpty(
        text:
          "One more sync, and this report can be drawn. Your archive was built before Virga kept what each post is made of: its length, tags, links, media and alt text. A sync reads them from your repo in one download and keeps every count you already have."
      )
    } else {
      let share = { (n: Int) -> Double in m.posts != 0 ? (Double(n) / Double(m.posts) * 100).jsRounded : 0 }
      let media = m.formats.filter { $0.key == "image" || $0.key == "video" }.reduce(0) { $0 + $1.posts }
      let days = period.days.map { $0 != 0 } ?? false
      let window = days ? "in \(Periods.periodPhrase(period))" : "all time"
      FiguresView(
        [
          ReportParts.fig("Posts and threads, \(window)", Double(m.posts)),
          FigureItem(
            label: "A typical post earns", value: .text(m.typical == nil ? "—" : ChartFormat.fmtRate(m.typical)),
            note: AnyView(Text("likes, reposts, replies and quotes"))),
          ReportParts.fig("With pictures or video", share(media), unit: "%", sub: ContentWords.postsWord(media)),
          ReportParts.fig(
            "Media described", m.alt.pct.map { $0.jsRounded }, unit: m.alt.pct == nil ? "" : "%",
            sub: m.alt.items != 0
              ? "\(AppLocale.formatNumber(m.alt.itemsDescribed)) of \(AppLocale.formatNumber(m.alt.items)) pictures and videos have alt text"
              : "no pictures or video in this window"),
          ReportParts.fig("With a tag", share(m.withTags), unit: "%", sub: ContentWords.postsWord(m.withTags)),
        ], label: "Content in figures")
      ContentGrouped(
        title: "By format", sub: "What each post carries besides its words", head: "Format", label: "Posts by format", groups: m.formats,
        insight: ContentWords.standout(m.formats, m.typical, "text", noun: ContentWords.formatNoun))
      ContentGrouped(
        title: "By length", sub: "In characters, of the 300 a post holds", head: "Length", label: "Posts by length", groups: m.lengths,
        insight: ContentWords.standout(m.lengths, m.typical, nil) { "Posts of \($0.label.jsLowercased()) characters" })
      ContentRanked(
        title: "Tags", sub: "Counted whatever their capitals", head: "Tag", rows: m.tags, render: { "#\($0)" },
        empty: "No tags on your posts in this window.")
      ContentRanked(
        title: "Sites you link to", sub: "From links in the text and link cards", head: "Site", rows: m.links, render: { $0 },
        empty: "No links in your posts in this window.")
      ContentGrouped(
        title: "Threads", sub: "Where a post sits in a thread of your own", head: "Place", label: "Posts by place in a thread",
        groups: m.places)
      if m.langs.count > 1 {
        ReportCard(title: "Languages", sub: "As each post is marked. A post can carry more than one.", tools: nil) {
          BarList(
            rows: m.langs.map { BarListRow(key: $0.lang, label: Locale(identifier: "en").localizedString(forLanguageCode: $0.lang) ?? $0.lang, value: Double($0.posts)) },
            accessibilityLabel: "Posts by language")
        }
      }
      if m.unread > 0 {
        let one = m.unread == 1
        Text(
          "\(ContentWords.postsWord(m.unread)) in this window \(one ? "isn’t" : "aren’t") included: \(one ? "it was" : "they were") archived before Virga kept what a post is made of, and \(one ? "is" : "are") no longer in your repo to read it from."
        )
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)
      }
      HowCounted(paragraphs: [
        "Your posts and your own threads in the window. Replies to other people are left out, as they are from the engagement rate: an answer inside someone else’s conversation earns on a different scale.",
        "What a group typically earns is its median post, the one in the middle, so a single post that went round doesn’t speak for the rest. Posts from the last two days are still collecting and are counted but not weighed, and a group needs \(ReportModels.contentMinPosts) weighed posts before it gets a typical value. Counts are as of the last sync.",
        "A post’s format is what it carries: pictures, a video, a link card, a GIF, or a quote. A quote post that also has pictures counts as its pictures. Length is in the characters Bluesky counts. Tags come from the text and from tags added beside it; sites from links in the text and from link cards. Media counts as described when its alt text isn’t empty.",
        "None of this says one thing causes another. Posts with pictures may do well because of what you choose to photograph.",
      ])
    }
  }
}

/// `SyncEmpty`: what the report needs, and Sync now.
struct SyncEmpty: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  let text: String

  var body: some View {
    let syncing = archive?.sync != nil
    VStack(alignment: .leading, spacing: theme.space3) {
      Text(text).virgaText(.textBase).foregroundStyle(theme.muted).fixedSize(horizontal: false, vertical: true)
      Button {
        if let archive { Task { await archive.runSync(.incremental) } }
      } label: {
        Label(syncing ? "Syncing…" : "Sync now", systemImage: Glyph.refresh)
      }
      .buttonStyle(.virga)
      .disabled(syncing)
    }
  }
}

/// `HowCounted`: "How this is counted", opened in place.
struct HowCounted: View {
  @Environment(\.virgaTheme) private var theme
  let paragraphs: [String]

  var body: some View {
    Disclosure("How this is counted") {
      VStack(alignment: .leading, spacing: theme.space3) {
        ForEach(paragraphs, id: \.self) { p in
          Text(p).virgaText(.textBase).foregroundStyle(theme.ink2).fixedSize(horizontal: false, vertical: true)
        }
      }
    }
  }
}
#endif
