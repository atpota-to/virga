// Ports src/posting/ui/StyleDialog.jsx
// Ports src/posting/ui/adviser.css (.style-dialog, .style-body, .style-start, .style-result, .style-progress, .style-actions)
//
// The adviser's reading of how this account writes: its recent posts are
// gathered once, read for deliberate habits (all lowercase, no full stops,
// "gonna"), and described in a few sentences the proofread then respects.
// The writer can edit the description, refine it with a note, read the
// posts again, keep it, or forget it. Nothing is kept until "Keep this".
// One StyleSession per opening (VirgaPosting), over the account's
// requester; the posts gathered are kept only while it's open. A sheet,
// full height on a phone.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting
import VirgaSession

extension View {
  /// The style dialog over this view while `isPresented`.
  func adviserStyleDialog(isPresented: Binding<Bool>, did: String?, model: PostingSettingsModel) -> some View {
    modifier(AdviserStyleDialogSheet(isPresented: isPresented, did: did, model: model))
  }
}

struct AdviserStyleDialogSheet: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  @Binding var isPresented: Bool
  let did: String?
  let model: PostingSettingsModel

  func body(content: Content) -> some View {
    content.sheet(isPresented: $isPresented) {
      AdviserStyleDialog(did: did, model: model) { isPresented = false }
        .presentationDetents([.large])
        .presentationBackground(theme.surface)
        .presentationCornerRadius(Measure.Dialog.radius)
    }
  }
}

