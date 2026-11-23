// Ports src/posting/ui/AdviserBusy.jsx
// Ports src/posting/ui/adviser.css (.adviser-busy)
//
// While the adviser reads a post: a quiet line in the composer (with the
// accent's rule down its side that something under way has), the goals it
// is checking, how long it usually takes (slower than usual once eight
// seconds have gone), and the ways out. Neither way out is the ink button:
// that is the composer's own, and it is waiting on this. The pre-publish
// check offers Publish anyway and Keep editing; a read from the "Check this
// post" button only Keep editing. VirgaPosting's AdviserGateController holds
// a fast answer back, so this never flashes. Read out as it appears.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting

struct AdviserBusyLine: View {
  @Environment(\.virgaTheme) private var theme
  let busy: AdviserBusy
  let onPublishAnyway: (() -> Void)?
  let onKeepEditing: () -> Void
  @State private var slow = false

  /// adviser.css's phone rules are `(max-width: 640px)`.
  private var narrow: Bool { theme.composerNarrow }

  private var expectation: String {
    AdviserContext.readExpectation(slow ? AdviserContext.slowReadAfterMs : 0)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: Measure.Adviser.busyGap) {
      HStack(alignment: .top, spacing: Measure.Adviser.busyHeadGap) {
        Image(systemName: AdviserGlyph.sparkles)
          .virgaGlyph(Measure.Adviser.busyIcon, beside: theme.textBase)
          .foregroundStyle(theme.ink2)
          .frame(height: Measure.Adviser.busyIconHeight)
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: Measure.Adviser.busyTextGap) {
          Text("Reading your draft")
            .virgaText(.textBase, weight: VirgaWeight.semibold)
            .foregroundStyle(theme.ink)
          Text(expectation)
            .virgaText(.textSm)
            .foregroundStyle(theme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        // `role="status"`: the slower line is read out as it comes.
        .toolAnnounces(expectation)
      }
      ProgressLine(value: nil)
      if !busy.goals.isEmpty {
        FlowLayout(spacing: Measure.Adviser.goalsGap, lineSpacing: Measure.Adviser.goalsGap) {
          ForEach(busy.goals, id: \.key) { goal in
            HStack(alignment: .firstTextBaseline, spacing: Measure.Adviser.goalsGap) {
              Text(goal.label).virgaText(.textSm, weight: VirgaWeight.medium).foregroundStyle(theme.ink2)
              if let detail = goal.detail, !detail.isEmpty {
                Text(detail).virgaText(.textSm).foregroundStyle(theme.muted).lineLimit(1)
              }
            }
            .padding(Measure.Adviser.goalPadding)
            .overlay(Capsule().strokeBorder(theme.line, lineWidth: 1))
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("What it’s checking")
      }
      // From 640 down each way out takes an equal share, 44 tall
      // (`.adviser-busy-actions > .btn { flex: 1 1 0; min-height: 44px }`).
      HStack(spacing: Measure.Adviser.busyActionsGap) {
        if !narrow { Spacer(minLength: 0) }
        Button(AdviserGate.adviserChoiceLabels[.edit] ?? "Keep editing", action: onKeepEditing)
          .buttonStyle(.virga(.ghost, size: .small))
          .accessibilityIdentifier("adviser-keep-editing")
        if let onPublishAnyway {
          Button(AdviserGate.adviserChoiceLabels[.publish] ?? "Publish anyway", action: onPublishAnyway)
            .buttonStyle(.virga(size: .small))
            .accessibilityIdentifier("adviser-publish-anyway")
        }
      }
      .environment(\.virgaFillsWidth, narrow)
    }
    .padding(.vertical, Measure.Adviser.busyPadding)
    .padding(.leading, Measure.Adviser.busyInset)
    .overlay(alignment: .leading) { Rectangle().fill(theme.accent).frame(width: Measure.Adviser.busyRule) }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("The post adviser is reading")
    .accessibilityIdentifier("adviser-busy")
    .task(id: busy.startedAt) { await waitUntilSlow() }
    .onAppear { UIAccessibility.post(notification: .announcement, argument: "Reading your draft") }
  }

  /// `useSlowAfter(startedAt, SLOW_READ_AFTER_MS)`.
  private func waitUntilSlow() async {
    let left = AdviserContext.slowReadAfterMs - (SyncStatus.now() - busy.startedAt)
    slow = busy.startedAt.isFinite && left <= 0
    guard busy.startedAt.isFinite, left > 0 else { return }
    try? await Task.sleep(nanoseconds: UInt64(left * 1_000_000))
    if !Task.isCancelled { slow = true }
  }
}

/// The adviser's lucide glyphs, as SF Symbols.
enum AdviserGlyph {
  static let sparkles = "sparkles"
  static let ok = "checkmark.circle"
  static let caution = "exclamationmark.triangle"
  static let conflict = "exclamationmark.circle"
  static let info = "info.circle"
  static let pen = "pencil.line"
  static let check = "checkmark"
  static let book = "book"
  static let again = "arrow.counterclockwise"
}
#endif
