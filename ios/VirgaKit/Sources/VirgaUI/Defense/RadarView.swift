// Ports src/defense/Radar.jsx
// Ports src/defense/defense.css (.radar, .radar-stage, .radar-labels, .radar-callout, .radar-legend, .band-mark)
//
// The radar: who engaged with a post, drawn as rings round you. You are the
// dot at the centre. The rings, from the inside: the people nothing will
// ever add (protected, behind a dashed edge because nothing crosses it),
// then connected, then peripheral, and the wide outer ring of everyone with
// no connection to you, notable accounts among them. A slice is what they
// did to the post. The people near you are a mark each; the strangers are
// texture, with their count written in their slice.
//
// The web's SVG, drawn in a Canvas in the same units (a square 1000
// across, scaled to the stage), every place from VirgaDefense's Radar
// (place, texture, sectorAngles), which fixtures hold to the web. Ink for
// the protected (a ring with nothing inside), the accent for the
// connected, the second colour for the peripheral, ink-2 for the notable
// as a diamond, and the chart's ghost grey for the strangers. The slices'
// words and the strangers' counts sit over it, as the web's labels do.
//
// A finger is the pointer: a press on a mark shows its callout and picks
// it (the list under the radar marks the account and shows it); a press
// elsewhere clears it. VoiceOver reads the picture's summary, and swiping
// up and down walks the accounts near you in the arrow keys' order, saying
// each; a double tap picks the one said. The counts are in the table under
// it and every account near you is in the list on the page.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaDefense

struct RadarView: View {
  @Environment(\.virgaTheme) private var theme
  let model: ScanRadar
  let label: String
  let describe: (ScanRow) -> RowDescription
  var onPick: ((ScanRow) -> Void)? = nil
  var picked: String? = nil
  @State private var hover: String?
  @State private var said = ""

  var body: some View {
    let n = model.sectors.count
    let placed = Radar.place(model.points, n)
    VStack(spacing: theme.space4) {
      GeometryReader { geometry in
        stage(side: geometry.size.width, placed: placed)
      }
      .aspectRatio(1, contentMode: .fit)
      .frame(maxWidth: Measure.Defense.radarMax)
      RadarLegend(byBand: model.byBand)
    }
    .frame(maxWidth: .infinity)
  }

  private func stage(side: CGFloat, placed: [PlacedPoint]) -> some View {
    let n = model.sectors.count
    let reach = Measure.Defense.radarReach(n)
    let order = Radar.walkOrder(placed)
    let current = hover.flatMap { id in placed.first { $0.id.jsEquals(id) } }
    return RadarDrawing(model: model, placed: placed, picked: picked, hover: current, theme: theme)
      .frame(width: side, height: side)
      .overlay(alignment: .topLeading) { RadarLabels(model: model, reach: reach, side: side) }
      .overlay(alignment: .topLeading) {
        if let current, let row = current.row {
          RadarCallout(description: describe(row), point: current, reach: reach, side: side)
        }
      }
    .contentShape(Rectangle())
    .gesture(
      SpatialTapGesture().onEnded { value in
        let x = (Double(value.location.x) - Double(side) / 2) / (reach * Double(side))
        let y = (Double(value.location.y) - Double(side) / 2) / (reach * Double(side))
        let within = Measure.Defense.radarHit / (reach * Double(side))
        if let hit = Radar.nearest(placed, x, y, within * 1.4) {
          hover = hit.id
          if let row = hit.row { onPick?(row) }
        } else {
          hover = nil
        }
      }
    )
    .accessibilityElement()
    .accessibilityLabel(label)
    .accessibilityValue(said)
    .accessibilityHint(order.isEmpty ? "" : "Arrow keys move between the accounts near you\(onPick != nil ? "; Enter finds one in the list below" : "").")
    .accessibilityAdjustableAction { direction in
      guard !order.isEmpty else { return }
      let step = direction == .increment ? 1 : -1
      let at = hover.flatMap { id in order.firstIndex { $0.id.jsEquals(id) } } ?? (step > 0 ? -1 : 0)
      let next = order[(at + step + order.count) % order.count]
      hover = next.id
      if let row = next.row {
        let words = describe(row)
        said = ([words.title] + words.lines).joined(separator: ". ")
      }
    }
    .accessibilityAction {
      if let current, let row = current.row { onPick?(row) }
    }
    .accessibilityIdentifier("defense-radar")
  }
}

