// Ports src/tools/BestTime.jsx
// Ports src/tools/tools.css (.best-list, .best-days, .best-table)
//
// When your posts earn the most: engagement per post by the weekday and
// hour each was made, in the device's time zone, from your own history.
// Your posts and threads only; replies to other people earn differently.
// What the page found comes first, in a sentence; then the heatmap with
// its hours per column, the caption that says how to read it and every
// slot as a table; then the best slots beside the weekdays. A short period
// holds too few posts to say anything, so it reads the year, and the
// picker offers only the windows it can read, with the one in use pressed.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

struct BestTimeTool: View {
  @Environment(PreferencesModel.self) private var preferences
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  let tool: ToolEntry
  @State private var block = 2

  var body: some View {
    let window = WidgetParts.bestTimeWindow(preferences.period())
    let effective = window.isCustom ? PeriodPicker.customKey : window.key
    VirgaPage(
      header: ToolHeader.header(tool, actions: AnyView(PeriodPicker(options: ["90d", "1y", "all", PeriodPicker.customKey], effective: effective)))
    ) {
      if let archive {
        BestTimeBody(archive: ReportArchive(archive), window: window, block: $block)
      }
    }
  }
}

struct BestTimeBody: View {
  @Environment(\.virgaTheme) private var theme
  let archive: ReportArchive
  let window: AnalyticsPeriod
  @Binding var block: Int

  var body: some View {
    let m = ReportModels.bestTimeModel(archive, window, archive.nowMs ?? SyncStatus.now(), block: block)
    let sentence = WidgetParts.bestTimeSentence(m)
    let zone = AppLocale.activeTimeZone().identifier.replacingOccurrences(of: "_", with: " ")
    let phone = theme.isPhone
    let hours = Segmented(
      label: "Hours per column",
      options: [SegmentedOption(1, "Hourly"), SegmentedOption(2, "2 hours"), SegmentedOption(4, "4 hours")],
      selection: $block, size: .small)
    ToolStatement(text: sentence)
      .accessibilityIdentifier("best-time-statement")
    VirgaSection {
      // The heading, with the hours per column at its right; on a phone
      // under its words, 8 below them (`.card-head > .segmented` at 560).
      VStack(alignment: .leading, spacing: 0) {
        SectionHead(
          "What a typical post earns, by when it was posted",
          sub: "\(AppLocale.formatNumber(m.posts)) posts and threads over \(Periods.periodPhrase(window)), in \(zone) time",
          trailing: phone ? nil : AnyView(hours))
        if phone {
          hours.padding(.top, Measure.Tools.phoneHeadControlSpaceAbove)
        }
      }
      .padding(.bottom, theme.points(ThemeKit.cardHeadSpaceBelow))
      Heatmap(
        rows: WidgetParts.bestTimeRows(m), columns: ReportModels.hourColumns(block).map { HeatmapColumn(label: $0.label, span: $0.span) },
        summary: sentence, cellHeight: block == 1 ? 22 : 30)
      ToolCaption(
        "Each slot shows its typical post (the median), so one post that went round doesn’t make its hour look like the best time forever. The ringed slot is the best. A slot with fewer than \(ReportModels.bestTimeMinPosts) posts is left as an outline: too few to say anything. Posts from the last two days are still collecting engagement and are left out."
      )
      ShowAsTable {
        BestTimeTable(rows: Self.tableRows(m, block: block))
      }
    }
    ToolSplit(columnGap: theme.gridGapX, rowGap: theme.gridGap) {
      BestTimeSlots(m: m, block: block)
      VirgaSection(title: "By weekday", flush: true) {
        BarList(
          rows: ReportModels.weekdayOrder().compactMap { day in m.byDay.first { $0.day == day } }.map { d in
            BarListRow(
              key: "\(d.day)", label: ReportModels.weekdays[d.day], value: d.avg ?? 0,
              display: d.avg == nil ? "—" : ChartFormat.fmtRate(d.avg), title: "\(d.posts) posts")
          },
          format: { ChartFormat.fmtRate($0) }, accessibilityLabel: "What a typical post earns, by weekday"
        )
        .padding(.top, Measure.Tools.bestDaysSpaceAbove)
        ToolCaption("What a typical post earns.")
      }
    }
  }

  /// Every slot with posts, the reader's week in order.
  static func tableRows(_ m: BestTimeReport, block: Int) -> [[String]] {
    ReportModels.weekdayOrder().flatMap { day -> [[String]] in
      guard m.rows.indices.contains(day) else { return [] }
      return m.rows[day].cells.enumerated().filter { $0.element.posts > 0 }.map { col, c in
        [
          "\(ReportModels.weekdaysLong[day]), \(ReportModels.hourRange(col, block))", "\(c.posts)",
          c.avg == nil ? "—" : ChartFormat.fmtRate(c.avg),
        ]
      }
    }
  }
}

/// `.best-table`: every slot with posts, the whole section wide, scrolling
/// inside 24rem under a head that stays put on the page's ground
/// (charts.css `.an-tableview .table thead th { position: sticky }`). Each
/// number column keeps the width of its widest value or its head, so the
/// head and the rows line up.
struct BestTimeTable: View {
  @Environment(\.virgaTheme) private var theme
  let rows: [[String]]

