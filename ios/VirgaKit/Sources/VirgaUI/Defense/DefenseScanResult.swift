// Ports src/defense/DefensePage.jsx (ScanResult, ScanNotes, BandRow)
// Ports src/defense/defense.css (.defense-result, .defense-post-quote, .defense-notes, .defense-radar, .defense-near, .defense-row-band)
//
// What a scan found: who engaged, with the post's words (or its address),
// the way to it and Scan again; the scan in figures; what to know about how
// it was counted; the radar, with its table and Export under it; everyone
// near you, closest first, a band at a time; and how many have no
// connection. A mark picked on the radar is found in the list: the band
// filter goes back to all, the list shows down to it, and its row is
// marked.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaDefense
import VirgaInsights
import VirgaPosting

struct ScanResultView: View {
  static let listPage = 40
  /// NEAR_BANDS, in the order the filter offers them.
  static let nearBands: [Band] = [.protected, .connected, .peripheral, .notable]

  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  let archive: ArchiveModel
  let result: ScanResult
  let onRescan: () -> Void
  @State private var band = "all"
  @State private var shown = ScanResultView.listPage
  @State private var picked: String?
  @State private var exporting: ExportFile?

  var body: some View {
    let summary = result.summary
    let model = Radar.scanRadar(summary)
    let totals = summary.totals
    let near = summary.requiresReview
    let fmt = { (n: Int) in AppLocale.fmtInt(Double(n)) }
    let byBand = { (b: Band) in model.byBand[b] ?? 0 }
    let label =
      "Everyone who engaged with the post, placed by how close they are to you. \(fmt(totals.participants)) \(totals.participants == 1 ? "account" : "accounts"): \(byBand(.protected)) protected, \(byBand(.connected)) connected, \(byBand(.peripheral)) peripheral, \(byBand(.notable)) notable and \(fmt(byBand(.unknown))) with no connection. The list below names everyone but those with no connection."
    VStack(alignment: .leading, spacing: 0) {
      head
      FiguresView(
        [
          FigureItem(key: "all", label: "Engaged", value: .number(Double(totals.participants))),
          FigureItem(key: "near", label: "Near you", value: .number(Double(near.count)), note: AnyView(Text("Every band but no connection"))),
          FigureItem(key: "far", label: "No connection", value: .number(Double(totals.byBand[.unknown] ?? 0))),
          FigureItem(
            key: "protected", label: "Protected", value: .number(Double(totals.byBand[.protected] ?? 0)),
            note: AnyView(Text("Never added to a list"))),
        ], label: "The scan in numbers")
      ScanNotesView(summary: summary)
      RadarView(
        model: model, label: label, describe: { PageModel.describeRow($0, summary.vouchCheck) }, onPick: { pick($0, near: near) },
        picked: picked
      )
      .padding(.top, theme.space6)
      table(model)
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("defense-result")
    .toolExporter($exporting)
    nearList(near, totals: totals, vouchCheck: summary.vouchCheck)
    VirgaSection(
      title: "\(fmt(totals.byBand[.unknown] ?? 0)) with no connection",
      sub:
        "Nobody you follow follows them, they don’t follow you, and they aren’t widely followed. They are what a block list built from this post would hold."
    ) {
      EmptyView()
    }
  }

  /// The heading: who engaged, the post's words, and the ways to it and to
  /// a fresh scan.
  private var head: some View {
    let own = archive.data.posts.first { $0.uri.jsEquals(result.post.uri) }
    let link = PostLink.bskyUrlFor(result.post.uri)
    return SectionHead(
      "Who engaged", sub: own.map { ToolPosts.postText($0) } ?? result.post.uri,
      trailing: AnyView(
        HStack(spacing: theme.gap(ThemeKit.headActionsGap).column) {
          if let link, let url = URL(string: link) {
            Button {
              openURL(url)
            } label: {
              Label("Open the post", systemImage: Glyph.externalLink)
            }
            .buttonStyle(.linkAction)
          }
          Button(action: onRescan) {
            Label("Scan again", systemImage: Glyph.rebuild)
          }
          .buttonStyle(.linkAction)
          .accessibilityIdentifier("defense-rescan")
        }
        // Both actions in full beside the title, which takes what they leave:
        // the phone's `.card-head { grid-template-columns: minmax(0, 1fr) auto }`
        // with `.link-action { white-space: nowrap }`.
        .fixedSize(horizontal: true, vertical: false))
    )
    // The post's words are held to two lines (`.defense-post-quote {
    // -webkit-line-clamp: 2 }`); the title and the actions are one line each.
    .lineLimit(2)
    .truncationMode(.tail)
    .padding(.bottom, theme.points(ThemeKit.cardHeadSpaceBelow))
  }

  /// The band × slice counts, under Show as table, with Export.
  private func table(_ model: ScanRadar) -> some View {
    let rows = Radar.radarTable(result.summary)
    let columns = [DataTableColumn("Band")] + model.sectors.map { DataTableColumn($0.name, numeric: true) } + [DataTableColumn("All", numeric: true)]
    return ShowAsTable {
      Button {
        let rows = PageModel.scanCsvRows(result.summary).map { $0.map { Optional($0) } }
        exporting = archive.exportRows("defense-scan", rows)
      } label: {
        Label("Export", systemImage: Glyph.download)
      }
      .buttonStyle(.linkAction)
    } table: {
      // `.an-tableview-scroll > .table`: a chart's table, at least 28rem
      // wide, scrolling inside 20rem under its head.
      ChartTableView(
        columns: columns,
        rows: rows.map { r in
          [BandWords.bandWord[r.band] ?? r.band.rawValue] + r.cells.map { AppLocale.fmtInt(Double($0)) } + [AppLocale.fmtInt(Double(r.total))]
        })
        .accessibilityIdentifier("defense-table")
    }
  }

  /// A mark picked on the radar, found in the list.
  private func pick(_ row: ScanRow, near: [ScanRow]) {
    picked = row.did
    if row.band == .unknown { return }
    band = "all"
    if let at = near.firstIndex(where: { $0.did.jsEquals(row.did) }), at >= shown { shown = at + 1 }
  }

  private func nearList(_ near: [ScanRow], totals: SummaryTotals, vouchCheck: VouchCheck) -> some View {
    let fmt = { (n: Int) in AppLocale.fmtInt(Double(n)) }
    let rows = band == "all" ? near : near.filter { $0.band.rawValue == band }
    let report = ReportArchive(archive)
    let sets = ReportModels.relationSets(report)
    let options =
      [SegmentedOption("all", "All \(fmt(near.count))")]
      + Self.nearBands.filter { (totals.byBand[$0] ?? 0) > 0 }.map { b in
        SegmentedOption(b.rawValue, "\(BandWords.bandWord[b] ?? "") \(fmt(totals.byBand[b] ?? 0))")
      }
    return VirgaSection(
      title: "\(fmt(near.count)) near you",
      sub: "The people a block list built from this post would have to leave alone or look at by name. Closest first."
    ) {
      if !near.isEmpty {
        Segmented(label: "Which band", options: options, selection: band, size: .small) { value in
          band = value
          shown = Self.listPage
        }
        .padding(.bottom, theme.space3)
      }
      if rows.isEmpty {
        ToolEmptyLine("Nobody near you engaged with this post: everyone here has no connection to you.")
      } else {
        LazyVStack(alignment: .leading, spacing: 0) {
          ForEach(Array(rows.prefix(shown)), id: \.did) { row in
            bandRow(row, vouchCheck: vouchCheck, sets: sets)
          }
        }
      }
      if rows.count > shown {
        Button("Show \(fmt(min(Self.listPage, rows.count - shown))) more") { shown += Self.listPage }
          .buttonStyle(.linkAction)
          .padding(.top, theme.points(ThemeKit.cardFootSpaceAbove))
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("defense-near")
  }

  /// `BandRow`: a person row led by their band's mark.
  private func bandRow(_ row: ScanRow, vouchCheck: VouchCheck, sets: RelationSets) -> some View {
    let word = BandWords.bandWord[row.band] ?? ""
    return ToolPersonRow(
      archive: archive, sets: sets, did: row.did,
      card: ToolPersonCard(handle: row.handle, displayName: row.displayName, avatar: row.avatar),
      meta: PageModel.rowFacts(row, vouchCheck),
      lead: AnyView(
        BandMark(band: row.band)
          .frame(width: Measure.Defense.rowBand)
          .accessibilityElement()
          .accessibilityLabel("\(word):")),
      picked: picked.map { $0.jsEquals(row.did) } ?? false)
  }
}

/// `ScanNotes`: what to know about how a scan was counted, shown only when
/// it applies.
struct ScanNotesView: View {
  @Environment(\.virgaTheme) private var theme
  let summary: ScanSummary

  var body: some View {
    let lost = summary.unread.reduce(0) { $0 + $1.count }
    let vouches = summary.vouchCheck != .canary
    let unread = !summary.unread.isEmpty
    if vouches || unread || summary.truncated {
      VStack(alignment: .leading, spacing: theme.space3) {
        if vouches {
          Callout(tone: .warn) {
            Text(
              "Bluesky didn’t say who you know in common with these accounts, so nobody was sorted by it. Anyone who follows you counts as connected instead, and everyone else as having no connection. This happens when you follow few people or none of them follow each other, and when Bluesky’s count is running slow, in which case scanning again in a minute may sort them."
            )
          }
        }
        if unread {
          Callout(tone: .warn) {
            Text(
              "Constellation didn’t answer for some of the engagement (\(AppLocale.fmtInt(Double(lost))) \(lost == 1 ? "record" : "records")), so those accounts aren’t here. Scan again in a minute to try them."
            )
          }
        } else if summary.truncated {
          Callout {
            Text(
              "This post has more engagement than a scan reads, so the longest lists (usually likes) were cut short. Replies and quotes are all here."
            )
          }
        }
      }
      .padding(.top, theme.space5)
    }
  }
}
#endif
