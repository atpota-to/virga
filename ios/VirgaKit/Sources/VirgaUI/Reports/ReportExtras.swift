// Ports src/reports/ReportPage.jsx (AddToDashboard, REPORT_WIDGET, the followers' lists, the top posts)
// Ports src/reports/reports.css (.day-row)
//
// Add to dashboard: the report's own card (REPORT_WIDGET), on a dashboard
// picked (or a new one, named for it) at a size picked (where it has more
// than one), with the web's toast; Cancel and Add to … in the dialog's
// foot. The followers report's newest followers and biggest days (each
// with the best-liked post that day or the day before), side by side where
// there is room, and the engagement report's top posts, each list under a
// rule in ink.

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

/// `AddToDashboard`: which dashboard (or a new one), how wide, and the
/// button that does it, in the dialog's foot; on a phone the two buttons
/// are one under the other, the one that adds first, since it names the
/// dashboard (`dialog--stack-actions`).
struct AddToDashboard: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ShellDashboards.self) private var dashboards
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  let widget: WidgetDef
  let done: () -> Void
  @State private var target = ""
  @State private var size = ""

  var body: some View {
    let has = { (d: Dashboard) in d.widgets.contains { $0.type.jsEquals(widget.type) } }
    DialogFrame(title: "Add \(widget.name) to a dashboard", onClose: done, stackActions: true) {
      DialogForm {
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel("Dashboard")
          ForEach(dashboards.dashboards) { d in
            ChoiceRow(d.name, description: has(d) ? "Already on it" : nil, isOn: choosing(d.id))
          }
          ChoiceRow("A new dashboard", isOn: choosing("new"))
        }
        if widget.sizes.count > 1 {
          FieldStack("Size") {
            Segmented(
              label: "Size",
              options: widget.sizes.map { SegmentedOption($0, Layouts.sizes[$0]?.label ?? $0, accessibilityLabel: Layouts.sizes[$0]?.name) },
              selection: $size, size: .small)
          }
        }
      }
    } actions: {
      // On a phone the kit's stacked foot puts the last (Add) first.
      cancel
      add
    }
    .onAppear {
      target = (dashboards.dashboards.first { !has($0) } ?? dashboards.dashboards.first)?.id ?? "new"
      size = widget.defaultSize
    }
  }

  private var chosen: Dashboard? { dashboards.dashboards.first { $0.id.jsEquals(target) } }

  private var cancel: some View {
    Button("Cancel", action: done).buttonStyle(.virga)
  }

  private var add: some View {
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
    .accessibilityIdentifier("add-to-dashboard-confirm")
  }

  private func choosing(_ id: String) -> Binding<Bool> {
    Binding(get: { target.jsEquals(id) }, set: { if $0 { target = id } })
  }
}

/// The followers report's two lists, side by side where there is room, each
/// under a rule in ink.
struct FollowerLists: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ArchiveModel.self) private var model: ArchiveModel?
  let archive: ReportArchive
  let period: AnalyticsPeriod
  let m: FollowersReport

  var body: some View {
    ReportSplit {
      newestCard
      biggestDaysCard
    }
  }

  private var newestCard: some View {
    let newest = Array(m.newest.prefix(8))
    return ReportCard(title: "Newest followers", sub: "Who followed you in \(Periods.periodPhrase(period))", tools: nil, flush: true) {
      if newest.isEmpty {
        EmptyState("Nobody new in this window.")
      } else {
        PersonList {
          ForEach(newest, id: \.row.did) { f in
            PersonRow(
              archive: archive, did: f.row.did, meta: "followed \(Time.relativeTime(f.atMs, now: SyncStatus.now()))", follow: true,
              followLabel: "Follow back", rel: false)
          }
        }
        .task(id: newest.map(\.row.did).joined(separator: "|")) { await model?.wantActors(newest.map(\.row.did)) }
      }
    }
  }

  private var biggestDaysCard: some View {
    ReportCard(title: "Biggest days", sub: "And your best-liked post that day or the day before", tools: nil, flush: true) {
      if m.biggestDays.isEmpty {
        EmptyState("Nobody new in this window.")
      } else {
        let near = postsByDay
        VStack(alignment: .leading, spacing: 0) {
          ForEach(m.biggestDays, id: \.t) { d in
            BiggestDayRow(day: d, post: near[d.t] ?? near[d.t - 86_400_000])
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

/// `.day-row`: the day, how many, and the post that may explain it, in
/// columns of 64 and 52 on the baseline, the post cut short on one line.
/// (Not `DayRow`: that is the weekly schedule's, WeeklySchedulePage.jsx's.)
struct BiggestDayRow: View {
  @Environment(\.virgaTheme) private var theme
  let day: DayCount
  let post: PostRow?

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: Measure.Reports.dayGap) {
      Text(Analytics.bucketLabel(day.t, .day))
        .virgaText(.textBase)
        .foregroundStyle(theme.muted)
        .lineLimit(1)
        .frame(width: Measure.Reports.dayDate, alignment: .leading)
      Text("+\(AppLocale.formatNumber(day.n))")
        .virgaText(.textBase, weight: VirgaWeight.semibold)
        .foregroundStyle(theme.ink)
        .lineLimit(1)
        .frame(width: Measure.Reports.dayCount, alignment: .leading)
      Text(post.map(PostRowView.text) ?? "No post that day")
        .virgaText(.textBase)
        .foregroundStyle(post == nil ? theme.muted : theme.ink2)
        .lineLimit(1)
        .truncationMode(.tail)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.vertical, theme.rowPad)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}

/// The engagement report's top posts, ranked, under a rule in ink.
struct TopPostsCard: View {
  let archive: ReportArchive
  let posts: [PostRow]
  let kind: String

  var body: some View {
    ReportCard(
      title: "Top posts", sub: "Ranked by \(kind == "all" ? "all engagement" : ReportParts.head(kind).jsLowercased())", tools: nil, flush: true
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
