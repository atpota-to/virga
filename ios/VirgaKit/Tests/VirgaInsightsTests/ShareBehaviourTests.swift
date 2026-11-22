// What the share fixtures can't show: a canvas that can't space letters,
// the theme's fallbacks, and the picture's proportions.

import Foundation
import Testing
import VirgaArchive
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

@Suite struct ShareBehaviour {
  let spec = ShareSpecification(
    kind: .series, title: "Follower growth", subtitle: "@mira.example.com, the last 7 days",
    figure: ShareFigure(value: "5,073", label: "followers"),
    series: (0..<7).map { SharePoint(t: JSDate.utc(2026, 10, 1) + Double($0) * 86_400_000, v: Double($0 + 1)) },
    unit: .day, mode: "line", zeroBase: false, noun: "followers")

  func theme() -> ShareTheme {
    ChartImage.readShareTheme(
      ThemeTokens.resolve(
        RootAttributes(sky: .day, theme: .light, accent: .blue, contrast: .normal, density: .comfortable), viewportWidth: 1280))
  }

  @Test func aCanvasThatCantSpaceLettersIsNeverAskedTo() {
    let ctx = RecordingCanvas()
    ctx.supportsLetterSpacing = false
    ChartImage.drawShareImage(ctx, spec, theme(), formats: ReportFormats(locale: "en-US", weekStart: 1, timeZone: .gmt))
    let sets = ctx.log.filter { $0[0] == "set" && $0[1] == "letterSpacing" }
    #expect(sets.isEmpty)
    let texts = ctx.log.filter { $0[0] == "fillText" }.compactMap { $0[1]?.stringValue }
    for text in ["Follower growth", "@mira.example.com, the last 7 days", "5,073", "followers", "Nov 1", "Nov 7", "Virga"] {
      #expect(texts.contains(text), "\(text)")
    }
  }

  @Test func aThemeWithNothingSetTakesTheWebsFallbacks() {
    let empty = ResolvedTheme(viewportWidth: 1280, values: [:])
    let t = ChartImage.readShareTheme(empty)
    #expect(canonical(t.surface) == "rgba(255,255,255,1)")
    #expect(t.skyTop == t.surface && t.skyMid == t.surface, "the sky falls back to the ground")
    #expect(canonical(t.line) == "rgba(15,27,51,0.14)")
    #expect(canonical(t.chart2) == "rgba(232,85,58,1)")
  }

  @Test func highContrastDrawsNoSky() {
    let high = ChartImage.readShareTheme(
      ThemeTokens.resolve(
        RootAttributes(sky: .night, theme: .dark, accent: .blue, contrast: .high, density: .comfortable), viewportWidth: 1280))
    let ctx = RecordingCanvas()
    ChartImage.drawShareImage(ctx, spec, high, formats: ReportFormats(locale: "en-US", weekStart: 1, timeZone: .gmt))
    #expect(!ctx.log.contains { $0[0] == "set" && $0[1] == "fillStyle" && $0[2]?.objectValue != nil })
  }

  @Test func sizedForAPost() {
    #expect(abs(ChartImage.shareWidth / ChartImage.shareHeight - 16.0 / 9.0) < 0.01)
  }

  @Test func anEmptyTitleKeepsTheCardsOwn() {
    let archive = ReportArchive(
      did: "did:plc:share-title", handle: "mira.example.com", nowMs: 1,
      data: ArchiveData(loaded: true, posts: [PostRow(uri: "at://did:plc:share-title/app.bsky.feed.post/a", at: "2026-11-10T12:00:00.000Z")], rev: 5))
    let week = Analytics.analyticsPeriods[0]
    let now = JSDate.utc(2026, 10, 14, 12)
    let f = ReportFormats(locale: "en-US", weekStart: 1, timeZone: .gmt)
    #expect(ShareSpec.shareSpec("posting-cadence", archive, week, now, ShareOptions(title: ""), formats: f)?.title == "Posts")
    #expect(ShareSpec.shareSpec("posting-cadence", archive, week, now, ShareOptions(title: "Mine"), formats: f)?.title == "Mine")
    #expect(ShareSpec.shareSpec("stat-posts", archive, week, now, formats: f)?.title == "Posts", "a figure shares its chart")
  }
}