struct AdviserStyleDialog: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  let did: String?
  let model: PostingSettingsModel
  let onClose: () -> Void

  @State private var session: StyleSession?
  @State private var note = ""
  @State private var sampleSize = AdviserSetup.defaultStyleSampleSize
  @State private var saveError = ""

  private var adviser: AdviserSettings { model.settings.adviser }

  var body: some View {
    let saved = adviser.writingChecks.styleProfile
    let v = session?.view ?? StyleView()
    let working = v.phase == "working"
    let hasDescription = v.phase == "result" && !v.summary.jsTrimmed().isEmpty
    let usage = v.usage ?? AdviserUsageStore.readAdviserUsage(did, feature: .style, now: SyncStatus.now(), store: app.stores.keyValue)?.json
    let usageLine = AdviserUsageStore.adviserUsageLine(usage, feature: .style, now: SyncStatus.now())
    let hasSaved = !saved.summary.jsTrimmed().isEmpty
    let canUseAi = did.map { app.session.capabilitiesFor($0).canUseAi } ?? false
    DialogFrame(title: "Your writing style", onClose: onClose, hasActions: true) {
      VStack(alignment: .leading, spacing: Measure.Adviser.dialogBodyGap) {
        if !canUseAi {
          NeedsBackendNotice(did: did)
        } else {
          Text(
            "The adviser can learn how you write from your recent posts, so the proofread leaves your habits alone: all lowercase, no full stops, “gonna”. It sends your recent public posts to Virga’s server, which asks an AI model to describe them. Only the description is kept, on this device."
          )
          .virgaText(.textBase)
          .foregroundStyle(theme.ink2)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: theme.characters(Measure.Adviser.styleIntroMeasure), alignment: .leading)
          if v.phase == "idle" || v.phase == "error" {
            VStack(alignment: .leading, spacing: Measure.Adviser.styleGap) {
              Segmented(
                label: "How many recent posts to read",
                options: AdviserSetup.styleSampleSizes.map { SegmentedOption($0, "\($0) posts") }, selection: sampleSize, size: .small
              ) { sampleSize = $0 }
              FieldHint("More posts give a steadier reading and take a little longer. Replies count too.")
              Button {
                start()
              } label: {
                Label("Read my posts", systemImage: AdviserGlyph.sparkles)
              }
              .buttonStyle(.virga(.primary))
              .accessibilityIdentifier("style-read")
            }
          }
          if working { StyleProgress(stage: v.stage, count: v.postCount) }
          if let error = v.error {
            // role="alert", the monthly limit's warning too.
            Callout(tone: error.code?.stringValue == "monthly_limit" ? .warn : .danger, alert: error.message) { Text(error.message) }
          }
          if v.phase == "result" || (working && !v.summary.isEmpty) {
            result(v, working: working)
          }
          if !saveError.isEmpty {
            Callout(tone: .danger, saveError)
          }
          if !usageLine.isEmpty {
            Text(usageLine).virgaText(.textSm).foregroundStyle(theme.muted)
          }
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("style-dialog")
    } actions: {
      // `.style-forget { margin-right: auto; color: var(--danger) }`, and
      // from 640 down `flex-basis: 100%`: a line of its own over the rest.
      Group {
        if hasSaved && !working && theme.composerNarrow {
          VStack(spacing: Measure.Dialog.actionsGap) {
            forgetButton(saved)
              .environment(\.virgaFillsWidth, true)
            HStack(spacing: Measure.Dialog.actionsGap) {
              if !theme.isPhone { Spacer(minLength: 0) }
              closeAndKeep(v, hasDescription: hasDescription, working: working, saved: saved)
            }
          }
        } else {
          HStack(spacing: Measure.Dialog.actionsGap) {
            if hasSaved && !working {
              forgetButton(saved)
              Spacer(minLength: 0)
            } else if !theme.isPhone {
              Spacer(minLength: 0)
            }
            closeAndKeep(v, hasDescription: hasDescription, working: working, saved: saved)
          }
        }
      }
      .frame(maxWidth: .infinity)
      .layoutPriority(1)
    }
    .onAppear { open() }
    .onDisappear {
      session?.dispose()
      session = nil
    }
  }

  private func forgetButton(_ saved: AdviserStyleProfile) -> some View {
    Button {
      forget(saved)
    } label: {
      Label("Forget my style", systemImage: Glyph.trash)
    }
    .buttonStyle(.virga(.ghost, destructive: true))
  }

  @ViewBuilder
  private func closeAndKeep(_ v: StyleView, hasDescription: Bool, working: Bool, saved: AdviserStyleProfile) -> some View {
    Button(hasDescription && v.fresh ? "Cancel" : "Close", action: onClose).buttonStyle(.virga)
    if hasDescription {
      Button("Keep this") { keep(v) }
        .buttonStyle(.virga(.primary))
        .disabled(working || (!v.fresh && note.jsTrimmed() == saved.guidance.jsTrimmed()))
        .accessibilityIdentifier("style-keep")
    }
  }

  private func result(_ v: StyleView, working: Bool) -> some View {
    let summaryLimit = AdviserSetup.adviserTextLimits["styleSummary"] ?? 1500
    let guidanceLimit = AdviserSetup.adviserTextLimits["styleGuidance"] ?? 500
    let line = StyleSessionWords.styleProfileLine(analyzedCount: .number(v.analyzedCount), updatedAt: .string(v.updatedAt))
    return VStack(alignment: .leading, spacing: Measure.Adviser.styleGap) {
      FieldStack("How you write") {
        TextEditor(
          text: Binding(
            get: { v.summary },
            set: { next in session?.edit(next.utf16.count > summaryLimit ? next.jsSlice(0, summaryLimit) : next) })
        )
        .frame(minHeight: theme.points(ThemeKit.textAreaMinHeight) * Measure.Adviser.summaryRows / 3)
        .virgaTextArea()
        .disabled(working)
        .accessibilityLabel("How you write")
        .accessibilityIdentifier("style-summary")
        FieldHint("\(line.isEmpty ? "Written by hand" : line)\(v.fresh ? " · not kept yet" : "")")
      }
      FieldStack("What should change?") {
        VirgaTextField("For example: I do capitalise names on purpose", text: $note)
          .virgaField()
          .disabled(working)
          .onChange(of: note) { _, next in if next.utf16.count > guidanceLimit { note = next.jsSlice(0, guidanceLimit) } }
          .accessibilityLabel("What should change?")
        FieldHint("Kept with the description, and used each time it’s read again.")
      }
      FlowLayout(spacing: Measure.Adviser.styleActionsGap, lineSpacing: Measure.Adviser.styleActionsGap) {
        Button {
          start(previousSummary: v.summary)
        } label: {
          Label("Refine with my note", systemImage: AdviserGlyph.sparkles)
        }
        .buttonStyle(.virga)
        .disabled(working || note.jsTrimmed().isEmpty)
        Button {
          start(again: true)
        } label: {
          Label("Read my posts again", systemImage: AdviserGlyph.again)
        }
        .buttonStyle(.virga(.ghost))
        .disabled(working)
        // `.style-sample .input { width: auto; min-width: 112px }`
        VirgaSelect(
          "How many posts to read again", selection: $sampleSize,
          options: AdviserSetup.styleSampleSizes.map { SelectChoice($0, "\($0) posts") }
        )
        .frame(minWidth: Measure.Adviser.styleSampleMin)
        .fixedSize(horizontal: true, vertical: false)
        .disabled(working)
      }
    }
  }

  /// One sitting per opening: the saved profile is read when it opens.
  private func open() {
    let saved = adviser.writingChecks.styleProfile
    let canUseAi = did.map { app.session.capabilitiesFor($0).canUseAi } ?? false
    let requester = canUseAi ? app.session.backendFor(did) : nil
    session = StyleSession(
      did: did, requester: requester, profile: saved, store: app.stores.keyValue, transport: app.archiveEnvironment.transport)
    note = saved.guidance
    sampleSize = adviser.writingChecks.styleSampleSize
    saveError = ""
  }

  private func start(previousSummary: String = "", again: Bool = false) {
    let size = sampleSize
    let guidance = note.jsTrimmed()
    Task { await session?.start(sampleSize: .number(Double(size)), guidance: guidance, previousSummary: previousSummary, again: again) }
  }

  private func writeProfile(_ profile: AdviserStyleProfile) -> Bool {
    var next = adviser
    next.writingChecks.styleSampleSize = sampleSize
    next.writingChecks.styleProfile = profile
    do {
      try model.update(["adviser": next.json])
      return true
    } catch {
      let said = (error as? PostingSettingsError)?.message ?? ""
      saveError = said.isEmpty ? "The description couldn’t be saved." : said
      return false
    }
  }

  private func keep(_ v: StyleView) {
    guard v.phase == "result", !v.summary.jsTrimmed().isEmpty else { return }
    let profile = AdviserStyle.styleProfileFrom(
      StyleReading(summary: v.summary.jsTrimmed(), analyzedCount: v.analyzedCount, updatedAt: v.updatedAt), note.jsTrimmed())
    if writeProfile(profile) { onClose() }
  }

  private func forget(_ saved: AdviserStyleProfile) {
    var kept = saved
    kept.guidance = note.jsTrimmed()
    if writeProfile(AdviserStyle.forgetStyleProfile(kept)) { onClose() }
  }
}

