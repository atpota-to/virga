// Ports src/posting/ui/TimerDialog.jsx
// Ports src/posting/pages/schedule.css (.timer-dialog, .timer-dialog-body, .sched-quote, .sched-dialog-skeleton, .lse-sub)
//
// Put a post that's already out on a timer, through Virga's server, as the
// account in the post's URI (only it may). The clock starts now or when the
// post went up. A post that already has a timer counting down gets the new
// rule in its place. Before the rule can be judged the dialog reads the
// account's limits, any timer the post already has, and (when the caller
// doesn't know) whether it's a reply and when it went up.
//
// Named PostTimerDialog, beside the composer's own timer dialog
// (LifespanDialog, Composer/LifespanDialog.swift). Present it with
// `.postTimerDialog($post, did:onArmed:)`, `post` a PostTimerTarget (the
// web's `{ uri, cid, extraUris, text, postedAt, reply }`).

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaNetwork
import VirgaPosting
import VirgaSession

/// The post a timer goes on: `{ uri, cid, extraUris?, text, postedAt, reply? }`.
/// `reply` nil and `postedAt` nil are the web's undefined: the dialog reads
/// them from Bluesky.
struct PostTimerTarget: Identifiable, Equatable {
  var uri: String
  var cid: String?
  var extraUris: [String] = []
  var text: String
  var postedAt: String?
  var reply: Bool?

  var id: String { uri }

  init(uri: String, cid: String? = nil, extraUris: [String] = [], text: String, postedAt: String? = nil, reply: Bool? = nil) {
    self.uri = uri
    self.cid = cid
    self.extraUris = extraUris
    self.text = text
    // `post.postedAt || null`: an empty time is no time.
    self.postedAt = postedAt.flatMap { $0.isEmpty ? nil : $0 }
    self.reply = reply
  }

  /// A scheduled post's timer note's "Set a timer" (ScheduleModel's TimerNoteArm).
  init(_ arm: TimerNoteArm) {
    self.init(
      uri: arm.uri, extraUris: arm.extraUris, text: arm.text,
      postedAt: arm.postedAt.flatMap { $0.isTruthy ? $0.stringValue : nil })
  }
}

extension View {
  /// TimerDialog over this view while `post` is set; `onArmed` hears
  /// createTimer's answer once the timer is set (the dialog has closed).
  func postTimerDialog(_ post: Binding<PostTimerTarget?>, did: String?, onArmed: @escaping (JSONValue?) -> Void) -> some View {
    modifier(PostTimerSheet(post: post, did: did, onArmed: onArmed))
  }
}

struct PostTimerSheet: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  @Binding var post: PostTimerTarget?
  let did: String?
  let onArmed: (JSONValue?) -> Void

  func body(content: Content) -> some View {
    content.sheet(item: $post) { target in
      PostTimerDialog(
        did: did, post: target, onClose: { post = nil },
        onArmed: { row in
          post = nil
          onArmed(row)
        }
      )
      // schedule.css: the timer dialog is a full-height sheet on a phone.
      .presentationDetents([.large])
      .presentationBackground(theme.surface)
      .presentationCornerRadius(Measure.Dialog.radius)
    }
  }
}

