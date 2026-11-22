// Ports src/posting/pages/TimersPage.jsx
// Ports src/posting/pages/schedule.css (.sched-page, .sched-timer, .sched-rule, .sched-row-why, .sched-acted, .sched-settled, .sched-limits)
// Ports src/posting/pages/scheduleParts.jsx (ActionDialog, as the Timers page asks before calling a timer off)
//
// Posts on a timer: what's counting down (and when each acts), scheduled
// posts that start a timer when they go out, and timers that gave up, each
// a list headed by its count. What the settled ones did is behind a
// disclosure at the foot, read only when it's opened. Calling a timer off
// keeps the post: nothing on this page deletes anything.
//
// Three reads, each failing alone: the timers (Virga's server), the
// settled ones (when the disclosure opens), and the scheduled posts with
// the account's limits. Countdowns move on every 30 seconds, and a timer
// that has come due is looked for again. Posts a timer deleted leave the
// archive too: the settled list is read once a visit, and again whenever
// a timer that was counting down drops off.
//
// iOS: the focus after a row goes is the system's to place. A row whose
// model can't be worked out (timerRowModel throws on a corrupt `acted`) is
// left out where the web's page would fail.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting
import VirgaSession

/// What the Timers page reads of the scheduled posts: the rows and the limits.
struct TimersScheduledRead {
  var rows: [JSONValue]
  var limits: JSONValue?
}

/// Deleted posts already passed to the archive this launch, per account.
@MainActor
enum TimersReported {
  static var seen: [String: Set<String>] = [:]

  /// `reportDeleted(did, rows)`: hands the posts a timer deleted to the
  /// archive, once each.
  static func report(_ did: String, _ rows: [JSONValue]) {
    var known = seen[did] ?? []
    let prefix = "at://\(did)/".utf16
    let fresh = ScheduleModel.deletedPostUris(rows).filter { !known.contains($0) && $0.utf16.starts(with: prefix) }
    guard !fresh.isEmpty else { return }
    for uri in fresh { known.insert(uri) }
    seen[did] = known
    // The archive catches up on its next sync if this fails.
    _ = try? PostingEvents.emitPostsChanged(did, removed: fresh.map(JSONValue.string))
  }
}

/// The call-off question over the page while `row` is set.
struct TimersCancelAsk: Identifiable {
  var row: JSONValue
  var id: String { row["id"]?.jsString ?? "" }
}

