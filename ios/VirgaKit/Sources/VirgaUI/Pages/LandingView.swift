// Ports src/pages/Landing.jsx
// Ports src/styles/app.css (.landing, .landing-bar, .landing-main, .landing-hero, .landing-points, .landing-foot, the sketch)
//
// The front page, for someone who isn't signed in: what this is, and the
// sign-in (SignInFlowView), which lists the accounts this device remembers
// above the one field that starts a new one. It sits on the sky as the app
// does, with the mark where the app has it. Beside the way in on a wide
// screen (under it on a phone), a picture of a dashboard drawn in shapes
// rather than numbers, so it promises nothing it can't know.
//
// LandingFrame is the frame every page outside the shell has (the front
// page, a legal page, the agreement screen, a sign-in that didn't
// complete): the bar with the mark, the main column, the foot. On the
// front page the live sky is over its sky when it has been asked for, and
// five taps on the mark turn it on or off, as anywhere else in Virga.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaSession

struct LandingFrame<Bar: View, Main: View, Foot: View>: View {
  @Environment(\.virgaTheme) private var theme
  private let bar: Bar
  private let main: Main
  private let foot: Foot
  /// The live sky over the sky (the front page's, when it is on).
  private let liveSky: Bool

  init(liveSky: Bool = false, @ViewBuilder bar: () -> Bar, @ViewBuilder main: () -> Main, @ViewBuilder foot: () -> Foot) {
    self.liveSky = liveSky
    self.bar = bar()
    self.main = main()
    self.foot = foot()
  }

  var body: some View {
    let maxWidth = theme.points(ThemeKit.landingMaxWidth)
    LandingMinHeight {
      // `.landing { min-height: 100svh }`: the height the scroll view
      // shows, less the status bar and the home indicator.
      Color.clear
        .containerRelativeFrame(.vertical)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 0) {
        bar
          .frame(minHeight: theme.points(ThemeKit.landingBarHeight))
          .padding(.top, theme.points(theme.hasSidebar ? ThemeKit.landingBarSpaceAbove : ThemeKit.phoneLandingBarSpaceAbove))
        // Over the foot, so what floats from the main column (the handle's
        // suggestions) is drawn and pressed above it. At its own height:
        // `.landing-main { flex: 1 }` makes the column's box taller but
        // stretches nothing in it, so a view that would grow (the identity
        // bones' row while a name loads) keeps its height and only the
        // spacer below takes what's to spare.
        main
          .fixedSize(horizontal: false, vertical: true)
          .zIndex(1)
        // `.landing-main { flex: 1 }`: what the screen has to spare goes
        // under the main column, so the foot is at the bottom.
        Spacer(minLength: 0)
        LandingFootLayout(spacing: Measure.Landing.footColumnGap, lineSpacing: Measure.Landing.footGap) {
          foot
        }
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
        .tint(theme.muted)
        .padding(.top, Measure.Landing.footSpaceAbove)
        .padding(.bottom, Measure.Landing.footSpaceBelow)
      }
      .padding(.horizontal, theme.pagePad)
      .frame(maxWidth: maxWidth + theme.pagePad * 2, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .skyBackground(live: liveSky)
  }
}

/// `.landing`'s column at least as tall as its first view (the screen's
/// height, from containerRelativeFrame), its second view (the page) laid
/// out in all of it, so its spacer can take what the content doesn't fill.
/// A frame's minHeight would need the number itself, and the window's
/// height (theme.windowHeight) is taller than what the scroll view shows by
/// the status bar and the home indicator.
struct LandingMinHeight: Layout {
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard subviews.count == 2 else { return .zero }
    let screen = subviews[0].sizeThatFits(proposal).height
    let page = subviews[1].sizeThatFits(ProposedViewSize(width: proposal.width, height: nil))
    return CGSize(width: proposal.width ?? page.width, height: max(screen, page.height))
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    guard subviews.count == 2 else { return }
    subviews[0].place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: nil))
    subviews[1].place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
  }
}

extension LandingFrame where Foot == EmptyView {
  init(@ViewBuilder bar: () -> Bar, @ViewBuilder main: () -> Main) {
    self.init(bar: bar, main: main, foot: { EmptyView() })
  }
}