/// `StyleProgress`: the three stages, the one under way pulsing, the count
/// of posts gathered beside the first.
struct StyleProgress: View {
  @Environment(\.virgaTheme) private var theme
  let stage: String
  let count: Int
  @State private var dim = false

  private func nowLine(_ stages: [StyleStage], at: Int) -> String? {
    guard stages.indices.contains(at) else { return nil }
    let s = stages[at]
    return "\(s.label)\(s.id == "gather" && count > 0 ? " · \(AppLocale.formatNumber(count)) posts" : "") (in progress)"
  }

  var body: some View {
    let stages = StyleSessionWords.styleStages
    let at = stages.firstIndex { $0.id == stage } ?? 0
    VStack(alignment: .leading, spacing: Measure.Adviser.progressGap) {
      ForEach(Array(stages.enumerated()), id: \.offset) { i, s in
        let state = i < at ? "done" : i == at ? "now" : "later"
        HStack(spacing: Measure.Adviser.progressGap) {
          Circle()
            .fill(state == "done" ? theme.ok : state == "now" ? theme.accent : theme.line2)
            .frame(width: Measure.Adviser.progressDot, height: Measure.Adviser.progressDot)
            .opacity(state == "now" && dim ? Measure.Adviser.pulseLow : 1)
            .accessibilityHidden(true)
          Text("\(s.label)\(s.id == "gather" && count > 0 ? " · \(AppLocale.formatNumber(count)) posts" : "")")
            .virgaText(.textBase, weight: state == "now" ? VirgaWeight.semibold : VirgaWeight.regular)
            .foregroundStyle(state == "done" ? theme.ink2 : state == "now" ? theme.ink : theme.muted)
            .accessibilityValue(state == "now" ? "in progress" : "")
        }
      }
    }
    .padding(.vertical, Measure.Adviser.progressPadding)
    .padding(.leading, Measure.Adviser.progressInset)
    .overlay(alignment: .leading) { Rectangle().fill(theme.line).frame(width: 1) }
    .accessibilityElement(children: .contain)
    // `role="status"`: the stage under way, read out as it moves on.
    .toolAnnounces(nowLine(stages, at: at))
    .onAppear {
      guard !theme.reduceMotion else { return }
      withAnimation(.easeInOut(duration: Measure.Adviser.nowPulseSeconds / 2).repeatForever(autoreverses: true)) { dim = true }
    }
  }
}
#endif
