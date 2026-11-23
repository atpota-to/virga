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
// each; a double tap picks the one said and says it is marked in the list
// (focus stays on the radar, where the web's Enter moves it to the row's
// link). The hint names those gestures, not the web's keys. The counts
// are in the table under it and every account near you is in the list on
// the page.

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
      RadarLegend(byBand: model.byBand)
    }
    // `.radar { max-width: 600px; margin: 0 auto }` holds the stage and the
    // legend both, so the legend wraps within the radar's width.
    .frame(maxWidth: Measure.Defense.radarMax)
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
    // VoiceOver's gestures, not the web's arrow keys and Enter: the stage
    // takes no keyboard focus here.
    .accessibilityHint(
      order.isEmpty
        ? "" : "Swipe up or down to move between the accounts near you\(onPick != nil ? "; double-tap to mark the one said in the list below" : "").")
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
      // The web's Enter moves focus to the row's link; here focus stays,
      // so the pick is said.
      if let current, let row = current.row, let onPick {
        onPick(row)
        ToolAnnouncement.post("Marked \(describe(row).title) in the list below.")
      }
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
    // `width: max-content; max-width: min(260px, 60%)`: as wide as its
    // words, up to the cap (the box's, its padding inside it).
    let cap = min(Measure.Defense.calloutMax, side * Measure.Defense.calloutShare) - 2 * Measure.Defense.calloutPaddingH
    RadarCalloutWidth(cap: cap) {
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
    }
    .padding(.vertical, Measure.Defense.calloutPaddingV)
    .padding(.horizontal, Measure.Defense.calloutPaddingH)
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

/// One child as wide as its words up to `cap`, its lines wrapping there.
struct RadarCalloutWidth: Layout {
  var cap: CGFloat

  private func width(_ subviews: Subviews) -> CGFloat {
    guard let child = subviews.first else { return 0 }
    return min(child.sizeThatFits(.unspecified).width, max(0, cap))
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard let child = subviews.first else { return .zero }
    let w = width(subviews)
    return CGSize(width: w, height: child.sizeThatFits(ProposedViewSize(width: w, height: nil)).height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: nil))
  }
}

/// `.radar-legend { flex-wrap: wrap; justify-content: center }`: the keys
/// in lines, each line centred.
struct RadarLegendFlow: Layout {
  var spacing: CGFloat
  var lineSpacing: CGFloat

  private func lines(_ sizes: [CGSize], width: CGFloat) -> [(indices: [Int], width: CGFloat, height: CGFloat)] {
    var out: [(indices: [Int], width: CGFloat, height: CGFloat)] = []
    var current: (indices: [Int], width: CGFloat, height: CGFloat) = ([], 0, 0)
    for (index, size) in sizes.enumerated() {
      let extra = current.indices.isEmpty ? size.width : spacing + size.width
      if !current.indices.isEmpty && current.width + extra > width {
        out.append(current)
        current = ([index], size.width, size.height)
      } else {
        current.indices.append(index)
        current.width += extra
        current.height = max(current.height, size.height)
      }
    }
    if !current.indices.isEmpty { out.append(current) }
    return out
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
    let width = proposal.width ?? .infinity
    let rows = lines(sizes, width: width)
    let height = rows.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(0, rows.count - 1))
    return CGSize(width: proposal.width ?? (rows.map(\.width).max() ?? 0), height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
    var y = bounds.minY
    for line in lines(sizes, width: bounds.width) {
      var x = bounds.minX + (bounds.width - line.width) / 2
      for index in line.indices {
        let size = sizes[index]
        subviews[index].place(at: CGPoint(x: x, y: y + (line.height - size.height) / 2), proposal: ProposedViewSize(size))
        x += size.width + spacing
      }
      y += line.height + lineSpacing
    }
  }
}

/// `Legend`: what each mark means, with how many there are of each.
struct RadarLegend: View {
  @Environment(\.virgaTheme) private var theme
  let byBand: [Band: Int]

  var body: some View {
    RadarLegendFlow(spacing: Measure.Defense.legendColumnGap, lineSpacing: Measure.Defense.legendRowGap) {
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