/// `.landing-foot`: its pieces in a row that wraps (8 between lines, 32
/// between pieces), on their first baselines, spread to the row's ends
/// (`justify-content: space-between`), so the links sit at the far right
/// when they share the line with the words.
struct LandingFootLayout: Layout {
  var spacing: CGFloat
  var lineSpacing: CGFloat

  private struct Line {
    var indices: [Int] = []
    var width: CGFloat = 0
  }

  private func lines(_ sizes: [CGSize], maxWidth: CGFloat) -> [Line] {
    var out: [Line] = []
    var line = Line()
    for (index, size) in sizes.enumerated() {
      let extra = line.indices.isEmpty ? size.width : spacing + size.width
      if !line.indices.isEmpty && line.width + extra > maxWidth {
        out.append(line)
        line = Line(indices: [index], width: size.width)
      } else {
        line.indices.append(index)
        line.width += extra
      }
    }
    if !line.indices.isEmpty { out.append(line) }
    return out
  }

  /// Each piece's top within its line, on the line's first baseline, and
  /// the line's height.
  private func tops(_ line: Line, sizes: [CGSize], subviews: Subviews) -> (tops: [CGFloat], height: CGFloat) {
    let baselines = line.indices.map { index in
      subviews[index].dimensions(in: ProposedViewSize(sizes[index]))[VerticalAlignment.firstTextBaseline]
    }
    let baseline = baselines.max() ?? 0
    let tops = baselines.map { baseline - $0 }
    var height: CGFloat = 0
    for (n, index) in line.indices.enumerated() { height = max(height, tops[n] + sizes[index].height) }
    return (tops, height)
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let maxWidth = proposal.width ?? .infinity
    let sizes = subviews.map { $0.sizeThatFits(ProposedViewSize(width: maxWidth, height: nil)) }
    let rows = lines(sizes, maxWidth: maxWidth)
    var height: CGFloat = 0
    for (n, row) in rows.enumerated() {
      height += tops(row, sizes: sizes, subviews: subviews).height + (n > 0 ? lineSpacing : 0)
    }
    let widest = rows.map(\.width).max() ?? 0
    return CGSize(width: proposal.width ?? widest, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let sizes = subviews.map { $0.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil)) }
    var y = bounds.minY
    for row in lines(sizes, maxWidth: bounds.width) {
      let placed = tops(row, sizes: sizes, subviews: subviews)
      // What the row has to spare goes between its pieces.
      let spare = max(0, bounds.width - row.width)
      let between = row.indices.count > 1 ? spacing + spare / CGFloat(row.indices.count - 1) : spacing
      var x = bounds.minX
      for (n, index) in row.indices.enumerated() {
        let size = sizes[index]
        subviews[index].place(at: CGPoint(x: x, y: y + placed.tops[n]), proposal: ProposedViewSize(size))
        x += size.width + between
      }
      y += placed.height + lineSpacing
    }
  }
}

/// `.landing-title { line-height: 1.02 }`: the title's words, wrapped where
/// a browser wraps them, a line every `pitch`. A Text can't set its lines
/// closer than the face's own 1.22em (`.lineSpacing` stops at 0), so the
/// words are set here, one view each: every line's box is the browser's,
/// the word's own line centred on it (its half-leading), the glyphs reaching
/// past it above and below as they do there. A heading's lines are
/// balanced (base.css's `h1 { text-wrap: balance }`): as many as the width
/// needs, broken at the narrowest width that still needs no more, so
/// "Your account, / in figures." rather than "Your account, in / figures.".
struct LandingTitleLines: Layout {
  /// From one line's top to the next's: the line-height, in points.
  var pitch: CGFloat
  /// Between two words on a line.
  var space: CGFloat

  private struct Line {
    var indices: [Int] = []
    var width: CGFloat = 0
  }

  private func lines(_ sizes: [CGSize], maxWidth: CGFloat) -> [Line] {
    var out: [Line] = []
    var line = Line()
    for (index, size) in sizes.enumerated() {
      let extra = line.indices.isEmpty ? size.width : space + size.width
      if !line.indices.isEmpty && line.width + extra > maxWidth {
        out.append(line)
        line = Line(indices: [index], width: size.width)
      } else {
        line.indices.append(index)
        line.width += extra
      }
    }
    if !line.indices.isEmpty { out.append(line) }
    return out
  }