  static let heads = ["When", "Posts", "Typical post"]

  var body: some View {
    let widest = [1, 2].map { column in rows.map { $0.indices.contains(column) ? $0[column] : "" }.max { $0.count < $1.count } ?? "" }
    ScrollView(.vertical) {
      LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
        Section {
          ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
            line(row, widest: widest)
            Rectangle().fill(theme.color(ThemeKit.tableRowRule)).frame(height: 1)
          }
        } header: {
          head(widest: widest)
        }
      }
    }
    .frame(maxHeight: Measure.Tools.bestTableMaxHeight)
    .accessibilityElement(children: .contain)
  }

  private func head(widest: [String]) -> some View {
    HStack(alignment: .bottom, spacing: 0) {
      headText(Self.heads[0])
        .frame(maxWidth: .infinity, alignment: .leading)
      numberCell(Self.heads[1], column: 1, widest: widest[0], isHead: true)
      numberCell(Self.heads[2], column: 2, widest: widest[1], isHead: true)
    }
    .padding(.top, Measure.Tools.stickyHeadSpaceAbove)
    .padding(.bottom, theme.points(ThemeKit.tableHeadSpaceBelow))
    .background(theme.bg)
    .overlay(alignment: .bottom) {
      Rectangle().fill(theme.color(ThemeKit.tableHeadRule)).frame(height: 1)
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isHeader)
  }

  private func line(_ row: [String], widest: [String]) -> some View {
    let pad = theme.insets(ThemeKit.tableCellPadding)
    return HStack(alignment: .firstTextBaseline, spacing: 0) {
      Text(row.first ?? "")
        .virgaText(.textBase)
        .foregroundStyle(theme.ink)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
      numberCell(row.count > 1 ? row[1] : "", column: 1, widest: widest[0], isHead: false)
      numberCell(row.count > 2 ? row[2] : "", column: 2, widest: widest[1], isHead: false)
    }
    .padding(.top, pad.top)
    .padding(.bottom, pad.bottom)
    .accessibilityElement(children: .combine)
  }

  private func headText(_ text: String) -> some View {
    Text(text)
      .virgaText(.textSm, weight: ThemeKit.tableHeadWeight)
      .foregroundStyle(theme.muted)
      .lineLimit(1)
  }

  /// A number column's cell, as wide as its head and its widest value.
  private func numberCell(_ text: String, column: Int, widest: String, isHead: Bool) -> some View {
    let pad = theme.insets(ThemeKit.tableCellPadding)
    let last = column == Self.heads.count - 1
    return ZStack(alignment: .trailing) {
      headText(Self.heads[column]).hidden()
      Text(widest).virgaText(.textBase).hidden()
      if isHead {
        headText(text)
      } else {
        Text(text).virgaText(.textBase).foregroundStyle(theme.ink)
      }
    }
    .lineLimit(1)
    .fixedSize()
    .padding(.leading, pad.leading)
    .padding(.trailing, last ? 0 : pad.trailing)
    .accessibilityHidden(isHead ? false : text.isEmpty)
  }
}

/// The best slots: rank, when, what a typical post there earns, and how
/// many posts that comes from (on a phone, a meta line under the slot).
struct BestTimeSlots: View {
  @Environment(\.virgaTheme) private var theme
  let m: BestTimeReport
  let block: Int

  var body: some View {
    VirgaSection(title: "The best slots", trailing: AnyView(MoreLink("Use them in the weekly schedule", to: "/posting/schedule")), flush: true) {
      if m.best.isEmpty {
        ToolEmptyLine("Not enough posts in this window yet.")
      } else {
        ForEach(Array(m.best.enumerated()), id: \.offset) { index, b in
          slot(index, b)
        }
      }
    }
  }

  private func slot(_ index: Int, _ b: BestTimeSlot) -> some View {
    let when = "\(ReportModels.weekdaysLong[b.day]), \(ReportModels.hourRange(b.col, block))"
    let posts = "\(b.posts) \(b.posts == 1 ? "post" : "posts")"
    let rank = Text("\(index + 1)").foregroundStyle(theme.muted).frame(width: Measure.Tools.bestRank, alignment: .leading)
    let avg = Text("\(ChartFormat.fmtRate(b.avg)) typical").virgaText(.textBase, weight: VirgaWeight.semibold).foregroundStyle(theme.ink)
    return Group {
      if theme.isPhone {
        HStack(alignment: .firstTextBaseline, spacing: Measure.Tools.bestGap) {
          rank
          VStack(alignment: .leading, spacing: Measure.Tools.phoneBestLineGap) {
            Text(when).virgaText(.textMd, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
            Text(posts).virgaText(.textSm).foregroundStyle(theme.muted)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          avg
        }
      } else {
        HStack(alignment: .firstTextBaseline, spacing: Measure.Tools.bestGap) {
          rank
          Text(when).virgaText(.textMd, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
            .frame(maxWidth: .infinity, alignment: .leading)
          avg
          Text(posts).foregroundStyle(theme.muted).frame(minWidth: Measure.Tools.bestPosts, alignment: .trailing)
        }
      }
    }
    .virgaText(.textBase)
    .padding(.vertical, theme.rowPad)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .combine)
  }
}
#endif