struct PostTimerDialog: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  let did: String?
  let post: PostTimerTarget
  let onClose: () -> Void
  let onArmed: (JSONValue?) -> Void

  enum Phase {
    case loading, ready
  }

  @State private var rule = TimerRule()
  @State private var start = "now"
  @State private var phase = Phase.loading
  @State private var limits: JSONValue?
  @State private var existing: JSONValue?
  @State private var reply = false
  @State private var postedAt: String?
  @State private var busy = ""
  @State private var error = ""
  @State private var now = SyncStatus.now()

  private var owner: String? { TimerService.timerDidForUri(post.uri) ?? did }
  private var req: VirgaBackend? {
    guard let owner, app.session.capabilitiesFor(owner).canSchedule else { return nil }
    return app.session.backendFor(owner)
  }

  var body: some View {
    DialogFrame(title: existing != nil ? "Change this post’s timer" : "Put this post on a timer", onClose: close) {
      VStack(alignment: .leading, spacing: Measure.Hub.timerBodyGap) {
        let snippet = post.text.jsTrimmed()
        if snippet.isEmpty {
          FieldHint("A post with no words of its own.")
        } else {
          HubQuote(text: snippet.jsSlice(0, Measure.Hub.timerQuoteMax))
        }
        if req == nil {
          NeedsBackendNotice(did: owner)
        } else if phase == .loading {
          skeleton
        } else {
          editor
        }
        if !error.isEmpty {
          Callout(tone: .danger) { Text(error) }
            .accessibilityIdentifier("timer-dialog-error")
        }
      }
    } actions: {
      if req != nil {
        Button("Cancel", action: close)
          .buttonStyle(.virga)
          .disabled(!busy.isEmpty)
        Button {
          Task { await arm() }
        } label: {
          Label(armLabel, systemImage: HubGlyph.timer)
        }
        .buttonStyle(.virga(.primary))
        .disabled(!busy.isEmpty || phase != .ready || blocked)
        .accessibilityIdentifier("timer-dialog-set")
      } else {
        Button("Close", action: close).buttonStyle(.virga)
      }
    }
    .interactiveDismissDisabled(!busy.isEmpty)
    .task(id: post.uri) { await read() }
    // The web reads the clock on every render: "From when it went up (…)"
    // and when the rule first acts move on as the rule or its start changes.
    .onChange(of: rule) { _, _ in now = SyncStatus.now() }
    .onChange(of: start) { _, _ in now = SyncStatus.now() }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("timer-dialog")
  }

  private func close() {
    if busy.isEmpty { onClose() }
  }

  private var armLabel: String {
    busy == "confirming" ? "Checking…" : !busy.isEmpty ? "Setting…" : existing != nil ? "Replace the timer" : "Set the timer"
  }

  // MARK: What the rule is judged by

  private var fit: LifespanEditorFit { LifespanEditorFit(reply: reply, thread: !post.extraUris.isEmpty) }
  private var holds: JSONValue? { existing.map { ScheduleModel.ruleOfTimerRow($0).json } }

  private var ruleNow: TimerRule {
    var on = rule
    on.enabled = true
    return SelfDestruct.normalizeTimer(on)
  }

  /// The start the server will actually count from, worked out before the
  /// notes so the sentence, the first-acts time and the request agree.
  private var counting: TimerStartPoint {
    LifespanModel.timerStart(ruleNow, start: start, postedAt: postedAt, now: now)
  }

  private var notes: LifespanEditorNotes {
    LifespanModel.editorNotes(rule, fit: fit, limits: limits, holds: holds, countFrom: counting.from, now: now)
  }

  private var blocked: Bool {
    let n = notes
    return !n.fitted.enabled || !n.room.isEmpty || n.pinBlocks
  }

  // MARK: The parts

  private var skeleton: some View {
    VStack(alignment: .leading, spacing: Measure.Hub.timerSkeletonGap) {
      GeometryReader { geometry in
        VStack(alignment: .leading, spacing: Measure.Hub.timerSkeletonGap) {
          bone(geometry.size.width * Measure.Hub.timerSkeletonFirst, Measure.Templates.rowBoneHeight)
          bone(geometry.size.width, Measure.Hub.timerSkeletonBone, pill: true)
          bone(geometry.size.width * Measure.Hub.timerSkeletonSecond, Measure.Templates.rowBoneHeight)
          bone(geometry.size.width, Measure.Hub.timerSkeletonBone, pill: true)
        }
      }
      .frame(height: Measure.Templates.rowBoneHeight * 2 + Measure.Hub.timerSkeletonBone * 2 + Measure.Hub.timerSkeletonGap * 3)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Loading")
  }

  @ViewBuilder
  private func bone(_ width: CGFloat, _ height: CGFloat, pill: Bool = false) -> some View {
    if pill {
      Capsule().fill(theme.line).frame(width: width, height: height)
    } else {
      RoundedRectangle(cornerRadius: theme.radiusSm).fill(theme.line).frame(width: width, height: height)
    }
  }

  @ViewBuilder
  private var editor: some View {
    let notes = self.notes
    let counting = self.counting
    if let existing {
      Callout {
        Text(
          "It already has a timer: \(SelfDestruct.describeTimer(ScheduleModel.ruleOfTimerRow(existing), now: now)) The rule below takes its place."
        )
      }
    }
    VStack(alignment: .leading, spacing: Measure.Hub.subGap) {
      FieldLabel("Start counting")
      Segmented(label: "Start counting", options: startOptions, selection: $start, size: .small)
        .accessibilityIdentifier("timer-dialog-start")
    }
    LifespanRuleEditor(
      value: ruleNow,
      onChange: { next in
        var on = next
        on.enabled = true
        rule = on
      },
      fit: fit, limits: limits, did: owner, showToggle: false, holds: holds, countFrom: counting.from,
      transport: app.archiveEnvironment.transport)
    if notes.fitted.enabled, notes.room.isEmpty,
      let acts = LifespanModel.firstActAt(notes.fitted, startedAt: counting.startedAt, now: now), acts.isFinite
    {
      FieldHint("\(firstActsLead(notes: notes, counting: counting)) first acts \(ScheduleModel.formatInZone(.number(acts), nil, now: now)).")
        .accessibilityAddTraits(.updatesFrequently)
        .accessibilityIdentifier("timer-dialog-acts")
    }
  }

  private var startOptions: [SegmentedOption<String>] {
    let at = JSDate.parse(postedAt ?? "", timeZone: AppLocale.activeTimeZone())
    return [
      SegmentedOption("now", "From now"),
      SegmentedOption(
        "posted", at.isFinite ? "From when it went up (\(Time.relativeTime(at, now: now)))" : "From when it went up"),
    ]
  }

  private func firstActsLead(notes: LifespanEditorNotes, counting: TimerStartPoint) -> String {
    switch counting.passed {
    case "elapsed":
      return "It went up more than \(SelfDestruct.formatLifespan(notes.fitted.lifespanSeconds)) ago, so the time counts from now instead. It"
    case "floor":
      return "That’s less than \(SelfDestruct.minLifespanSeconds / 60) minutes away, the soonest a timer can act, so it"
    default:
      return "It"
    }
  }

  // MARK: Reading and setting

  private func read() async {
    error = ""
    busy = ""
    start = "now"
    now = SyncStatus.now()
    let owner = self.owner
    let settings = PostingPages.settings(app, owner)
    rule = SelfDestruct.defaultRuleFromSettings(settings.lifespan.json)
    rule.enabled = true
    phase = .loading
    limits = nil
    existing = nil
    reply = post.reply ?? false
    postedAt = post.postedAt
    let req = self.req
    let transport = app.archiveEnvironment.transport
    let uri = post.uri
    let needsView = post.reply == nil || post.postedAt == nil
    async let readLimits = Self.limits(req)
    async let readTimers = Self.timers(req)
    async let readView = Self.postView(needsView ? uri : nil, transport: transport)
    let (gotLimits, gotTimers, view) = await (readLimits, readTimers, readView)
    guard !Task.isCancelled else { return }
    let found = gotTimers?.rows.first { row in
      (row["postUri"]?.stringValue).jsEquals(uri) && TimerService.isLiveTimer(row)
    }
    if let found { rule = ScheduleModel.ruleOfTimerRow(found) }
    limits = gotLimits
    existing = found
    reply = post.reply ?? (view?["record"]?["reply"]?.isTruthy ?? false)
    postedAt =
      post.postedAt ?? view?["record"]?["createdAt"].flatMap { $0.isTruthy ? $0.stringValue : nil }
      ?? view?["indexedAt"].flatMap { $0.isTruthy ? $0.stringValue : nil }
    now = SyncStatus.now()
    phase = .ready
  }

  private static func limits(_ req: VirgaBackend?) async -> JSONValue? {
    guard let req else { return nil }
    return try? await ScheduleService.getLimits(req)
  }

  private static func timers(_ req: VirgaBackend?) async -> TimerList? {
    guard let req else { return nil }
    return try? await TimerService.listTimers(req)
  }

  /// The post as Bluesky has it, for whether it's a reply and when it went up.
  private static func postView(_ uri: String?, transport: any HTTPTransport) async -> JSONValue? {
    guard let uri else { return nil }
    let body = try? await PublicAppView.publicXrpc("app.bsky.feed.getPosts", ["uris": .array([.string(uri)])], transport: transport)
    return body?["posts"]?[0]
  }

  private func arm() async {
    busy = "arming"
    error = ""
    defer { busy = "" }
    let at = SyncStatus.now()
    // Read again at the press: the render's clock can be minutes old.
    let started = LifespanModel.timerStart(ruleNow, start: start, postedAt: postedAt, now: at).startedAt
    let out = await TimerService.createTimer(
      req, uri: post.uri, cid: post.cid, extraUris: post.extraUris, snippet: .string(post.text),
      postedAt: JSDate.toISOString(started), rule: rule, fit: SelfDestruct.composerTimerFit(reply: reply), now: at)
    switch out.status {
    case "armed":
      onArmed(out.row)
    case "confirming":
      busy = "confirming"
      guard let confirmation = out.confirmation else { return }
      let outcome = await confirmation.value
      if outcome.status == "armed" {
        onArmed(outcome.row ?? out.row)
        return
      }
      error =
        outcome.status == "failed"
        ? ScheduledPostError.scheduleErrorMessage(outcome.error)
        : "Virga’s server didn’t answer, so it isn’t clear whether the timer was set. Posting › Timers shows it if it was."
    case "none":
      error = "This rule can’t apply to this post, so there’s nothing to set."
    default:
      error = ScheduledPostError.scheduleErrorMessage(out.error)
    }
  }
}
#endif