  /// The lines at `maxWidth`, balanced: wrapped at the narrowest width a
  /// line of the words can have (a run of them, as wide as it is set) that
  /// takes no more lines than `maxWidth` does.
  private func balanced(_ sizes: [CGSize], maxWidth: CGFloat) -> [Line] {
    let greedy = lines(sizes, maxWidth: maxWidth)
    guard greedy.count > 1 else { return greedy }
    var widths: [CGFloat] = []
    for start in sizes.indices {
      var width: CGFloat = 0
      for end in start..<sizes.count {
        width += end == start ? sizes[end].width : space + sizes[end].width
        if width <= maxWidth { widths.append(width) }
      }
    }
    for width in widths.sorted() where lines(sizes, maxWidth: width).count <= greedy.count {
      return lines(sizes, maxWidth: width)
    }
    return greedy
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
    let rows = balanced(sizes, maxWidth: proposal.width ?? .infinity)
    return CGSize(width: rows.map(\.width).max() ?? 0, height: pitch * CGFloat(rows.count))
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
    for (n, row) in balanced(sizes, maxWidth: max(bounds.width, proposal.width ?? 0)).enumerated() {
      var x = bounds.minX
      for index in row.indices {
        let size = sizes[index]
        let y = bounds.minY + pitch * CGFloat(n) + (pitch - size.height) / 2
        subviews[index].place(at: CGPoint(x: x, y: y), proposal: .unspecified)
        x += size.width + space
      }
    }
  }
}

extension View {
  /// `.landing-foot-links a { min-height: 44px }` under a finger.
  func footTarget() -> some View {
    frame(minHeight: Measure.Touch.target).contentShape(Rectangle())
  }
}

extension Measure.Landing {
  /// `.landing-hero { padding-bottom: clamp(48px, 8svh, 88px) }`; 48 under 900.
  static let heroSpaceBelow = Clamp(min: 48, share: 0.08, max: 88)
  static let phoneHeroSpaceBelow: CGFloat = 48
  /// `.landing-points { gap: 32px clamp(32px, 4vw, 56px) }`, a point at least 240 wide.
  static let pointsColumnGap = Clamp(min: 32, share: 0.04, max: 56)
  static let pointMinWidth: CGFloat = 240
}

/// A link to a page inside the app, as words in a sentence.
func pageLink(_ words: String, to href: String) -> AttributedString {
  var link = AttributedString(words)
  link.link = InternalLink.url(href)
  link.underlineStyle = Text.LineStyle.single
  return link
}