struct TimersPage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(ComposerHost.self) private var composer: ComposerHost?
  @Environment(AppModel.self) private var app
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  let did: String?
  @State private var timers = PostingLoad<TimerList>()
  @State private var settled = PostingLoad<TimerList>()
  @State private var scheduled = PostingLoad<TimersScheduledRead>()
  @State private var history = false
  @State private var now = SyncStatus.now()
  @State private var busy: Set<String> = []
  @State private var asking: TimersCancelAsk?
  @State private var liveIds: Set<String>?

  private var req: VirgaBackend? { app.session.backendFor(did) }

  var body: some View {
    let tz = PostingQueue.resolveTimezone(PostingPages.settings(app, did).queue.json)
    let rows = timers.data?.rows ?? []
    let waiting = SelfDestruct.waitingTimerRows(scheduled.data?.rows ?? [])
    // The lists on the page: counting down, waiting, gave up. The week's
    // settled ones the default read brings go under the disclosure.
    let groups = ScheduleModel.timerSections(SelfDestruct.groupTimers(rows).filter { $0.key != "settled" }, waiting)
    let liveRows = rows.filter { $0["status"] == "armed" || $0["status"] == "checking" }
    let limitsLine = ScheduleModel.timerLimitsLine(
      scheduled.data?.limits, SelfDestruct.timerUsage(liveRows: liveRows, scheduledRows: scheduled.data?.rows ?? []))
    let full = ScheduleModel.fullTimerBuckets(scheduled.data?.limits)
    let loading = timers.phase == .loading
    let unreadable = timers.phase == .failed
    let unavailable = timers.data?.unavailable == true
    VirgaPage(PostingHeader.model("timers")) {
      VStack(alignment: .leading, spacing: theme.sectionGap) {
        ForEach(full, id: \.self) { line in
          Callout(tone: .warn) { Text(line) }
        }
        if unreadable {
          LoadError(message: "Couldn’t read \(name)’s timers. \(ScheduledPostError.scheduleErrorMessage(timers.error))") {
            timers.reload()
          }
        } else if unavailable {
          VirgaSection(
            title: "Post timers aren’t available yet",
            sub: "Virga’s server can’t hold timers right now. Posts can still be deleted by hand from Posting › Posted."
          ) {
            EmptyView()
          }
        } else if loading {
          VirgaSection(flush: true) { RowSkeleton(rows: 3, actions: 1) }
            .accessibilityLabel("Loading timers")
        } else if groups.isEmpty {
          empty
        } else {
          ForEach(Array(groups.enumerated()), id: \.element.key) { index, group in
            section(group, first: index == 0, tz: tz)
          }
        }
        closing(loading: loading, unreadable: unreadable, unavailable: unavailable, limitsLine: limitsLine)
      }
    }
    .task(id: did ?? "") { start() }
    .task(id: did ?? "") { await tick() }
    .onDisappear {
      timers.stop()
      settled.stop()
      scheduled.stop()
    }
    // On every answer, as the web's effects on `timers.data` and
    // `settled.data` run: a first read with nothing counting down still
    // reads the settled list once.
    .onChange(of: timers.stamp) { _, _ in reportDropped(timers.data?.rows ?? []) }
    .onChange(of: settled.stamp) { _, _ in
      if let did, let rows = settled.data?.rows { TimersReported.report(did, rows) }
    }
    .modifier(TimersCancelDialog(asking: $asking, onConfirm: callOff))
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("timers-page")
  }

  private var name: String {
    Accounts.accountName(app.session.accounts.first { Optional($0.did).jsEquals(did) })
  }

  // MARK: Reads

  private func start() {
    let req = self.req
    let key = did ?? ""
    timers.follow(key: key, did: did, events: [PostingEvents.timersChangedEvent], enabled: req != nil) {
      try await TimerService.listTimers(req)
    }
    scheduled.follow(
      key: key, did: did, events: [PostingEvents.scheduledChangedEvent, PostingEvents.timersChangedEvent], enabled: req != nil
    ) {
      let list = try await ScheduleService.listScheduled(req)
      let limits = try? await ScheduleService.getLimits(req)
      return TimersScheduledRead(rows: list.rows, limits: limits)
    }
    followSettled(open: history)
  }

  /// Every settled timer, read while the disclosure is open: a read of its
  /// own, so the lists above stay on screen while it runs.
  private func followSettled(open: Bool) {
    let req = self.req
    settled.follow(key: "\(did ?? ""):settled", did: did, events: [PostingEvents.timersChangedEvent], enabled: req != nil && open) {
      try await TimerService.listTimers(req, history: true)
    }
  }

  /// Countdowns move on, and a timer that has come due is looked for again.
  private func tick() async {
    while !Task.isCancelled {
      try? await Task.sleep(nanoseconds: UInt64(Measure.Hub.timersTickSeconds * 1_000_000_000))
      if Task.isCancelled { return }
      let at = SyncStatus.now()
      now = at
      let due = (timers.data?.rows ?? []).contains { row in
        guard row["status"] == "armed" else { return false }
        let check = JSDate.parse(row["checkAt"]?.stringValue ?? "", timeZone: AppLocale.activeTimeZone())
        return check.isFinite && check <= at - Measure.Hub.timersDueSlackMs
      }
      if due { timers.reload() }
    }
  }

  /// The default list leaves deleted timers out, so the settled list is
  /// read once a visit, and again whenever a timer counting down drops off.
  private func reportDropped(_ rows: [JSONValue]) {
    guard let did, let req, timers.data != nil else { return }
    let live = Set(rows.filter { $0["status"] == "armed" || $0["status"] == "checking" }.compactMap { $0["id"]?.jsString })
    let before = liveIds
    liveIds = live
    let dropped = before.map { !$0.isSubset(of: live) } ?? true
    guard dropped else { return }
    Task {
      if let out = try? await TimerService.listTimers(req, history: true) { TimersReported.report(did, out.rows) }
    }
  }

  // MARK: The parts

  private var empty: some View {
    VStack(alignment: .leading, spacing: theme.points(ThemeKit.emptyBlockGap)) {
      emptySentence
      Button("New post") { openComposer(["asDid": PostingPages.asDid(did)]) }
        .buttonStyle(.virga)
        .accessibilityIdentifier("timers-new-post")
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("timers-empty")
  }

  private var emptySentence: some View {
    var words = AttributedString("No posts on a timer. Give a new post a timer in the composer, or put one that’s out on a timer from ")
    var link = AttributedString("Posted")
    link.link = URL(string: "virga-route:posted")
    words += link
    words += AttributedString(".")
    return Text(words)
      .virgaText(.textBase)
      .foregroundStyle(theme.muted)
      .tint(theme.ink)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: theme.characters(Measure.Section.emptyMeasure, size: theme.textBase), alignment: .leading)
      .environment(\.openURL, OpenURLAction { _ in
        navigate(PostingRoutes.postingPageByKey["posted"]?.path ?? PostingRoutes.postingBase)
        return .handled
      })
  }

  /// '1 post counting down', '2 timers gave up, posts still up'.
  static func groupTitle(_ key: String, _ n: Int) -> String {
    let posts = n == 1 ? "1 post" : "\(n) posts"
    switch key {
    case "live": return "\(posts) counting down"
    case "waiting": return "\(posts) waiting to go out"
    case "failed": return n == 1 ? "1 timer gave up, post still up" : "\(n) timers gave up, posts still up"
    default: return ""
    }
  }

  private func section(_ group: TimerGroup, first: Bool, tz: String) -> some View {
    VirgaSection(
      title: Self.groupTitle(group.key, group.rows.count),
      sub: first ? "Calling a timer off keeps the post. Nothing on this page deletes anything." : nil, flush: true
    ) {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(group.rows, id: \.self) { row in
          if group.key == "waiting" {
            TimersWaitingRow(row: row, tz: tz, now: now) { r in
              editScheduled(r)
            }
          } else {
            timerRow(row)
          }
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("timers-\(group.key)")
  }

  @ViewBuilder
  private func timerRow(_ row: JSONValue) -> some View {
    if let model = try? ScheduleModel.timerRowModel(row, now: now) {
      TimersTimerRow(row: row, model: model, now: now, busy: busy.contains(row["id"]?.jsString ?? "")) {
        asking = TimersCancelAsk(row: row)
      }
    }
  }

  @ViewBuilder
  private func closing(loading: Bool, unreadable: Bool, unavailable: Bool, limitsLine: String) -> some View {
    VStack(alignment: .leading, spacing: theme.space3) {
      if scheduled.phase == .failed {
        FieldHint("Couldn’t read the scheduled posts, so ones that start a timer when they go out aren’t shown.")
      }
      if !loading && !unreadable && !unavailable {
        Disclosure("Show settled timers") {
          // One container, there while the disclosure is open: the list
          // inside it changes from bones to rows without reading this as
          // closing and opening again.
          VStack(alignment: .leading, spacing: 0) {
            settledList
          }
          .onAppear {
            history = true
            followSettled(open: true)
          }
          .onDisappear {
            history = false
            followSettled(open: false)
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("timers-settled")
      }
      if !limitsLine.isEmpty {
        Text(limitsLine)
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: theme.measure, alignment: .leading)
          .accessibilityIdentifier("timers-limits")
      }
    }
    // The page's closing lines sit close under its last section.
    .padding(.top, -theme.sectionGap + theme.space3)
  }

  @ViewBuilder
  private var settledList: some View {
    let rows = SelfDestruct.groupTimers(settled.data?.rows ?? [], history: true).first { $0.key == "settled" }?.rows ?? []
    if settled.phase == .failed {
      LoadError(message: "Couldn’t read \(name)’s settled timers. \(ScheduledPostError.scheduleErrorMessage(settled.error))") {
        settled.reload()
      }
    } else if settled.data == nil {
      RowSkeleton(rows: 2)
    } else if !rows.isEmpty {
      VStack(alignment: .leading, spacing: 0) {
        Rectangle().fill(theme.rule).frame(height: Measure.Hub.settledRule)
        ForEach(rows, id: \.self) { row in timerRow(row) }
      }
    } else {
      Text("No timer has settled in a while.")
        .virgaText(.textBase)
        .foregroundStyle(theme.muted)
    }
  }

  // MARK: Actions

  private func openComposer(_ intent: JSONValue) {
    if let composer { composer.open(intent) } else { navigate("/posting/compose") }
  }

  /// A waiting post's Edit: `composer.open({ scheduledId, asDid })`.
  private func editScheduled(_ row: JSONValue) {
    let intent: JSONValue = ["scheduledId": row["id"] ?? .null, "asDid": PostingPages.asDid(did)]
    openComposer(intent)
  }

  /// Calling a timer off (or dismissing one that gave up): the post stays.
  private func callOff(_ row: JSONValue) async throws {
    let id = row["id"]?.jsString ?? ""
    busy.insert(id)
    defer { busy.remove(id) }
    do {
      _ = try await TimerService.cancelTimer(req, row["id"] ?? .null)
      toasts?.push(row["status"] == "failed" ? "Dismissed." : "The timer is off. The post stays up.")
    } catch {
      // The worker may hold it: what's on screen is read again, never patched.
      timers.reload()
      let status = ScheduledPostError.errorObject(error)["status"]
      if PostingPages.code(error) == "NOT_CANCELLABLE" || status == .number(409) {
        throw PostingPagesError("This timer is being checked right now, or has already acted, so it can’t be called off.")
      }
      throw PostingPagesError(ScheduledPostError.scheduleErrorMessage(error))
    }
  }
}

// MARK: - Rows

/// A timer: the post's words (the way to the post, so the row needs no
/// button for that), when it acts as the line's key fact, what it does,
/// and Call off. One that gave up says so in red, once.
struct TimersTimerRow: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  let row: JSONValue
  let model: TimerRowModel
  let now: Double
  let busy: Bool
  let onCancel: () -> Void

  var body: some View {
    let url = TimerService.timerPostUrl(row).flatMap { URL(string: $0) }
    var meta = [MetaItem(model.when, isKey: model.live)]
    if model.live, let check = row["checkAt"], check.isTruthy {
      meta.append(MetaItem(ScheduleModel.formatInZone(check, nil, now: now)))
    }
    if !model.live, let resolved = row["resolvedAt"], resolved.isTruthy {
      meta.append(MetaItem(ScheduleModel.formatInZone(resolved, nil, now: now)))
    }
    meta.append(MetaItem(model.bucket == "conditional" ? "Conditional timer" : "Plain timer"))
    if !model.extensions.isEmpty { meta.append(MetaItem(model.extensions)) }
    let words = VStack(alignment: .leading, spacing: Measure.Hub.rowLineGap) {
      if let url {
        Button {
          openURL(url)
        } label: {
          HubRowText(text: model.text, placeholder: "A post with no words of its own")
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
        .accessibilityHint("Open on Bluesky")
      } else {
        HubRowText(text: model.text, placeholder: "A post with no words of its own")
      }
      MetaLine(meta)
      Text(model.rule)
        .virgaText(.textSm)
        .foregroundStyle(theme.ink2)
        .fixedSize(horizontal: false, vertical: true)
      if !model.failure.isEmpty { HubRowWhy(text: model.failure, tone: .danger) }
      if !model.resolution.isEmpty { HubRowWhy(text: model.resolution) }
      if !model.acted.isEmpty { TimersActed(acted: model.acted) }
    }
    var button: AnyView?
    if model.canCancel {
      button = AnyView(
        Button(model.cancelLabel, action: onCancel)
          .buttonStyle(.virga(size: .small))
          .disabled(busy)
          .accessibilityIdentifier("timer-cancel"))
    }
    return HubCornerRow(words: words, button: button, menu: nil)
      .opacity(busy ? Measure.Hub.busyOpacity : 1)
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("timer-row")
  }
}

/// `.sched-acted`: what a settled timer did, each with its mark.
struct TimersActed: View {
  @Environment(\.virgaTheme) private var theme
  let acted: [TimerActed]

  var body: some View {
    VStack(alignment: .leading, spacing: Measure.Hub.actedGap) {
      ForEach(Array(acted.enumerated()), id: \.offset) { _, step in
        HStack(alignment: .center, spacing: Measure.Hub.actedItemGap) {
          Image(systemName: step.ok ? HubGlyph.acted : HubGlyph.skipped)
            .font(.system(size: Measure.Hub.actedGlyph))
            .foregroundStyle(step.ok ? theme.ok : theme.muted)
            .accessibilityHidden(true)
          Text(step.text)
            .virgaText(.textSm)
            .foregroundStyle(step.ok ? theme.ink : theme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
    }
    .padding(.top, Measure.Hub.actedAbove)
  }
}

/// A scheduled post that starts a timer when it goes out.
struct TimersWaitingRow: View {
  @Environment(\.virgaTheme) private var theme
  let row: JSONValue
  let tz: String
  let now: Double
  let onEdit: (JSONValue) -> Void

  var body: some View {
    let facts = ScheduleModel.rowFacts(row, now: now)
    // `{ ...row.payload.selfDestruct, enabled: true }`: anything but an
    // object spreads as nothing.
    var stored: JSONValue = [:]
    if let given = row["payload"]?["selfDestruct"], given.objectValue != nil { stored = given }
    stored["enabled"] = true
    let timer = SelfDestruct.readStoredTimer(stored).timer
    let actions = ScheduleModel.rowActions(row, now: now)
    var meta = [
      MetaItem(
        row["status"] == "publishing" ? "Going out now" : "Goes out \(ScheduleModel.formatInZone(row["scheduledFor"], tz, now: now))",
        isKey: true),
      MetaItem(row["queued"]?.isTruthy == true ? "From the queue" : "At a set time"),
    ]
    if facts.posts > 1 { meta.append(MetaItem("Thread of \(facts.posts)")) }
    let words = VStack(alignment: .leading, spacing: Measure.Hub.rowLineGap) {
      HubRowText(text: facts.text, placeholder: "A post with media")
      MetaLine(meta)
      Text(SelfDestruct.describeTimer(timer, now: now))
        .virgaText(.textSm)
        .foregroundStyle(theme.ink2)
        .fixedSize(horizontal: false, vertical: true)
      HubRowWhy(text: "Its timer starts counting when it goes out.")
    }
    var edit: AnyView?
    if actions.edit && row["status"] == "pending" {
      edit = AnyView(
        Button("Edit") { onEdit(row) }
          .buttonStyle(.virga(size: .small))
          .accessibilityIdentifier("timer-waiting-edit"))
    }
    return HubCornerRow(words: words, button: edit, menu: nil)
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("timer-waiting-row")
  }
}

// MARK: - The question

/// `ActionDialog`, as the Timers page asks it: what calling the timer off
/// does, a way out ("Keep it"), and the action. A refusal's words stay in
/// the dialog.
struct TimersCancelDialog: ViewModifier {
  @Binding var asking: TimersCancelAsk?
  let onConfirm: (JSONValue) async throws -> Void
  @State private var busy = false
  @State private var error = ""

  func body(content: Content) -> some View {
    let failed = asking?.row["status"] == "failed"
    content
      .virgaDialog(
        isPresented: Binding(get: { asking != nil }, set: { if !$0 && !busy { asking = nil } }),
        title: failed ? "Dismiss this timer?" : "Call this timer off?"
      ) {
        VStack(alignment: .leading, spacing: Measure.Hub.confirmGap) {
          Text(failed ? "It goes from this list. The post stays up." : "The post stays up, as it is now, and its timer slot is freed.")
            .fixedSize(horizontal: false, vertical: true)
          let snippet = asking?.row["snippet"]?.jsString ?? ""
          if asking?.row["snippet"]?.isTruthy == true { HubQuote(text: snippet.jsSlice(0, Measure.Hub.cancelQuoteMax)) }
          if !error.isEmpty { Callout(tone: .danger) { Text(error) } }
        }
        .fixedSize(horizontal: false, vertical: true)
      } actions: {
        Button("Keep it") { asking = nil }
          .buttonStyle(.virga)
          .disabled(busy)
        Button(busy ? "Calling it off…" : failed ? "Dismiss" : "Call it off") { Task { await confirm() } }
          .buttonStyle(.virga(.primary))
          .disabled(busy)
          .accessibilityIdentifier("timer-cancel-confirm")
      }
      .onChange(of: asking?.id) { _, _ in error = "" }
  }

  private func confirm() async {
    guard let row = asking?.row else { return }
    busy = true
    error = ""
    defer { busy = false }
    do {
      try await onConfirm(row)
      asking = nil
    } catch {
      let said = (error as? LocalizedError)?.errorDescription ?? ""
      self.error = said.isEmpty ? "That didn’t work. Try again." : said
    }
  }
}
#endif
