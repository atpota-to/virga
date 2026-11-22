// Ports src/shell/SyncStatus.jsx
// Ports src/shell/shell.css (.sync-card, .sync-banner, .sync-steps)
//
// What the archive holds and how fresh it is, and the sync while it runs:
//
//   SyncCard    the sidebar's, pinned to its foot: when it was synced, Sync
//               now, and the progress (one bar, the step named) while a
//               sync runs. `brief` keeps it to its first line, beside the
//               first build's page, which shows the steps itself.
//   SyncBanner  the same as one 36-point strip at the top of the page, for
//               a phone (where there is no sidebar) and a folded sidebar:
//               the words, Cancel, and the progress as a line along its
//               foot. VirgaPage draws it when the shell says so.
//   SyncSteps   every step, named, each with its own segment: the first
//               build's page and Settings › Data show it in full.
//
// The words are the web's, and the steps' names and status lines are
// VirgaArchive's SyncProgress. "…kept in this browser" stays as the web
// says it for now.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore

/// The words and the arithmetic the sync's places share.
enum SyncStatus {
  /// `overallFraction(sync)`: progress across the steps, 0–1, or nil
  /// with no sync.
  static func overallFraction(_ sync: SyncState?) -> Double? {
    guard let sync else { return nil }
    let total = Double(sync.plan.isEmpty ? 1 : sync.plan.count)
    let finished = Double(sync.done.count + sync.failed.count)
    let current = sync.step != nil ? (sync.fraction ?? 0) : 0
    return min(1, (finished + current) / total)
  }

  /// `syncHeadline(sync)`.
  static func headline(_ sync: SyncState?) -> String {
    guard let sync else { return "" }
    guard let step = sync.step else { return "Loading the archive into the charts" }
    if let doing = sync.doing, !doing.isEmpty { return doing }
    if let doing = SyncProgress.syncStep(step)?.doing, !doing.isEmpty { return doing }
    return "Syncing"
  }

  /// `syncStepText(sync)`: "Step 2 of 6".
  static func stepText(_ sync: SyncState?) -> String {
    guard let sync else { return "" }
    guard let step = sync.step else { return "Finishing" }
    let index = sync.plan.firstIndex { $0.jsEquals(step) } ?? -1
    return "Step \(index + 1) of \(sync.plan.count)"
  }

  /// `syncWhen(archive)`: "Synced 12m ago", "Archive incomplete", "Not built yet".
  @MainActor
  static func when(_ archive: ArchiveModel, now: Double = SyncStatus.now()) -> String {
    guard let posts = archive.data.meta.posts else { return "Not built yet" }
    if posts.complete != true { return "Archive incomplete" }
    if let at = posts.syncedAt, at != 0, !at.isNaN { return "Synced \(Time.relativeTime(at, now: now))" }
    return "Not synced yet"
  }

  /// `useArchiveCounts(archive)`: what the archive holds, counted.
  struct Counts: Hashable {
    var posts: Int
    var followers: Int
    var records: Int
    var blockedBy: Int
  }

  @MainActor
  static func counts(_ archive: ArchiveModel) -> Counts {
    let data = archive.data
    return Counts(
      posts: data.posts.count, followers: data.followers.count, records: data.atmosphere.count,
      blockedBy: Analytics.blockReach(data.blocks).people.count)
  }

  /// `runFor(archive)`: a first build, a top-up, or the rest of a build.
  @MainActor
  static func mode(_ archive: ArchiveModel) -> SyncMode {
    guard let posts = archive.data.meta.posts else { return .full }
    return posts.complete == true ? .incremental : .resume
  }

  /// "Sync now", "Resume the build", or "Build your archive".
  @MainActor
  static func runLabel(_ archive: ArchiveModel) -> String {
    guard let posts = archive.data.meta.posts else { return "Build your archive" }
    return posts.complete == true ? "Sync now" : "Resume the build"
  }

  /// `Math.round(fraction * 100)` for the step under way, or nil.
  static func percent(_ sync: SyncState) -> Int? {
    guard let fraction = sync.fraction, sync.step != nil, fraction.isFinite else { return nil }
    return Int((fraction * 100).jsRounded)
  }

  static func now() -> Double { Date().timeIntervalSince1970 * 1000 }
}

// MARK: - The sidebar's card

