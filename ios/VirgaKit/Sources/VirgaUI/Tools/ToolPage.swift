// Ports src/tools/ToolPage.jsx
// Ports src/tools/tools.css (.tools-sections, .tools-section, .tool-row)
//
// The tools: small utilities for looking after an account, each saying
// what it can touch. The Tools page lists them, a row each under the
// heading of its kind, two columns of kinds where there is room for two;
// each row says what the tool can touch and what it has to say right now,
// and goes to the tool's own page. A tool that isn't built goes nowhere, a
// step quieter. Every tool page has the same header: Tools in the crumbs,
// its name, what it does, and what it touches.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

/// `ToolHeader`: the header every tool page shares.
struct ToolHeader {
  static func model(_ tool: ToolEntry, sub: String? = nil) -> PageHeaderModel {
    PageHeaderModel(title: tool.name, sub: sub ?? tool.desc, access: [tool.access], crumbs: [Crumb("Tools", to: "/tools")])
  }

  static func header(_ tool: ToolEntry, sub: String? = nil, actions: AnyView? = nil) -> PageHeader {
    PageHeader(model(tool, sub: sub), actions: actions)
  }
}

/// `ToolPage`: the tool an address names, or the page of one that isn't
/// built (or of an address that names none).
struct ToolPage: View {
  let key: String

  var body: some View {
    if let tool = ToolsRegistry.toolByKey[key], tool.planned != true {
      switch key {
      case "follow-cleanup": FollowCleanupTool(tool: tool)
      case "unfollow-tracker": UnfollowTrackerTool(tool: tool)
      case "follow-back": FollowBackTool(tool: tool)
      case "best-time": BestTimeTool(tool: tool)
      case "lists": ListsTool(tool: tool)
      case "interaction-lookup": InteractionLookupTool(tool: tool)
      case "archive": ArchiveSearchTool(tool: tool)
      case "identity": IdentityTool(tool: tool)
      default: UnbuiltToolPage(tool: tool)
      }
    } else {
      UnbuiltToolPage(tool: ToolsRegistry.toolByKey[key])
    }
  }
}

/// `ToolsIndex`.
struct ToolsIndex: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?

  var body: some View {
    let stats = archive.map { Self.stats($0) } ?? [:]
    VirgaPage(
      PageHeaderModel(title: "Tools", sub: "Small tools for looking after your account. Each says what it can touch before it touches it.")
    ) {
      LazyVGrid(
        columns: [GridItem(.adaptive(minimum: min(Measure.Tools.sectionMin, theme.windowWidth - theme.pagePad * 2)), spacing: theme.gridGapX, alignment: .top)],
        alignment: .leading, spacing: theme.gridGap
      ) {
        ForEach(ToolsRegistry.toolSections) { section in
          ToolsSectionView(section: section, stats: stats)
        }
      }
    }
  }

  /// `useToolStats(archive)`: a line of what each tool has to say right now.
  @MainActor
  static func stats(_ model: ArchiveModel) -> [String: String] {
    guard model.data.meta.posts != nil else { return [:] }
    let archive = ReportArchive(model)
    let log = ReportModels.followerLogModel(archive)
    let lists = archive.meta.lists != nil ? ReportModels.listsModel(archive) : nil
    let queue = ReportModels.followBackModel(archive, AnalyticsPeriod(key: "all", days: nil, label: "All time"), model.nowMs)
    let checked = archive.following.filter { (model.actors[$0.did]?.activityAt ?? 0) != 0 }.count
    let met = InteractionModel.interactionIndex(archive).ranked.count
    let fmt = { (n: Int) in AppLocale.formatNumber(n) }
    var collections = Set<JSKey>()
    for row in archive.data.atmosphere { collections.insert(JSKey(row.collection)) }
    return [
      "follow-cleanup": "\(fmt(archive.following.count)) follows\(checked != 0 ? ", \(fmt(checked)) checked" : "")",
      "unfollow-tracker": log.tracking ? "\(fmt(log.latestLost.count)) at the last sync" : "Starts at your next sync",
      "follow-back": "\(fmt(queue.count)) waiting",
      "lists": lists.map { l in "\(l.count) lists, \(l.filter { $0.purpose == "moderation" }.count) moderation" } ?? "Read at the next sync",
      "interaction-lookup": "\(fmt(met)) \(met == 1 ? "account" : "accounts") on record",
      "archive": "\(fmt(archive.posts.count)) posts",
      "identity": archive.data.atmosphere.isEmpty ? "" : "\(collections.count) collections",
    ]
  }
}

