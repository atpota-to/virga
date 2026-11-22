// Ports src/tools/ArchiveSearch.jsx
// Ports src/styles/controls.css (.list-toolbar, as the archive search uses it)
//
// Search every post in the archive, by its words, its tags, the sites it
// links to, its kind and its window, sorted by date or by what it earned,
// and take the results (or the whole archive) with you. What narrows the
// list sits over its heading, so the count is right over the rows it
// counts.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights
import VirgaNetwork

struct ArchiveSearchTool: View {
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  let tool: ToolEntry

  var body: some View {
    VirgaPage(header: ToolHeader.header(tool, actions: AnyView(PeriodPicker()))) {
      if let archive {
        ArchiveSearchBody(archive: archive)
          .id(archive.did)
      }
    }
  }
}

/// `matchesWords(post, words)` and the search's own pieces.
enum ArchiveSearch {
  static let page = 30

  /// The kinds of post to narrow to, in the Posted page's words and order.
  static let kinds: [SegmentedOption<String>] = [
    SegmentedOption("all", "All"), SegmentedOption("posts", "Posts"), SegmentedOption("replies", "Replies"),
    SegmentedOption("quotes", "Quotes"), SegmentedOption("media", "With media"), SegmentedOption("links", "With links"),
    SegmentedOption("tags", "With tags"),
  ]

  static let sorts: [(value: String, label: String)] = [
    ("newest", "Newest first"), ("oldest", "Oldest first"), ("engagement", "Most engagement"),
  ]

  /// Whether a post matches every word of a search. A word is looked for in
  /// the post's text and in the sites it links to; a word that starts with
  /// # has to be one of its tags, whole, so #bee doesn't find #bees.
  static func matchesWords(_ post: PostRow, _ words: [String]) -> Bool {
    if words.isEmpty { return true }
    let text = (post.text ?? "").jsLowercased()
    let tags = (post.tags ?? []).map { $0.jsLowercased() }
    let links = (post.links ?? []).joined(separator: " ")
    return words.allSatisfy { w in
      if w.utf16.count > 1 && w.utf16.first == 0x23 {
        let tag = w.jsSlice(1)
        return tags.contains { $0.jsEquals(tag) } || ToolText.words(text).contains { $0.jsEquals(w) }
      }
      return ToolText.includes(text, w) || ToolText.includes(links, w)
    }
  }

  /// The posts the search finds, in the order asked for.
  static func results(_ posts: [PostRow], query: String, kind: String, sort: String, period: AnalyticsPeriod, nowMs: Double) -> [PostRow] {
    let t1 = Periods.periodEnd(period, nowMs)
    let t0 = Periods.periodStart(period, t1) ?? -.infinity
    let words = ToolText.words(query).filter { !$0.isEmpty }
    let zone = AppLocale.activeTimeZone()
    var out: [(p: PostRow, t: Double, e: Double)] = []
    for p in posts {
      let t = JSDate.parse(p.at ?? "", timeZone: zone)
      if !(t >= t0 && t <= t1) { continue }
      let reply = !(p.replyTo ?? "").isEmpty
      if kind == "posts" && reply { continue }
      if kind == "replies" && !reply { continue }
      if kind == "quotes" && (p.quoteOf ?? "").isEmpty { continue }
      if kind == "media" && p.hasMedia != true { continue }
      if kind == "links" && (p.links ?? []).isEmpty { continue }
      if kind == "tags" && (p.tags ?? []).isEmpty { continue }
      if !matchesWords(p, words) { continue }
      out.append((p, t, Double(Analytics.engagementOf(p, "all"))))
    }
    let sorted = JSSort.sort(out) { a, b in
      if sort == "oldest" { return a.t - b.t }
      if sort == "engagement" {
        let d = b.e - a.e
        return d != 0 && !d.isNaN ? d : b.t - a.t
      }
      return b.t - a.t
    }
    return sorted.map(\.p)
  }
}

