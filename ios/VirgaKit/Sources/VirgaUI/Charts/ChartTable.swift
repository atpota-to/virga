// Ports src/charts/ChartTable.jsx
// Ports src/charts/charts.css (.an-tableview)
// Ports src/styles/controls.css (.chart-foot)
//
// Every chart's plain twin: the same buckets as a table, opened from the
// line under the chart ("Show as table", a link action), so no value is
// reachable only by a press on the chart. The line also carries the
// chart's other actions after it, each a finger's 44 points tall with its
// words in the middle and no gap between wrapped lines (controls.css's
// touch rules), which is already the room the table wants under the line.
// Newest first; the trend's column takes the name the chart's legend gives
// it ("7-day average"). The table sits at the column's leading edge, as wide
// as its columns need and at least min(100%, 28rem); it keeps to 320 points
// and scrolls inside, under its head, which stays put; it scrolls sideways
// in its own box when its columns need more room than the page.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore

/// `.chart-foot` with "Show as table", then `actions`; the table under it.
public struct ShowAsTable<Actions: View, Table: View>: View {
  @Environment(\.virgaTheme) private var theme
  @State private var open = false
  private let actions: Actions
  private let trailing: AnyView?
  private let table: Table

  /// - Parameter trailing: a ⋯ at the line's end (a phone's, holding what
  ///   `actions` would say in words), its dots on the column's edge.
  public init(@ViewBuilder actions: () -> Actions, trailing: AnyView? = nil, @ViewBuilder table: () -> Table) {
    self.actions = actions()
    self.trailing = trailing
    self.table = table()
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: theme.gap(ThemeKit.chartFootGap).column) {
        FlowLayout(spacing: theme.gap(ThemeKit.chartFootGap).column, lineSpacing: 0) {
          Button {
            open.toggle()
          } label: {
            Label("Show as table", systemImage: Glyph.table)
          }
          .buttonStyle(.linkAction(isOpen: open))
          .modifier(ChartFootAction())
          .accessibilityValue(open ? "Open" : "Closed")
          .accessibilityIdentifier("show-as-table")
          Group { actions }
            .modifier(ChartFootAction())
        }
        if let trailing {
          Spacer(minLength: 0)
          trailing.padding(.trailing, -Measure.Chart.footMenuBleed)
        }
      }
      .padding(.top, theme.points(ThemeKit.chartFootSpaceAbove))
      if open {
        // On touch the line's 44 points already leave the room under it.
        table
      }
    }
  }
}

/// `.chart-foot .link-action` on touch: 44 points tall, its words in the
/// middle, pressed anywhere in that height.
struct ChartFootAction: ViewModifier {
  func body(content: Content) -> some View {
    content
      .frame(minHeight: Measure.Touch.target)
      .contentShape(Rectangle())
  }
}

extension ShowAsTable where Actions == EmptyView {
  public init(trailing: AnyView? = nil, @ViewBuilder table: () -> Table) {
    self.init(actions: { EmptyView() }, trailing: trailing, table: table)
  }
}

public struct ChartTable<Actions: View>: View {
  private let series: [ChartPoint]
  private let secondary: [ChartPoint]?
  private let trend: [ChartPoint]?
  private let unit: AnalyticsUnit
  private let valueHead: String
  private let secondaryHead: String?
  private let format: (Double?) -> String
  private let trendFormat: (Double?) -> String
  private let actions: Actions
  private let trailing: AnyView?

  /// - Parameters:
  ///   - format: nil is `fmtCount` (and the trend's averages keep their
  ///     decimal, as in the chart's readout).
  ///   - trailing: a ⋯ at the end of the line under the chart.
  public init(
    series: [ChartPoint], secondary: [ChartPoint]? = nil, trend: [ChartPoint]? = nil, unit: AnalyticsUnit, valueHead: String,
    secondaryHead: String? = nil, format: ((Double?) -> String)? = nil, trailing: AnyView? = nil, @ViewBuilder actions: () -> Actions
  ) {
    self.trailing = trailing
    self.series = series
    self.secondary = secondary
    self.trend = trend
    self.unit = unit
    self.valueHead = valueHead
    self.secondaryHead = secondaryHead
    self.format = format ?? { ChartFormat.fmtCount($0) }
    self.trendFormat = format ?? { ChartFormat.fmtAverage($0) }
    self.actions = actions()
  }

  public var body: some View {
    if !series.isEmpty {
      ShowAsTable(actions: { actions }, trailing: trailing) {
        ChartTableView(columns: columns, rows: rows)
      }
    }
  }

  private var columns: [DataTableColumn] {
    var out = [DataTableColumn(unit == .month ? "Month" : unit == .week ? "Week" : "Day"), DataTableColumn(valueHead, numeric: true)]
    if secondary != nil { out.append(DataTableColumn(secondaryHead ?? "Compared series", numeric: true)) }
    if let trend {
      out.append(
        DataTableColumn(
          ChartFormat.trendName(series.map(\.seriesPoint), trend.map { TrendPoint(t: $0.t, v: $0.v) }, unit), numeric: true))
    }
    return out
  }

  private var rows: [[String]] {
    series.indices.reversed().map { i in
      var row = [Analytics.bucketLabel(series[i].t, unit), format(series[i].v)]
      if let secondary { row.append(ChartFormat.fmtCount(secondary.indices.contains(i) ? secondary[i].v ?? 0 : 0)) }
      if let trend {
        let v = trend.indices.contains(i) ? trend[i].v : nil
        row.append(v == nil ? "—" : trendFormat(v))
      }
      return row
    }
  }
}

extension ChartTable where Actions == EmptyView {
  public init(
    series: [ChartPoint], secondary: [ChartPoint]? = nil, trend: [ChartPoint]? = nil, unit: AnalyticsUnit, valueHead: String,
    secondaryHead: String? = nil, format: ((Double?) -> String)? = nil, trailing: AnyView? = nil
  ) {
    self.init(
      series: series, secondary: secondary, trend: trend, unit: unit, valueHead: valueHead, secondaryHead: secondaryHead,
      format: format, trailing: trailing, actions: { EmptyView() })
  }
}

/// `.an-tableview`: a chart's (or a group's) table, the kit's DataTable in
/// TableScroll, its head held over the rows as they scroll: at the
/// column's start, at least min(100%, 28rem) wide, at most 20rem tall.
struct ChartTableView: View {
  let columns: [DataTableColumn]
  let rows: [[String]]

  var body: some View {
    TableScroll(
      maxHeight: Measure.Chart.tableMaxHeight,
      head: { DataTable(columns: columns, rows: rows, part: .head, chart: true) }
    ) {
      DataTable(columns: columns, rows: rows, part: .rows, chart: true)
    }
    .accessibilityIdentifier("chart-table")
  }
}
#endif