/// `.tools-section`: a kind of tool, its heading over a rule in ink, then
/// its rows.
struct ToolsSectionView: View {
  @Environment(\.virgaTheme) private var theme
  let section: ToolSection
  let stats: [String: String]

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: Measure.Tools.sectionHeadGap) {
        Text(section.title)
          .virgaText(
            size: theme.points(ThemeKit.cardTitleFontSize), weight: ThemeKit.cardTitleWeight, tracking: ThemeKit.cardTitleTracking)
          .foregroundStyle(theme.ink)
          .accessibilityAddTraits(.isHeader)
        Text(section.desc)
          .virgaText(size: theme.points(ThemeKit.cardSubFontSize))
          .foregroundStyle(theme.color(ThemeKit.cardSubInk))
          .fixedSize(horizontal: false, vertical: true)
      }
      .padding(.bottom, theme.space3)
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay(alignment: .bottom) { Rectangle().fill(theme.rule).frame(height: 1) }
      ForEach(ToolsRegistry.tools.filter { $0.section == section.key }) { tool in
        ToolRow(tool: tool, stat: stats[tool.key])
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("tools-\(section.key)")
  }
}

/// `.tool-row`: the tool's glyph, its name, what it does, and what it can
/// touch with what it has to say right now; the way in at the right.
struct ToolRow: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  let tool: ToolEntry
  let stat: String?

  var body: some View {
    let planned = tool.planned == true
    if planned {
      inner(planned: true)
        .accessibilityElement(children: .combine)
    } else {
      Button {
        navigate("/tools/\(tool.key)")
      } label: {
        inner(planned: false)
      }
      .buttonStyle(.plain)
      .accessibilityAddTraits(.isLink)
      .accessibilityIdentifier("tool-\(tool.key)")
    }
  }

  private func inner(planned: Bool) -> some View {
    HStack(alignment: .top, spacing: Measure.Tools.rowGap) {
      Image(systemName: tool.sfSymbol)
        .font(.system(size: Measure.Tools.rowIcon))
        .foregroundStyle(planned ? theme.muted : theme.ink2)
        .frame(width: Measure.Tools.rowIcon + 4)
        .padding(.top, Measure.Tools.rowIconSpaceAbove)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: Measure.Tools.rowTextGap) {
        Text(tool.name)
          .virgaText(.textMd, weight: VirgaWeight.medium, lineHeight: Measure.Tools.rowNameLineHeight)
          .foregroundStyle(planned ? theme.ink2 : theme.ink)
        Text(tool.desc)
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .fixedSize(horizontal: false, vertical: true)
        meta(planned: planned)
          .padding(.top, Measure.Tools.rowTextGap)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if !planned {
        Image(systemName: Glyph.chevronRight)
          .font(.system(size: Measure.Tools.rowChevron, weight: .medium))
          .foregroundStyle(theme.muted)
          .frame(maxHeight: .infinity)
          .accessibilityHidden(true)
      }
    }
    .padding(.vertical, theme.rowPadLg)
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(Rectangle())
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }

  /// What it can touch, then what it has to say right now: one meta line.
  private func meta(planned: Bool) -> some View {
    let size = theme.points(ThemeKit.metaFontSize)
    return FlowLayout(spacing: 0, lineSpacing: 0, alignment: .center) {
      AccessLine([tool.access], prefix: planned ? "Not built yet." : nil)
      if !planned, let stat, !stat.isEmpty {
        Text("·")
          .padding(.leading, theme.points(ThemeKit.metaDotMargin.left))
          .padding(.trailing, theme.points(ThemeKit.metaDotMargin.right))
          .accessibilityHidden(true)
        Text(stat)
          .accessibilityIdentifier("tool-stat-\(tool.key)")
      }
    }
    .virgaText(size: size, lineHeight: ThemeKit.metaLineHeight)
    .foregroundStyle(theme.color(ThemeKit.metaInk))
  }
}
#endif