public struct LandingView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(PreferencesModel.self) private var preferences: PreferencesModel?
  @State private var toasts = ToastCenter()
  /// How far the page has scrolled, for the strip over the status bar.
  @State private var sky = SkyScroll()

  public init() {}

  public var body: some View {
    ScrollView {
      LandingFrame(liveSky: preferences?.prefs.liveSky == true) {
        SkyTapsButton { Brand() }
          .accessibilityAddTraits(.isHeader)
      } main: {
        VStack(alignment: .leading, spacing: 0) {
          hero
            .padding(.bottom, heroSpaceBelow)
            .zIndex(1)
          points
        }
        .padding(.top, theme.hasSidebar ? mainSpaceAbove : Measure.Landing.phoneMainSpaceAbove)
        .padding(.bottom, theme.hasSidebar ? Measure.Landing.mainSpaceBelow : Measure.Landing.phoneMainSpaceBelow)
      } foot: {
        Text(
          AttributedString(
            "Your archive is worked out and kept in this browser. Requests go to your account’s host, Bluesky’s public API, the PLC directory and Constellation, and, for long sessions, scheduled posts and your agreement to the terms, to Virga’s server. The "
          ) + pageLink("Privacy Policy", to: LegalVersion.privacyPath) + AttributedString(" has the whole list.")
        )
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: theme.characters(Measure.Landing.footMeasure, size: theme.textSm), alignment: .leading)
        HStack(spacing: Measure.Legal.navGap) {
          Button("Terms") { navigate(LegalVersion.termsPath) }.buttonStyle(.plain).underline().footTarget()
          Button("Privacy") { navigate(LegalVersion.privacyPath) }.buttonStyle(.plain).underline().footTarget()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Legal")
      }
      .background {
        // Where the content's top is as it scrolls (VirgaPage's way).
        GeometryReader { geometry in
          Color.clear.onChange(of: geometry.frame(in: .named(Self.space)).minY, initial: true) { _, y in
            sky.report(y)
          }
        }
      }
    }
    .coordinateSpace(name: Self.space)
    .background(PageGround().ignoresSafeArea())
    // The page never draws under the clock: the browser's chrome takes the
    // sky's top (preferences.jsx's theme-color), and the page scrolls under
    // it. The top of the sky is held there, as VirgaPage holds it.
    .overlay(alignment: .top) { StatusBarSky(scroll: sky) }
    .overlay { ToastStack(center: toasts) }
    .environment(toasts)
    .accessibilityIdentifier("landing")
  }

  /// The page's scroll view's own space.
  static var space: String { "virga-landing" }

  private var mainSpaceAbove: CGFloat {
    Measure.Landing.mainSpaceAbove.of(theme.windowHeight)
  }

  /// `.landing-hero { padding-bottom: clamp(48px, 8svh, 88px) }`, 48 under 900:
  /// the space before the points.
  private var heroSpaceBelow: CGFloat {
    theme.hasSidebar ? Measure.Landing.heroSpaceBelow.of(theme.windowHeight) : Measure.Landing.phoneHeroSpaceBelow
  }

  @ViewBuilder private var hero: some View {
    if theme.hasSidebar {
      HStack(alignment: .top, spacing: Measure.Landing.heroColumnGap.of(theme.windowWidth)) {
        copy.frame(maxWidth: Measure.Landing.copyMaxWidth, alignment: .leading).zIndex(1)
        LandingSketch(wide: true)
          .padding(.top, Measure.Landing.sketchSpaceAbove)
      }
    } else {
      VStack(alignment: .leading, spacing: Measure.Landing.phoneHeroGap) {
        copy.frame(maxWidth: Measure.Landing.phoneCopyMaxWidth, alignment: .leading).zIndex(1)
        LandingSketch(wide: false).frame(maxWidth: Measure.Landing.phoneCopyMaxWidth)
      }
    }
  }

  private var copy: some View {
    VStack(alignment: .leading, spacing: Measure.Landing.copyGap) {
      Text("Analytics for Bluesky and the rest of your atproto repo")
        .virgaText(size: theme.points(ThemeKit.landingEyebrowFontSize), weight: ThemeKit.landingEyebrowWeight)
        .foregroundStyle(theme.ink2)
      title
        .padding(.top, Measure.Landing.titleSpaceAbove)
      Text(
        "Followers, blocks, posts, engagement and the people behind them, on dashboards you arrange yourself, with a few small tools for looking after your account. Worked out in your browser, from your own data."
      )
      .virgaText(theme.isPhone ? .textMd : .textLg, lineHeight: ThemeKit.landingLedeLineHeight)
      .foregroundStyle(theme.ink2)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: theme.points(ThemeKit.landingLedeMaxWidth, inTextOf: theme.isPhone ? theme.textMd : theme.textLg), alignment: .leading)
      SignInFlowView(variant: .page, remembered: true)
        .padding(.top, Measure.Landing.flowSpaceAbove)
        .zIndex(1)
      Text(
        AttributedString(
          "You sign in on your own account’s host, not here, and Virga never sees your password. Before your account opens, Virga asks you to agree to its "
        ) + pageLink("Terms of Service", to: LegalVersion.termsPath) + AttributedString(" and ")
          + pageLink("Privacy Policy", to: LegalVersion.privacyPath) + AttributedString(".")
      )
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
      .tint(theme.ink)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: theme.characters(Measure.Landing.noteMeasure, size: theme.textSm), alignment: .leading)
    }
  }

  /// `.landing-title`, its lines 1.02em apart (LandingTitleLines).
  private var title: some View {
    let words = "Your account, in figures."
    let size = theme.points(ThemeKit.landingTitleFontSize)
    return LandingTitleLines(
      pitch: theme.scaled(size) * CGFloat(ThemeKit.landingTitleLineHeight),
      // A space, and the letter-spacing a browser puts after it too.
      space: theme.spaceWidth(size: size) + theme.tracking(ThemeKit.landingTitleTracking, size: size)
    ) {
      ForEach(Array(words.split(separator: " ").enumerated()), id: \.offset) { _, word in
        Text(String(word))
          .virgaText(size: size, weight: ThemeKit.landingTitleWeight, tracking: ThemeKit.landingTitleTracking)
          .lineLimit(1)
          .fixedSize()
      }
    }
    .foregroundStyle(theme.ink)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(words)
    .accessibilityAddTraits(.isHeader)
    .accessibilityIdentifier("landing-title")
  }

  private var points: some View {
    let items: [(String, String, String)] = [
      (
        Glyph.dashboards, "Reports you arrange",
        "Pick the reports you care about, size them, and keep a few dashboards: one for growth, one for what you post."
      ),
      (
        Glyph.tools, "Tools that ask first",
        "Tidy up who you follow, see who left, find your best time to post. Each tool says what it can touch before it touches it."
      ),
      (
        Glyph.lock, "Kept in your browser",
        "Your archive lives in this browser, and you can export it whenever you like. It’s never sent anywhere, not even to Virga’s server."
      ),
    ]
    // `repeat(auto-fit, minmax(min(240px, 100%), 1fr))`, three from 720.
    let gap = Measure.Landing.pointsColumnGap.of(theme.windowWidth)
    let column = min(theme.windowWidth - theme.pagePad * 2, theme.points(ThemeKit.landingMaxWidth))
    let fit = Int(((column + gap) / (Measure.Landing.pointMinWidth + gap)).rounded(.down))
    let columns = theme.windowWidth >= Measure.Landing.pointsRow ? 3 : max(1, min(3, fit))
    let rows = stride(from: 0, to: items.count, by: columns).map { Array(items[$0..<min($0 + columns, items.count)]) }
    return Grid(alignment: .topLeading, horizontalSpacing: gap, verticalSpacing: Measure.Landing.pointsGap) {
      ForEach(0..<rows.count, id: \.self) { r in
        GridRow {
          ForEach(rows[r], id: \.1) { item in
            LandingPoint(systemImage: item.0, title: item.1, text: item.2)
          }
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("What you get")
  }
}

struct LandingPoint: View {
  @Environment(\.virgaTheme) private var theme
  let systemImage: String
  let title: String
  let text: String

  var body: some View {
    VStack(alignment: .leading, spacing: Measure.Landing.pointGap) {
      // An 18 × 18 box whatever the symbol's own height, so the titles line up.
      Image(systemName: systemImage)
        .font(.system(size: Measure.Landing.pointIcon))
        .frame(width: Measure.Landing.pointIcon, height: Measure.Landing.pointIcon)
        .foregroundStyle(theme.ink)
        .padding(.bottom, Measure.Landing.pointIconSpaceBelow)
        .accessibilityHidden(true)
      Text(title)
        // `.landing-points h2`: the heading's 1.25 between its lines.
        .virgaText(.textMd, weight: VirgaWeight.semibold, lineHeight: ThemeKit.headingLineHeight)
        .foregroundStyle(theme.ink)
        .accessibilityAddTraits(.isHeader)
      Text(text)
        .virgaText(.textBase)
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: theme.characters(Measure.Landing.pointMeasure, size: theme.textBase), alignment: .leading)
    }
    .padding(.top, theme.points(ThemeKit.landingPointSpaceAbove))
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .top) {
      Rectangle().fill(theme.color(ThemeKit.landingPointRule)).frame(height: theme.points(ThemeKit.landingPointRule))
    }
  }
}