/// `SyncCard`: a few quiet lines at the sidebar's foot.
struct SyncCard: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  let archive: ArchiveModel
  var brief = false

  var body: some View {
    Group {
      if let sync = archive.sync {
        running(sync)
      } else {
        resting
      }
    }
    .virgaText(.textSm)
    .foregroundStyle(theme.muted)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func running(_ sync: SyncState) -> some View {
    VStack(alignment: .leading, spacing: Measure.Sync.cardGap) {
      HStack(spacing: Measure.Sync.rowGap) {
        Text(SyncStatus.headline(sync))
          .virgaText(.textSm, weight: VirgaWeight.medium)
          .foregroundStyle(theme.ink2)
          .lineLimit(1)
          // Brief, the first build's page says it: once is enough.
          .accessibilityAddTraits(brief ? [] : .updatesFrequently)
        Spacer(minLength: 0)
        Button {
          archive.cancelSync()
        } label: {
          Image(systemName: Glyph.close).font(.system(size: Measure.Sync.linkIcon))
        }
        .buttonStyle(.virga(.ghost, size: .small, icon: true))
        .accessibilityLabel("Cancel the sync")
        .accessibilityIdentifier("sync-cancel")
      }
      if !brief {
        ProgressLine(value: SyncStatus.overallFraction(sync))
          .padding(.vertical, Measure.Sync.cardProgressSpace)
          .accessibilityHidden(true)
        Text(SyncStatus.stepText(sync) + (sync.detail.isEmpty ? "" : " · \(sync.detail)"))
          .virgaText(.textSm, lineHeight: Measure.Sync.subLineHeight)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Sync")
  }

  private var resting: some View {
    let posts = archive.data.meta.posts
    let failed = archive.syncError != nil
    let short = theme.hasSidebar && theme.windowHeight <= Measure.Sync.countsHiddenAtHeight
    return VStack(alignment: .leading, spacing: Measure.Sync.cardGap) {
      HStack(spacing: Measure.Sync.rowGap) {
        StateDot(failed ? .warn : posts == nil ? .idle : .ok)
        Text(failed ? "Last sync had problems" : SyncStatus.when(archive))
          .virgaText(.textSm, weight: VirgaWeight.medium)
          .foregroundStyle(theme.ink2)
          .lineLimit(1)
      }
      .accessibilityElement(children: .combine)
      if !brief, posts != nil, !short {
        // The two counts the card names (blockReach is worked out only
        // where the blocks are shown).
        Text(
          "\(AppLocale.formatNumber(archive.data.atmosphere.count)) repo records and \(AppLocale.formatNumber(archive.data.followers.count)) followers, kept in this browser"
        )
        .virgaText(.textSm, lineHeight: Measure.Sync.subLineHeight)
        .fixedSize(horizontal: false, vertical: true)
      }
      if !brief, failed {
        Button("See what failed") { navigate("/settings/data") }
          .buttonStyle(SyncLinkStyle())
          .accessibilityAddTraits(.isLink)
      }
      if !brief {
        Button {
          let mode = SyncStatus.mode(archive)
          Task { await archive.runSync(mode) }
        } label: {
          HStack(spacing: Measure.Sync.linkGap) {
            Image(systemName: Glyph.refresh).font(.system(size: Measure.Sync.linkIcon))
            Text(SyncStatus.runLabel(archive))
          }
        }
        .buttonStyle(SyncLinkStyle())
        .padding(.top, Measure.Sync.linkSpaceAbove)
        .accessibilityIdentifier("sync-now")
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Your archive")
  }
}

/// `.sync-card > .btn`: Sync now as a link, in ink, underlined (thicker
/// when pressed), since the sidebar has one filled button already.
struct SyncLinkStyle: ButtonStyle {
  @Environment(\.virgaTheme) private var theme

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .virgaText(.textSm, weight: VirgaWeight.medium)
      .foregroundStyle(theme.ink)
      .underline(true, pattern: .solid)
      .overlay(alignment: .bottom) {
        if configuration.isPressed {
          Rectangle().fill(theme.ink).frame(height: 1).offset(y: 1)
        }
      }
      .frame(minHeight: Measure.Sync.linkHeight)
      .touchReach(horizontal: 0, vertical: (Measure.Touch.target - Measure.Sync.linkHeight) / 2)
      .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm))
  }
}

// MARK: - The strip

/// `SyncBanner`: the sync as one strip at the top of the page, where there
/// is no sidebar to say it; or, after a sync that failed, a line that says
/// so with the way to what failed.
struct SyncBanner: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  let archive: ArchiveModel

  var body: some View {
    if let sync = archive.sync {
      running(sync)
    } else if archive.syncError != nil {
      failed
    }
  }

  private func strip<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
    HStack(spacing: Measure.Sync.bannerGap) {
      content()
    }
    .virgaText(.textSm)
    .padding(.horizontal, theme.pagePad)
    .frame(minHeight: Measure.Sync.bannerHeight)
    .frame(maxWidth: theme.contentMax + theme.pagePad * 2)
    .frame(maxWidth: .infinity)
  }

  private func running(_ sync: SyncState) -> some View {
    strip {
      HStack(spacing: Measure.Sync.bannerDotSpace) {
        Text(SyncStatus.headline(sync))
          .virgaText(.textSm, weight: VirgaWeight.medium)
          .foregroundStyle(theme.ink2)
          .lineLimit(1)
        Text("·").foregroundStyle(theme.muted)
        Text(SyncStatus.stepText(sync))
          .foregroundStyle(theme.muted)
          .lineLimit(1)
          .fixedSize()
      }
      .accessibilityElement(children: .combine)
      .accessibilityAddTraits(.updatesFrequently)
      .frame(maxWidth: .infinity, alignment: .leading)
      Button("Cancel") { archive.cancelSync() }
        .buttonStyle(.linkAction)
        .accessibilityLabel("Cancel the sync")
        .accessibilityIdentifier("sync-cancel")
    }
    .overlay(alignment: .bottom) {
      ProgressLine(value: SyncStatus.overallFraction(sync), height: Measure.Sync.bannerProgress)
        .padding(.horizontal, theme.hasSidebar ? theme.pagePad : 0)
        .accessibilityHidden(true)
    }
    .padding(.bottom, Measure.Sync.bannerSpaceBelow)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("sync-banner")
  }

  private var failed: some View {
    strip {
      Text("The last sync had problems.")
        .virgaText(.textSm, weight: VirgaWeight.medium)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
      Button("See what failed") { navigate("/settings/data") }
        .buttonStyle(.plain)
        .virgaText(.textSm, weight: VirgaWeight.medium)
        .underline()
        .accessibilityAddTraits(.isLink)
    }
    .foregroundStyle(theme.warn)
    .padding(.bottom, Measure.Sync.bannerSpaceBelow)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("sync-banner")
  }
}

