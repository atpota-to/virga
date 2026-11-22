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
    VStack(alignment: .leading, spacing: 0) {
      bar
        .frame(minHeight: theme.points(ThemeKit.landingBarHeight))
        .padding(.top, theme.points(theme.hasSidebar ? ThemeKit.landingBarSpaceAbove : ThemeKit.phoneLandingBarSpaceAbove))
      main
      FlowLayout(spacing: Measure.Landing.footColumnGap, lineSpacing: Measure.Landing.footGap, alignment: .top) {
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
    .frame(minHeight: theme.windowHeight, alignment: .top)
    .skyBackground(live: liveSky)
  }
}

extension LandingFrame where Foot == EmptyView {
  init(@ViewBuilder bar: () -> Bar, @ViewBuilder main: () -> Main) {
    self.init(bar: bar, main: main, foot: { EmptyView() })
  }
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

  public init() {}

  public var body: some View {
    ScrollView {
      LandingFrame(liveSky: preferences?.prefs.liveSky == true) {
        SkyTapsButton { Brand() }
          .accessibilityAddTraits(.isHeader)
      } main: {
        VStack(alignment: .leading, spacing: theme.hasSidebar ? Measure.Landing.heroGap : Measure.Landing.phoneHeroGap) {
          hero
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
          Button("Terms") { navigate(LegalVersion.termsPath) }.buttonStyle(.plain).underline()
          Button("Privacy") { navigate(LegalVersion.privacyPath) }.buttonStyle(.plain).underline()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Legal")
      }
    }
    .background(PageGround().ignoresSafeArea())
    .overlay { ToastStack(center: toasts) }
    .environment(toasts)
    .accessibilityIdentifier("landing")
  }

  private var mainSpaceAbove: CGFloat {
    Measure.Landing.mainSpaceAbove.of(theme.windowHeight)
  }

  @ViewBuilder private var hero: some View {
    if theme.hasSidebar {
      HStack(alignment: .top, spacing: Measure.Landing.heroColumnGap.of(theme.windowWidth)) {
        copy.frame(maxWidth: Measure.Landing.copyMaxWidth, alignment: .leading)
        LandingSketch(wide: true)
          .padding(.top, Measure.Landing.sketchSpaceAbove)
      }
    } else {
      VStack(alignment: .leading, spacing: Measure.Landing.phoneHeroGap) {
        copy.frame(maxWidth: Measure.Landing.phoneCopyMaxWidth, alignment: .leading)
        LandingSketch(wide: false).frame(maxWidth: Measure.Landing.phoneCopyMaxWidth)
      }
    }
  }

  private var copy: some View {
    VStack(alignment: .leading, spacing: Measure.Landing.copyGap) {
      Text("Analytics for Bluesky and the rest of your atproto repo")
        .virgaText(size: theme.points(ThemeKit.landingEyebrowFontSize), weight: ThemeKit.landingEyebrowWeight)
        .foregroundStyle(theme.ink2)
      Text("Your account, in figures.")
        .virgaText(
          size: theme.points(ThemeKit.landingTitleFontSize), weight: ThemeKit.landingTitleWeight,
          lineHeight: ThemeKit.landingTitleLineHeight, tracking: ThemeKit.landingTitleTracking)
        .foregroundStyle(theme.ink)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, Measure.Landing.titleSpaceAbove)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("landing-title")
      Text(
        "Followers, blocks, posts, engagement and the people behind them, on dashboards you arrange yourself, with a few small tools for looking after your account. Worked out in your browser, from your own data."
      )
      .virgaText(theme.isPhone ? .textMd : .textLg, lineHeight: ThemeKit.landingLedeLineHeight)
      .foregroundStyle(theme.ink2)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: theme.points(ThemeKit.landingLedeMaxWidth, inTextOf: theme.isPhone ? theme.textMd : theme.textLg), alignment: .leading)
      SignInFlowView(variant: .page, remembered: true)
        .padding(.top, Measure.Landing.flowSpaceAbove)
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
    let columns = theme.windowWidth >= Measure.Landing.pointsRow ? 3 : 1
    return Grid(alignment: .topLeading, horizontalSpacing: Measure.Landing.pointsGap, verticalSpacing: Measure.Landing.pointsGap) {
      if columns == 3 {
        GridRow {
          ForEach(items, id: \.1) { item in
            LandingPoint(systemImage: item.0, title: item.1, text: item.2)
          }
        }
      } else {
        ForEach(items, id: \.1) { item in
          GridRow { LandingPoint(systemImage: item.0, title: item.1, text: item.2) }
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
      Image(systemName: systemImage)
        .font(.system(size: Measure.Landing.pointIcon))
        .foregroundStyle(theme.ink)
        .padding(.bottom, Measure.Landing.pointIconSpaceBelow)
        .accessibilityHidden(true)
      Text(title)
        .virgaText(.textMd, weight: VirgaWeight.semibold)
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