/// What is inside, as a picture: a dashboard drawn in shapes, not numbers.
/// Decoration, hidden from VoiceOver; the three points under it say the same
/// in words. Under the way in (a phone), the figures and the line only.
struct LandingSketch: View {
  @Environment(\.virgaTheme) private var theme
  let wide: Bool

  /// How wide each bar is, as a share of its column: a label, the figure
  /// under it, and the line under that.
  static let figures: [[CGFloat]] = [[46, 72, 58], [62, 44, 76], [54, 66, 50], [34, 30, 64]]
  static let posts: [CGFloat] = [88, 72, 80]
  static let people: [CGFloat] = [58, 46, 66]
  /// A best-time grid: four days of fourteen hours, a step of heat in each.
  static let heat: [Int] = [
    0, 1, 1, 2, 3, 2, 1, 2, 4, 3, 2, 1, 1, 0,
    1, 1, 2, 3, 5, 4, 2, 3, 6, 5, 3, 2, 1, 1,
    0, 1, 2, 2, 4, 3, 2, 2, 5, 4, 2, 2, 1, 0,
    0, 0, 1, 2, 2, 3, 1, 1, 3, 2, 2, 1, 0, 0,
  ]
  /// The line: `M4 132L60 126…L484 44` on a 520 × 176 box, then the dashed reach to (512, 22).
  static let line: [CGPoint] = [
    CGPoint(x: 4, y: 132), CGPoint(x: 60, y: 126), CGPoint(x: 116, y: 121), CGPoint(x: 172, y: 113), CGPoint(x: 228, y: 108),
    CGPoint(x: 284, y: 99), CGPoint(x: 340, y: 92), CGPoint(x: 372, y: 88), CGPoint(x: 404, y: 80), CGPoint(x: 436, y: 74),
    CGPoint(x: 468, y: 60), CGPoint(x: 484, y: 44),
  ]

