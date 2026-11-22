// Ports src/charts/BarList.jsx
// Ports src/charts/charts.css (.barlist)
//
// Ranked rows, each a label, a bar and its value: the share of the biggest
// row, read at a glance, with the exact number beside it. The label column
// is the list's own: 136 for words (200 when the labels are NSIDs, set a
// step smaller), the bar at least 96 (60), so every list of words on a page
// starts its bars on one line; at most 640 wide. A label that is cut short
// says the whole of it to VoiceOver, with the row's value; the row's title
// (its tooltip on the web) is the hint. In high contrast the track has an
// edge in --line-soft (theme.css).

#if canImport(UIKit)
import SwiftUI
import VirgaCore

/// One row: `{ key, label, value, icon?, display?, title? }`; `code` marks
/// a label that is an NSID.
public struct BarListRow: Identifiable {
  public var key: String
  public var label: String
  public var value: Double
  public var systemImage: String?
  public var display: String?
  public var title: String?
  public var code: Bool

  public var id: String { key }

  public init(
    key: String? = nil, label: String, value: Double, systemImage: String? = nil, display: String? = nil, title: String? = nil,
    code: Bool = false
  ) {
    self.key = key ?? label
    self.label = label
    self.value = value
    self.systemImage = systemImage
    self.display = display
    self.title = title
    self.code = code
  }
}

public struct BarList: View {
  @Environment(\.virgaTheme) private var theme
  private let rows: [BarListRow]
  private let format: (Double) -> String
  private let max: Double?
  private let label: String?

  public init(rows: [BarListRow], format: ((Double) -> String)? = nil, max: Double? = nil, accessibilityLabel: String? = nil) {
    self.rows = rows
    self.format = format ?? { AppLocale.formatNumber($0) }
    self.max = max
    self.label = accessibilityLabel
  }

  public var body: some View {
    if !rows.isEmpty {
      let top = max ?? Swift.max(rows.map(\.value).max() ?? 0, 1)
      let nsids = rows.contains { $0.code }
      Grid(alignment: .leading, horizontalSpacing: Measure.Chart.barColumnGap, verticalSpacing: Measure.Chart.barRowGap) {
        ForEach(rows) { row in
          GridRow {
            HStack(spacing: theme.space2) {
              if let image = row.systemImage {
                Image(systemName: image)
                  .font(.system(size: Measure.Chart.barIcon))
                  .foregroundStyle(theme.muted)
              }
              Text(row.label)
                .virgaText(row.code ? .textSm : .textBase)
                .foregroundStyle(theme.ink2)
                .lineLimit(1)
                .truncationMode(.tail)
            }
            .frame(maxWidth: nsids ? Measure.Chart.barLabelCode : Measure.Chart.barLabel, alignment: .leading)
            GeometryReader { geometry in
              ZStack(alignment: .leading) {
                Capsule().fill(theme.tint)
                Capsule()
                  .fill(theme.chart1)
                  .frame(width: geometry.size.width * CGFloat(top != 0 ? Swift.min(1, Swift.max(0, row.value / top)) : 0))
              }
              // High contrast outlines the track, so an empty one still shows.
              .overlay {
                if theme.isHighContrast, let edge = ThemeKit.highContrastBarTrackEdge.first {
                  Capsule().strokeBorder(theme.color(edge.color ?? .variable(.lineSoft)), lineWidth: theme.points(edge.spread ?? .px(1)))
                }
              }
            }
            .frame(minWidth: nsids ? Measure.Chart.barTrackCode : Measure.Chart.barTrack, maxWidth: .infinity)
            .frame(height: Measure.Chart.barTrackHeight)
            .accessibilityHidden(true)
            Text(row.display ?? format(row.value))
              .virgaText(.textBase, weight: VirgaWeight.semibold)
              .foregroundStyle(theme.ink)
              .lineLimit(1)
              .gridColumnAlignment(.trailing)
          }
          // Read as the web's row is: its label, then its value; the title
          // is the row's tooltip, so it is the hint.
          .accessibilityElement(children: .ignore)
          .accessibilityLabel("\(row.label), \(row.display ?? format(row.value))")
          .accessibilityHint(row.title.flatMap { $0.jsEquals(row.label) ? nil : $0 } ?? "")
        }
      }
      .frame(maxWidth: Measure.Chart.barListMax, alignment: .leading)
      .accessibilityElement(children: .contain)
      .accessibilityLabel(label ?? "")
    }
  }
}
#endif