/// The SVG: the rings' grounds and edges, the slices' axes, the strangers'
/// texture, a mark for each account near you, the picked and pointed rings,
/// and you.
struct RadarDrawing: View {
  let model: ScanRadar
  let placed: [PlacedPoint]
  let picked: String?
  let hover: PlacedPoint?
  let theme: VirgaTheme

  var body: some View {
    let n = model.sectors.count
    let reach = Measure.Defense.radarReach(n)
    let slices = Radar.sectorAngles(n)
    let dust = Radar.texture(model.sectors.map(\.far))
    // Larger marks last, so the connected are drawn over the rest.
    let marks = placed.filter { $0.band != .connected } + placed.filter { $0.band == .connected }
    Canvas { context, size in
      let size1000 = Measure.Defense.radarSize
      context.scaleBy(x: size.width / CGFloat(size1000), y: size.height / CGFloat(size1000))
      let c = size1000 / 2
      let r = reach * size1000
      func px(_ v: Double) -> Double { c + v * r }
      func circle(_ radius: Double, _ x: Double = c, _ y: Double = c) -> Path {
        Path(ellipseIn: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2))
      }
      let line = StrokeStyle(lineWidth: CGFloat(Measure.Defense.radarLine))
      let edge = { (ring: Ring) in Radar.edges[ring] ?? 1 }
      // The outer ring, where the strangers are; the inner ones over it.
      context.fill(circle(edge(.outer) * r), with: .color(theme.tint))
      context.fill(circle(edge(.peripheral) * r), with: .color(theme.bg))
      for ring in [Ring.peripheral, .connected, .outer] {
        context.stroke(circle(edge(ring) * r), with: .color(theme.line2), style: line)
      }
      context.stroke(
        circle(edge(.protected) * r), with: .color(theme.ink),
        style: StrokeStyle(lineWidth: CGFloat(Measure.Defense.radarLine), dash: Measure.Defense.radarProtectedDash))
      for s in slices {
        var axis = Path()
        axis.move(to: CGPoint(x: c + cos(s.start) * edge(.protected) * r, y: c + sin(s.start) * edge(.protected) * r))
        axis.addLine(to: CGPoint(x: c + cos(s.start) * r, y: c + sin(s.start) * r))
        context.stroke(axis, with: .color(theme.line), style: line)
      }
      let half = Measure.Defense.radarDust / 2
      for d in dust {
        context.fill(
          Path(CGRect(x: px(d.x) - half, y: px(d.y) - half, width: Measure.Defense.radarDust, height: Measure.Defense.radarDust)),
          with: .color(theme.chartGhost))
      }
      let ring = StrokeStyle(lineWidth: CGFloat(Measure.Defense.radarRing))
      for p in marks {
        let x = px(p.x)
        let y = px(p.y)
        let m = p.band == .connected ? Measure.Defense.radarMarkConnected : Measure.Defense.radarMark
        switch p.band {
        case .protected:
          context.fill(circle(m - 1, x, y), with: .color(theme.bg))
          context.stroke(circle(m - 1, x, y), with: .color(theme.ink), style: ring)
        case .notable:
          let d = m + 1.5
          var diamond = Path()
          diamond.move(to: CGPoint(x: x, y: y - d))
          diamond.addLine(to: CGPoint(x: x + d, y: y))
          diamond.addLine(to: CGPoint(x: x, y: y + d))
          diamond.addLine(to: CGPoint(x: x - d, y: y))
          diamond.closeSubpath()
          context.fill(diamond, with: .color(theme.ink2))
        default:
          context.fill(circle(m, x, y), with: .color(p.band == .connected ? theme.accent : theme.second))
        }
        if let picked, picked.jsEquals(p.id) {
          context.stroke(circle(m + Measure.Defense.radarPickedOut, x, y), with: .color(theme.accent), style: ring)
        }
      }
      if let hover {
        context.stroke(circle(Measure.Defense.radarHover, px(hover.x), px(hover.y)), with: .color(theme.ink), style: ring)
      }
      context.fill(circle(Measure.Defense.radarYou), with: .color(theme.ink))
    }
    .accessibilityHidden(true)
  }
}

