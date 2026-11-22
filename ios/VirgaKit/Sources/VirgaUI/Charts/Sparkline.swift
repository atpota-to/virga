// Ports src/charts/Sparkline.jsx
// Ports src/charts/charts.css (.sparkline)
//
// A small line for a figure's trend: no axes, no labels (the figure beside
// it is the number), 32 tall and as wide as it is given, its stroke 1.5
// whatever the stretch, over the --chart-area wash. Hidden from VoiceOver:
// the figure says it.

#if canImport(UIKit)
import SwiftUI

public struct Sparkline: View {
  @Environment(\.virgaTheme) private var theme
  private let values: [Double]
  private let area: Bool

  public init(values: [Double?], area: Bool = true) {
    self.values = values.compactMap { $0 }.filter(\.isFinite)
    self.area = area
  }

  public var body: some View {
    GeometryReader { geometry in
      if values.count >= 2 {
        let line = path(in: geometry.size)
        ZStack {
          if area {
            washPath(line, in: geometry.size).fill(theme.chartArea)
          }
          line.stroke(theme.chart1, style: StrokeStyle(lineWidth: Measure.Chart.sparkLine, lineCap: .round, lineJoin: .round))
        }
      }
    }
    .frame(height: Measure.Chart.sparkHeight)
    .accessibilityHidden(true)
  }

  /// The line closed along the foot: `L100,30L0,30Z`.
  private func washPath(_ line: Path, in size: CGSize) -> Path {
    var wash = line
    wash.addLine(to: CGPoint(x: size.width, y: size.height))
    wash.addLine(to: CGPoint(x: 0, y: size.height))
    wash.closeSubpath()
    return wash
  }

  /// The web's 100 × 30 box (the line from 2 to 28 down it), stretched.
  private func path(in size: CGSize) -> Path {
    let low = values.min() ?? 0
    let high = values.max() ?? 0
    let span = high - low == 0 ? 1 : high - low
    let sx = size.width / 100
    let sy = size.height / 30
    var path = Path()
    for (i, v) in values.enumerated() {
      let x = Double(i) / Double(values.count - 1) * 100
      let y = 28 - (v - low) / span * 26
      let point = CGPoint(x: x * sx, y: y * sy)
      if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
    }
    return path
  }
}
#endif