  var body: some View {
    VStack(alignment: .leading, spacing: Measure.Landing.sketchGap.of(theme.windowWidth)) {
      HStack(alignment: .top, spacing: Measure.Landing.sketchFigureGap.of(theme.windowWidth)) {
        ForEach(0..<Self.figures.count, id: \.self) { i in
          figure(Self.figures[i], on: i == 0)
        }
      }
      chart
      if wide {
        HStack(alignment: .top, spacing: Measure.Landing.sketchListGap.of(theme.windowWidth)) {
          list(head: 38, rows: Self.posts, faces: false)
          list(head: 46, rows: Self.people, faces: true)
        }
        heatGrid
      }
    }
    .accessibilityHidden(true)
  }

  private func bar(_ share: CGFloat, height: CGFloat, color: Color, opacity: Double = 1) -> some View {
    GeometryReader { geometry in
      RoundedRectangle(cornerRadius: Measure.Landing.sketchRadius)
        .fill(color)
        .opacity(opacity)
        .frame(width: geometry.size.width * share / 100, height: height)
    }
    .frame(height: height)
  }

  private func figure(_ widths: [CGFloat], on: Bool) -> some View {
    VStack(alignment: .leading, spacing: Measure.Landing.sketchCellGap) {
      bar(widths[0], height: Measure.Landing.sketchWord, color: theme.line2)
      bar(widths[1], height: Measure.Landing.sketchNumber.of(theme.windowWidth), color: theme.ink, opacity: Measure.Landing.sketchNumberOpacity)
      bar(widths[2], height: Measure.Landing.sketchWord, color: theme.line)
    }
    .padding(.top, Measure.Landing.sketchCellPadding)
    .overlay(alignment: .top) {
      Rectangle().fill(on ? theme.accent : theme.line).frame(height: Measure.Landing.sketchFigureRule)
    }
    .frame(maxWidth: .infinity)
  }

  private var chart: some View {
    VStack(alignment: .leading, spacing: Measure.Landing.sketchCellPadding) {
      HStack {
        bar(32, height: Measure.Landing.sketchStrong, color: theme.ink, opacity: Measure.Landing.sketchStrongOpacity)
        Spacer(minLength: theme.space4)
        HStack(spacing: Measure.Landing.sketchCellPadding) {
          RoundedRectangle(cornerRadius: Measure.Landing.sketchRadius).fill(theme.ink).opacity(Measure.Landing.sketchStrongOpacity)
            .frame(width: Measure.Landing.sketchTab, height: Measure.Landing.sketchWord)
          RoundedRectangle(cornerRadius: Measure.Landing.sketchRadius).fill(theme.line2)
            .frame(width: Measure.Landing.sketchTab, height: Measure.Landing.sketchWord)
        }
      }
      SketchChart(points: Self.line, grid: theme.chartGrid, line: theme.chart1, ground: theme.bg)
        .aspectRatio(Measure.Landing.sketchChartAspect, contentMode: .fit)
    }
  }