/// The slices' names and how many did each, the strangers' counts over
/// their texture, and You under the centre.
struct RadarLabels: View {
  @Environment(\.virgaTheme) private var theme
  let model: ScanRadar
  let reach: Double
  let side: CGFloat

  var body: some View {
    let n = model.sectors.count
    let slices = Radar.sectorAngles(n)
    let four = n == 4
    ZStack(alignment: .topLeading) {
      ForEach(Array(model.sectors.enumerated()), id: \.element.key) { i, s in
        let words = VStack(alignment: four && (i == 0 || i == 1) ? .trailing : (four ? .leading : .center), spacing: 0) {
          Text(s.name).virgaText(.textSm, weight: VirgaWeight.semibold, lineHeight: Measure.Defense.radarSectorLineHeight).foregroundStyle(theme.ink)
          Text(AppLocale.fmtInt(Double(s.total))).virgaText(.textSm, lineHeight: Measure.Defense.radarSectorLineHeight).foregroundStyle(theme.muted)
        }
        .multilineTextAlignment(four && (i == 0 || i == 1) ? .trailing : (four ? .leading : .center))
        .fixedSize()
        if four {
          words.frame(width: side, height: side, alignment: Self.corner(i))
        } else {
          words.position(at(slices[i].mid, reach + Measure.Defense.radarSectorOut))
        }
      }
      ForEach(Array(model.sectors.enumerated()), id: \.element.key) { i, s in
        if s.far > 0 {
          Text("\(AppLocale.fmtInt(Double(s.far))) \(s.far == 1 ? "stranger" : "strangers")")
            .virgaText(.textXs, weight: VirgaWeight.medium)
            .foregroundStyle(theme.ink2)
            .padding(.vertical, Measure.Defense.radarFarPaddingV)
            .padding(.horizontal, Measure.Defense.radarFarPaddingH)
            .background(RoundedRectangle(cornerRadius: theme.radiusSm).fill(theme.bg))
            .fixedSize()
            .position(at(slices[i].mid, Measure.Defense.radarFarAt * reach))
        }
      }
      // Its top 9 under the centre: the protected ring is crowded on a busy
      // post, so the page's ground glows round the word.
      Text("You")
        .virgaText(.textXs, weight: VirgaWeight.semibold)
        .foregroundStyle(theme.ink)
        .shadow(color: theme.bg, radius: 1)
        .shadow(color: theme.bg, radius: 2)
        .shadow(color: theme.bg, radius: 3)
        .fixedSize()
        .position(x: side / 2, y: side / 2 + Measure.Defense.radarYouBelow + theme.textXs * 0.6)
    }
    .frame(width: side, height: side, alignment: .topLeading)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  /// A point `distance` (a share of the square) out from the centre at `angle`.
  private func at(_ angle: Double, _ distance: Double) -> CGPoint {
    CGPoint(x: side * CGFloat(0.5 + cos(angle) * distance), y: side * CGFloat(0.5 + sin(angle) * distance))
  }

  /// `.radar-corner-<i>`: top right, bottom right, bottom left, top left.
  static func corner(_ i: Int) -> Alignment {
    switch i {
    case 0: return .topTrailing
    case 1: return .bottomTrailing
    case 2: return .bottomLeading
    default: return .topLeading
    }
  }
}

/// `.radar-callout`: the pointed account's name and what is known of it,
/// to the side of its mark with more room.
struct RadarCallout: View {
  @Environment(\.virgaTheme) private var theme
  let description: RowDescription
  let point: PlacedPoint
  let reach: Double
  let side: CGFloat

