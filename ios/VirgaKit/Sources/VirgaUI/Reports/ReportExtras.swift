// Ports src/reports/ReportPage.jsx (AddToDashboard, REPORT_WIDGET, the followers' lists, the top posts)
//
// Add to dashboard: the report's own card (REPORT_WIDGET), on a dashboard
// picked (or a new one, named for it) at a size picked, with the web's
// toast. The followers report's newest followers and biggest days (each
// with the best-liked post that day or the day before), and the
// engagement report's top posts.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

enum ReportWidgets {
  /// `REPORT_WIDGET`: the card each report adds to a dashboard.
  static let byReport = [
    "followers": "follower-growth", "blocks": "blocks-over-time", "posts": "posting-cadence", "content": "content-formats",
    "engagement": "engagement-over-time", "people": "top-engagers", "atmosphere": "repo-collections",
  ]
}

/// `AddToDashboard`.
struct AddToDashboard: View {
  @Environment(ShellDashboards.self) private var dashboards
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  let widget: WidgetDef
  let done: () -> Void
  @State private var target = ""
  @State private var size = ""

  var body: some View {
    let has = { (d: Dashboard) in d.widgets.contains { $0.type.jsEquals(widget.type) } }
    let chosen = dashboards.dashboards.first { $0.id.jsEquals(target) }
    DialogForm {
      VStack(alignment: .leading, spacing: 0) {
        FieldLabel("Dashboard")
        ForEach(dashboards.dashboards) { d in
          ChoiceRow(d.name, description: has(d) ? "Already on it" : nil, isOn: choosing(d.id))
        }
        ChoiceRow("A new dashboard", isOn: choosing("new"))
      }
      FieldStack("Size") {
        Segmented(
          label: "Size",
          options: widget.sizes.map { SegmentedOption($0, Layouts.sizes[$0]?.label ?? $0, accessibilityLabel: Layouts.sizes[$0]?.name) },
          selection: $size, size: .small)
      }
      HStack(spacing: Measure.Dialog.actionsGap) {
        Spacer(minLength: 0)
        Button("Cancel", action: done).buttonStyle(.virga)
        Button("Add to \(chosen?.name ?? "a new dashboard")") {
          if let chosen {
            dashboards.addWidget(chosen.id, widget.type, size: size)
            toasts?.push("\(widget.name) added to \(chosen.name).")
          } else {
            // The new dashboard is named for the chart it starts with.
            let id = dashboards.addDashboard(name: widget.name, template: nil)
            dashboards.addWidget(id, widget.type, size: size)
            toasts?.push("\(widget.name) is on a new dashboard.")
          }
          done()
        }
        .buttonStyle(.virga(.primary))
      }
    }
    .onAppear {
      target = (dashboards.dashboards.first { !has($0) } ?? dashboards.dashboards.first)?.id ?? "new"
      size = widget.defaultSize
    }
  }

  private func choosing(_ id: String) -> Binding<Bool> {
    Binding(get: { target.jsEquals(id) }, set: { if $0 { target = id } })
  }
}

/// The followers report's two lists, side by side where there is room.
struct FollowerLists: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ArchiveModel.self) private var model: ArchiveModel?
  let archive: ReportArchive
  let period: AnalyticsPeriod
  let m: FollowersReport

  var body: some View {
    let newest = Array(m.newest.prefix(8))
    ReportCard(title: "Newest followers", sub: "Who followed you in \(Periods.periodPhrase(period))", tools: nil) {
      if newest.isEmpty {
        EmptyState("Nobody new in this window.")
      } else {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(newest, id: \.row.did) { f in
            PersonRow(
              archive: archive, did: f.row.did, meta: "followed \(Time.relativeTime(f.atMs, now: SyncStatus.now()))", follow: true,
              followLabel: "Follow back", rel: false)
          }
        }
        .task(id: newest.map(\.row.did).joined(separator: "|")) { await model?.wantActors(newest.map(\.row.did)) }
      }
    }
    ReportCard(title: "Biggest days", sub: "And your best-liked post that day or the day before", tools: nil) {
      if m.biggestDays.isEmpty {
        EmptyState("Nobody new in this window.")
      } else {
        let near = postsByDay
        VStack(alignment: .leading, spacing: 0) {
          ForEach(m.biggestDays, id: \.t) { d in
            let post = near[d.t] ?? near[d.t - 86_400_000]
            HStack(alignment: .firstTextBaseline, spacing: theme.space3) {
              Text(Analytics.bucketLabel(d.t, .day)).virgaText(.textSm).foregroundStyle(theme.muted)
              Text("+\(AppLocale.formatNumber(d.n))").virgaText(.textBase, weight: VirgaWeight.semibold).foregroundStyle(theme.ink)
              Text(post.map(PostRowView.text) ?? "No post that day")
                .virgaText(.textBase)
                .foregroundStyle(post == nil ? theme.muted : theme.ink2)
                .lineLimit(1)
            }
            .padding(.vertical, theme.rowPad)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
          }
        }
      }
    }
  }

  /// The best-liked post (not a reply) of each local day.
  private var postsByDay: [Double: PostRow] {
    let zone = AppLocale.activeTimeZone()
    var out: [Double: PostRow] = [:]
    for post in archive.posts where post.replyTo == nil {
      let t = JSDate.parse(post.at ?? "", timeZone: zone)
      guard t.isFinite, let f = JSDate.fields(t, timeZone: zone) else { continue }
      let day = JSDate.local(Double(f.year), Double(f.month), Double(f.date), timeZone: zone)
      if let held = out[day], held.likes >= post.likes { continue }
      out[day] = post
    }
    return out
  }
}

/// The engagement report's top posts, ranked.
struct TopPostsCard: View {
  let archive: ReportArchive
  let posts: [PostRow]
  let kind: String

  var body: some View {
    ReportCard(
      title: "Top posts", sub: "Ranked by \(kind == "all" ? "all engagement" : (WidgetParts.kindNoun[kind] ?? kind).jsLowercased())", tools: nil
    ) {
      if posts.isEmpty {
        EmptyState("No posts in this window.")
      } else {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(posts.prefix(10).enumerated()), id: \.element.uri) { i, post in
            PostRowView(post: post, did: archive.did, kind: kind, rank: i + 1)
          }
        }
      }
    }
  }
}
#endif