// MARK: - Every step

/// `SyncSteps`: every step of a sync, named: finished ones ticked, failed
/// ones marked, the one under way filled by its own measured share (or
/// moving, when there is nothing honest to measure it by), the rest waiting.
struct SyncSteps: View {
  @Environment(\.virgaTheme) private var theme
  let sync: SyncState

  private enum StepState { case done, failed, active, pending }

  private func state(of key: String) -> StepState {
    if sync.failed.contains(where: { $0.jsEquals(key) }) { return .failed }
    if sync.done.contains(where: { $0.jsEquals(key) }) { return .done }
    if let step = sync.step, key.jsEquals(step) { return .active }
    return .pending
  }

  var body: some View {
    let pct = SyncStatus.percent(sync)
    let columns = theme.windowWidth <= Measure.Sync.narrowStepsAt ? Measure.Sync.narrowStepColumns : Measure.Sync.stepColumns
    VStack(alignment: .leading, spacing: Measure.Sync.stepsGap) {
      head(pct)
      LazyVGrid(
        columns: Array(repeating: GridItem(.flexible(), spacing: Measure.Sync.stepsGap, alignment: .top), count: columns),
        alignment: .leading, spacing: Measure.Sync.stepsGap
      ) {
        ForEach(sync.plan, id: \.self) { key in
          step(key, pct: pct)
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Sync steps")
    }
    .accessibilityIdentifier("sync-steps")
  }

  private func head(_ pct: Int?) -> some View {
    var tail = " · " + SyncStatus.stepText(sync)
    if !sync.detail.isEmpty { tail += " · \(sync.detail)" }
    if let pct { tail += " · \(pct)%" }
    return (Text(SyncStatus.headline(sync)).font(theme.font(.textSm, weight: VirgaWeight.semibold)) + Text(tail))
      .virgaText(.textSm)
      .foregroundStyle(theme.ink2)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.updatesFrequently)
  }

  private func step(_ key: String, pct: Int?) -> some View {
    let state = state(of: key)
    let label = SyncProgress.syncStep(key)?.label ?? key
    let value: Double?
    let fill: Color?
    let spoken: String
    switch state {
    case .done:
      value = 1
      fill = theme.ink2
      spoken = ", done"
    case .failed:
      value = 1
      fill = theme.danger
      spoken = ", failed"
    case .active:
      value = pct.map { Double($0) / 100 }
      fill = nil
      spoken = pct.map { ", \($0)% done" } ?? ", under way"
    case .pending:
      value = 0
      fill = nil
      spoken = ", waiting"
    }
    let ink = state == .failed ? theme.danger : state == .active ? theme.ink : theme.muted
    return VStack(alignment: .leading, spacing: Measure.Sync.stepGap) {
      ProgressLine(value: value, fill: fill)
      HStack(alignment: .firstTextBaseline, spacing: Measure.Sync.stepGap) {
        Text(label)
          .lineLimit(1)
        Spacer(minLength: 0)
        switch state {
        case .done: Image(systemName: Glyph.check).font(.system(size: Measure.Sync.tick))
        case .failed: Text("failed")
        case .active: Text(pct.map { "\($0)%" } ?? "…")
        case .pending: EmptyView()
        }
      }
      .virgaText(.textXs, weight: state == .active ? VirgaWeight.semibold : VirgaWeight.regular)
      .foregroundStyle(ink)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label + spoken)
  }
}

#Preview("Sync") {
  VirgaPreviewHost {
    VStack(alignment: .leading, spacing: 24) {
      SyncSteps(
        sync: SyncState(
          plan: SyncProgress.syncPlan, done: ["followers", "following"], failed: ["blocks"], step: "repo", fraction: 0.42,
          detail: "1,204 records", doing: nil))
      SyncSteps(
        sync: SyncState(plan: SyncProgress.syncPlan, done: [], failed: [], step: "followers", fraction: nil, detail: "", doing: nil))
    }
    .padding()
  }
}
#endif