struct ArchiveSearchBody: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(PreferencesModel.self) private var preferences
  let archive: ArchiveModel
  @State private var query = ""
  @State private var kind = "all"
  @State private var sort = "newest"
  @State private var limit = ArchiveSearch.page
  @State private var exporting: ExportFile?

  var body: some View {
    let period = preferences.period()
    let q = query.jsTrimmed().jsLowercased()
    let results = ArchiveSearch.results(archive.data.posts, query: q, kind: kind, sort: sort, period: period, nowMs: archive.nowMs)
    let shown = Array(results.prefix(limit))
    let count = AppLocale.formatNumber(results.count)
    let now = SyncStatus.now()
    VStack(alignment: .leading, spacing: 0) {
      toolbar
        .padding(.bottom, theme.space4)
      SectionHead(
        "\(count) \(results.count == 1 ? "post" : "posts") in \(Periods.periodPhrase(period))\(q.isEmpty ? "" : " matching “\(query.jsTrimmed())”")",
        sub: ReportModels.contentReady(ReportArchive(archive))
          ? nil : "Until your next sync, older posts are searched by their first 200 characters only, and not by tag or site.",
        trailing: AnyView(exportMenu(results))
      )
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("archive-results")
      .padding(.bottom, theme.points(ThemeKit.flushHeadSpaceBelow))
      Rectangle().fill(theme.color(ThemeKit.flushHeadRule)).frame(height: theme.points(ThemeKit.flushHeadRule))
      if shown.isEmpty {
        EmptyState("Nothing matches.").padding(.top, theme.rowPad)
      } else {
        LazyVStack(alignment: .leading, spacing: 0) {
          ForEach(shown, id: \.uri) { post in
            ToolPostRow(post: post, did: archive.did, now: now)
          }
        }
      }
      ShowMoreFoot(shown: shown.count, total: results.count, page: ArchiveSearch.page) { limit += ArchiveSearch.page }
      CardCaption("The archive keeps the first 200 characters of each post, so a search finds words in that part. Counts are as of the last sync.")
    }
    .exportSheet($exporting)
    .onChange(of: query) { _, _ in limit = ArchiveSearch.page }
  }

  private var toolbar: some View {
    let phone = theme.isPhone
    return FlowLayout(
      spacing: phone ? Measure.Tools.phoneToolbarColumnGap : Measure.Tools.toolbarColumnGap, lineSpacing: Measure.Tools.toolbarRowGap,
      alignment: .center
    ) {
      SearchField("Search words, #tags or sites", text: $query)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .accessibilityLabel("Search your posts")
        .frame(
          width: phone ? theme.windowWidth - theme.pagePad * 2 : nil,
          alignment: .leading
        )
        .frame(minWidth: phone ? nil : Measure.Tools.toolbarSearchMin, maxWidth: phone ? nil : Measure.Tools.toolbarSearchMax)
      Segmented(label: "Kind of post", options: ArchiveSearch.kinds, selection: kind, size: .small) { k in
        kind = k
        limit = ArchiveSearch.page
      }
      InlineSelect(label: "Sort", options: ArchiveSearch.sorts, selection: $sort)
    }
  }

  private func exportMenu(_ results: [PostRow]) -> some View {
    ExportMenu(entries: [
      .item(
        MenuItem(
          "These \(AppLocale.formatNumber(results.count)) posts (CSV)", key: "these", hint: "What the search shows, newest first.",
          systemImage: Glyph.download
        ) { exporting = archive.exportPosts(results) }),
      .item(
        MenuItem("Every post (CSV)", key: "posts", hint: "The whole post archive with its counts.", systemImage: Glyph.download) {
          exporting = archive.exportPosts()
        }),
      .item(
        MenuItem(
          "Everything (JSON)", key: "everything", hint: "Posts, followers, blocks, engagement and repo records.",
          systemImage: Glyph.download
        ) { exporting = try? archive.exportArchive() }),
    ])
  }
}
#endif