  private func list(head: CGFloat, rows: [CGFloat], faces: Bool) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      bar(head, height: Measure.Landing.sketchStrong, color: theme.ink, opacity: Measure.Landing.sketchStrongOpacity)
        .padding(.bottom, Measure.Landing.sketchCellPadding)
      ForEach(0..<rows.count, id: \.self) { i in
        HStack(spacing: Measure.Landing.sketchRowGap) {
          if faces {
            Circle().fill(theme.avatarBg).frame(width: Measure.Landing.sketchFace, height: Measure.Landing.sketchFace)
          }
          bar(rows[i], height: Measure.Landing.sketchWord, color: theme.line2)
          RoundedRectangle(cornerRadius: Measure.Landing.sketchRadius).fill(theme.ink).opacity(Measure.Landing.sketchCountOpacity)
            .frame(width: Measure.Landing.sketchCount, height: Measure.Landing.sketchWord)
        }
        .frame(height: Measure.Landing.sketchRow)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
        .overlay(alignment: .top) { if i == 0 { Rectangle().fill(theme.rule).frame(height: 1) } }
      }
    }
    .frame(maxWidth: .infinity)
  }

  private var heatGrid: some View {
    let steps: [Color] = [theme.heat0, theme.heat1, theme.heat2, theme.heat3, theme.heat4, theme.heat5, theme.heat6]
    return VStack(alignment: .leading, spacing: 0) {
      bar(28, height: Measure.Landing.sketchStrong, color: theme.ink, opacity: Measure.Landing.sketchStrongOpacity)
        .padding(.bottom, Measure.Landing.sketchCellPadding)
      Grid(horizontalSpacing: Measure.Landing.sketchHeatGap, verticalSpacing: Measure.Landing.sketchHeatGap) {
        ForEach(0..<4, id: \.self) { row in
          GridRow {
            ForEach(0..<14, id: \.self) { column in
              RoundedRectangle(cornerRadius: Measure.Landing.sketchHeatRadius)
                .fill(steps[Self.heat[row * 14 + column]])
                .frame(height: Measure.Landing.sketchHeatCell)
            }
          }
        }
      }
    }
  }
}

/// The sketch's chart: three grid lines, the line, its dashed reach, and its
/// two dots.
struct SketchChart: View {
  let points: [CGPoint]
  let grid: Color
  let line: Color
  let ground: Color

  var body: some View {
    GeometryReader { geometry in
      let sx = geometry.size.width / Measure.Landing.sketchBox.width
      let sy = geometry.size.height / Measure.Landing.sketchBox.height
      let scaled = points.map { CGPoint(x: $0.x * sx, y: $0.y * sy) }
      let end = CGPoint(x: Measure.Landing.sketchEnd.x * sx, y: Measure.Landing.sketchEnd.y * sy)
      ZStack {
        Path { path in
          for y in Measure.Landing.sketchGridLines {
            path.move(to: CGPoint(x: 0, y: y * sy))
            path.addLine(to: CGPoint(x: geometry.size.width, y: y * sy))
          }
        }
        .stroke(grid, lineWidth: 1)
        Path { path in
          path.addLines(scaled)
        }
        .stroke(line, style: StrokeStyle(lineWidth: Measure.Landing.sketchLineWidth, lineCap: .round, lineJoin: .round))
        Path { path in
          if let last = scaled.last {
            path.move(to: last)
            path.addLine(to: end)
          }
        }
        .stroke(line, style: StrokeStyle(lineWidth: Measure.Landing.sketchLineWidth, lineCap: .round, dash: Measure.Landing.sketchDash))
        if let last = scaled.last {
          Circle().fill(ground).overlay(Circle().stroke(line, lineWidth: Measure.Landing.sketchLineWidth))
            .frame(width: Measure.Landing.sketchOpenDot, height: Measure.Landing.sketchOpenDot).position(last)
        }
        Circle().fill(line).frame(width: Measure.Landing.sketchDot, height: Measure.Landing.sketchDot).position(end)
      }
    }
  }
}
#endif