  var body: some View {
    let x = side * CGFloat(0.5 + point.x * reach)
    let top = side * min(0.78, max(0.02, CGFloat(0.5 + point.y * reach) - 0.04))
    let right = point.x < 0.12
    VStack(alignment: .leading, spacing: Measure.Defense.calloutGap) {
      Text(description.title)
        .virgaText(.textSm, weight: VirgaWeight.semibold, lineHeight: Measure.Defense.calloutLineHeight)
        .foregroundStyle(theme.ink)
      ForEach(Array(description.lines.enumerated()), id: \.offset) { _, line in
        Text(line)
      }
    }
    .virgaText(.textSm, lineHeight: Measure.Defense.calloutLineHeight)
    .foregroundStyle(theme.ink2)
    .fixedSize(horizontal: false, vertical: true)
    .padding(.vertical, Measure.Defense.calloutPaddingV)
    .padding(.horizontal, Measure.Defense.calloutPaddingH)
    .frame(maxWidth: min(Measure.Defense.calloutMax, side * Measure.Defense.calloutShare), alignment: .leading)
    .background(RoundedRectangle(cornerRadius: theme.radius).fill(theme.surface))
    .overlay(RoundedRectangle(cornerRadius: theme.radius).strokeBorder(theme.line, lineWidth: 1))
    .virgaShadow(theme.shadow(theme.tokens.shadow(.shadowMd) ?? []))
    .alignmentGuide(.leading) { d in right ? -Measure.Defense.calloutOffset : d.width + Measure.Defense.calloutOffset }
    .alignmentGuide(.top) { _ in 0 }
    .offset(x: x, y: top)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}

/// `Legend`: what each mark means, with how many there are of each.
struct RadarLegend: View {
  @Environment(\.virgaTheme) private var theme
  let byBand: [Band: Int]

  var body: some View {
    FlowLayout(spacing: Measure.Defense.legendColumnGap, lineSpacing: Measure.Defense.legendRowGap, alignment: .center) {
      ForEach(Score.bands, id: \.self) { band in
        HStack(spacing: Measure.Defense.legendItemGap) {
          BandMark(band: band)
          Text(BandWords.bandWord[band] ?? "").foregroundStyle(theme.muted)
          Text(AppLocale.fmtInt(Double(byBand[band] ?? 0))).foregroundStyle(theme.ink2)
        }
        .virgaText(.textSm)
        .accessibilityElement(children: .combine)
      }
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("What the marks mean")
  }
}

/// `BandMark`: a band's mark, for the legend and the lists.
struct BandMark: View {
  @Environment(\.virgaTheme) private var theme
  let band: Band

  var body: some View {
    let theme = self.theme
    let band = self.band
    Canvas { context, size in
      let k = size.width / 12
      context.scaleBy(x: k, y: k)
      func circle(_ r: CGFloat) -> Path { Path(ellipseIn: CGRect(x: 6 - r, y: 6 - r, width: r * 2, height: r * 2)) }
      switch band {
      case .protected:
        context.fill(circle(4), with: .color(theme.bg))
        context.stroke(circle(4), with: .color(theme.ink), style: StrokeStyle(lineWidth: 1.6))
      case .notable:
        var diamond = Path()
        diamond.move(to: CGPoint(x: 6, y: 1.5))
        diamond.addLine(to: CGPoint(x: 10.5, y: 6))
        diamond.addLine(to: CGPoint(x: 6, y: 10.5))
        diamond.addLine(to: CGPoint(x: 1.5, y: 6))
        diamond.closeSubpath()
        context.fill(diamond, with: .color(theme.ink2))
      case .unknown:
        context.fill(Path(CGRect(x: 4, y: 4, width: 4, height: 4)), with: .color(theme.chartGhost))
      default:
        context.fill(circle(4.5), with: .color(band == .connected ? theme.accent : theme.second))
      }
    }
    .frame(width: Measure.Defense.bandMark, height: Measure.Defense.bandMark)
    .accessibilityHidden(true)
  }
}
#endif
