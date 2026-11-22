// Ports src/posting/pages/DraftsPage.jsx
// Ports src/posting/pages/hub.css (.draft-text, .hub-row-note, .has-corner-menu as the drafts' rows use it)
// Ports src/posting/pages/schedule.css (.when-dialog: Schedule this draft's buttons, one under another on a phone)
//
// The account's Bluesky drafts: open one in the composer, post it now,
// schedule it, or delete it. Drafts are private to the account and shared
// with every app that reads them; pictures in them stay on the device that
// saved them. Post now and Schedule go through DraftActions (draftActions.js)
// with the app's services (DraftActionDeps.live): the draft opened with the
// account's defaults, its default timer kept only where it can be set, then
// published or scheduled, and deleted only once that has worked.
//
// /posting/drafts/<id> opens that draft in the composer and goes back to
// /posting/drafts. Files kept for drafts that were posted or deleted in
// another app are cleared out once a launch, after the list reads, while the
// composer is closed.
//
// Schedule this draft's time is WhenPicker (Posting/WhenPicker.swift) on
// the account's queue clock, given the account's weekly schedule and its
// server session, as DraftsPage.jsx passes `did`. iOS: the focus after a
// row goes is the system's to place.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaInsights
import VirgaNetwork
import VirgaPosting
import VirgaSession

/// `useDraftList(did)`: the account's drafts a page at a time, read again
/// when the drafts change.
@MainActor
@Observable
final class DraftsPageList {
  enum Phase: Equatable {
    case loading, ready, failed
  }

  private(set) var phase: Phase = .loading
  private(set) var views: [JSONValue] = []
  private(set) var cursor: JSONValue = .null
  private(set) var error: (any Error)?
  private(set) var loadingMore = false

  @ObservationIgnored private let session: SessionModel
  @ObservationIgnored private let did: String?
  @ObservationIgnored private var token = 0
  @ObservationIgnored private var stop: PostingEventUnsubscribe?

  init(session: SessionModel, did: String?) {
    self.session = session
    self.did = did
  }

  var hasMore: Bool { cursor.isTruthy }

  func start() {
    guard stop == nil else { return }
    load()
    if let did, !did.isEmpty {
      stop = try? PostingEvents.onPostingEvent(PostingEvents.draftsChangedEvent, did: did) { [weak self] _ in
        Task { @MainActor [weak self] in self?.load() }
      }
    }
  }

  func end() {
    stop?()
    stop = nil
    token += 1
  }

  func reload() { load() }
  func loadMore() { load(append: true) }

  private func load(append: Bool = false) {
    token += 1
    let mine = token
    if append { loadingMore = true } else { error = nil }
    let cursor = append ? self.cursor : JSONValue.null
    let session = self.session
    let did = self.did
    Task { @MainActor [weak self] in
      do {
        let agent = try await session.agentFor(did)
        let page = try await Drafts.listDrafts(
          agent, cursor: cursor.isTruthy ? cursor : nil, limit: .number(Double(Measure.Hub.draftsPage)))
        guard let self, mine == self.token else { return }
        if append {
          let known = self.views.compactMap { $0["id"] }
          self.views += page.drafts.filter { d in !known.contains { PostingPages.sameValue($0, d["id"]) } }
        } else {
          self.views = page.drafts
        }
        self.cursor = page.cursor
        self.error = nil
        self.loadingMore = false
        self.phase = .ready
      } catch {
        guard let self, mine == self.token else { return }
        self.error = error
        self.loadingMore = false
        self.phase = self.views.isEmpty ? .failed : .ready
      }
    }
  }
}

/// A line over the list after a quick action: a warning (what came along
/// differently) or a failure; `scope` when it was the posting permission.
struct DraftsNotice: Equatable {
  var danger: Bool
  var text: String
  var scope = false
}

struct DraftsPage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(ComposerHost.self) private var composer: ComposerHost?
  @Environment(AppModel.self) private var app
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  let did: String?
  let id: String?
  @State private var list: DraftsPageList
  @State private var busy: String?
  @State private var notice: DraftsNotice?
  @State private var deleting: JSONValue?
  @State private var scheduling: JSONValue?
  @State private var opened = false

  /// Accounts whose stray draft files have been cleared out this launch.
  @MainActor static var prunedMedia = Set<String>()

  init(session: SessionModel, did: String?, id: String? = nil) {
    self.did = did
    self.id = id
    _list = State(initialValue: DraftsPageList(session: session, did: did))
  }

  private var caps: AccountCapabilities { app.session.capabilitiesFor(did) }

  var body: some View {
    let rows = HubModel.draftRows(.array(list.views), deviceId: PostingPages.deviceId(app))
    let scopeError = list.phase == .failed && Scopes.isMissingScopeError(list.error)
    VirgaPage(PostingHeader.model("drafts")) {
      PostingPermissionNotice(did: did ?? "", force: scopeError || notice?.scope == true)
      if let notice, !notice.scope {
        // `role={tone === 'danger' ? 'alert' : 'status'}`: a failure is the
        // words-alone callout's alert; a warning is read out as it arrives.
        Callout(tone: notice.danger ? .danger : .warn, notice.text)
          .toolAnnounces(notice.danger ? nil : notice.text, onAppear: true)
          .accessibilityIdentifier("drafts-notice")
      }
      if list.phase == .ready && rows.isEmpty {
        // Nothing to list, so no heading over nothing: the sentence and the way to start one.
        empty
      } else if list.phase == .failed {
        if scopeError {
          EmptyState("Your drafts can’t be read until Virga has permission.")
        } else {
          LoadError(message: "Your drafts couldn’t be read from Bluesky. Check the connection and try again.") { list.reload() }
        }
      } else {
        section(rows)
      }
    }
    .task {
      list.start()
      openFromAddress()
    }
    .onDisappear { list.end() }
    .onChange(of: list.phase) { _, phase in if phase == .ready { prune() } }
    // And once the composer closes, as the web's effect on composerOpen
    // does: /posting/drafts/<id> opens it before the list is read.
    .onChange(of: composer?.isOpen ?? false) { _, open in if !open && list.phase == .ready { prune() } }
    .postingConfirm(
      isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), title: "Delete this draft?",
      onConfirm: { if let row = deleting { try await remove(row) } }
    ) {
      VStack(alignment: .leading, spacing: Measure.Hub.confirmGap) {
        Text(
          "It goes from your Bluesky account, so the Bluesky app and anything else that reads your drafts loses it too. This can’t be undone."
        )
        .fixedSize(horizontal: false, vertical: true)
        let words = (deleting?["text"]?.stringValue ?? "").jsTrimmed()
        if !words.isEmpty { HubQuote(text: words.jsSlice(0, Measure.Hub.deleteQuoteMax)) }
      }
    }
    .sheet(isPresented: Binding(get: { scheduling != nil }, set: { if !$0 { scheduling = nil } })) {
      if let row = scheduling {
        ScheduleDraftDialog(
          row: row, did: did, queueSettings: PostingPages.settings(app, did).queue.json, onClose: { scheduling = nil }
        ) { scheduledFor, queued in
          try await schedule(row, scheduledFor: scheduledFor, queued: queued)
        }
        .presentationDetents([.large])
        .presentationBackground(theme.surface)
        .presentationCornerRadius(Measure.Dialog.radius)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("drafts-page")
  }

  private var empty: some View {
    VStack(alignment: .leading, spacing: theme.points(ThemeKit.emptyBlockGap)) {
      Text("No drafts yet. Start a post and choose Save draft: it waits here, private to your account, until you’re ready.")
        .virgaText(.textBase)
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: theme.characters(Measure.Section.emptyMeasure, size: theme.textBase), alignment: .leading)
      Button {
        openComposer(["asDid": PostingPages.asDid(did)])
      } label: {
        Label("New post", systemImage: HubGlyph.newPost)
      }
      .buttonStyle(.virga)
      .accessibilityIdentifier("drafts-new-post")
    }
  }

  private func section(_ rows: [JSONValue]) -> some View {
    let more = list.hasMore
    let title =
      list.phase == .ready && !rows.isEmpty
      ? "\(AppLocale.formatNumber(rows.count))\(more ? "+" : "") \(rows.count == 1 && !more ? "draft" : "drafts")" : "Drafts"
    // The section's `.card-caption`s, under the list and its foot.
    var captions: [String] = []
    if list.phase == .ready && rows.count >= Measure.Hub.manyDrafts {
      captions.append("Bluesky may stop keeping new drafts past a limit. If one won’t save: \(Drafts.draftLimitMessage)")
    }
    if !caps.canSchedule && !rows.isEmpty {
      captions.append("Scheduling a draft needs a long session. Settings › Account offers one.")
    }
    return VirgaSection(
      title: title, sub: "The latest edit first. Pictures stay on the device that saved them.", flush: true, captions: captions
    ) {
      if list.phase == .loading {
        RowSkeleton(rows: 4, actions: 1)
      } else {
        let now = SyncStatus.now()
        VStack(alignment: .leading, spacing: 0) {
          ForEach(rows, id: \.self) { row in
            draftRow(row, now: now)
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("drafts-list")
      }
      if list.phase == .ready && more {
        SectionFoot(letOut: .small) {
          Button(list.loadingMore ? "Loading…" : "Show more") { list.loadMore() }
            .buttonStyle(.virga(.ghost, size: .small))
            .disabled(list.loadingMore)
        }
      }
    }
  }

  // MARK: A row

  private func draftRow(_ row: JSONValue, now: Double) -> some View {
    let postBlock = DraftActions.draftPostBlock(row, canPost: caps.canPost)
    let scheduleBlock = DraftActions.draftScheduleBlock(row, canSchedule: caps.canSchedule)
    let working = busy != nil && busy == row["id"]?.jsString
    let why = [postBlock, !scheduleBlock.isEmpty && caps.canSchedule ? scheduleBlock : ""].filter { !$0.isEmpty }.joined(separator: " ")
    let text = row["text"]?.stringValue ?? ""
    let trimmed = text.jsTrimmed().jsSlice(0, Measure.Hub.draftName)
    let name = trimmed.isEmpty ? "with no text" : trimmed
    let entries = menuEntries(row, postBlock: postBlock, scheduleBlock: scheduleBlock)
    let words = VStack(alignment: .leading, spacing: Measure.Hub.rowLineGap) {
      HubRowText(text: text, placeholder: "No text yet", lines: Measure.Hub.draftTextLines)
      MetaLine(DraftActions.draftMeta(row, now: now))
      if row["mediaElsewhere"]?.isTruthy == true {
        HubRowWhy(text: "Its pictures were saved on another device. Open it to attach them again before posting.", tone: .warn)
      } else if !why.isEmpty {
        HubRowWhy(text: why)
      }
    }
    let open = Button("Open") { openDraft(row) }
      .buttonStyle(.virga(size: .small))
      .disabled(busy != nil)
      .accessibilityLabel("Open the draft “\(name)”")
      .accessibilityIdentifier("draft-open")
    return HubCornerRow(
      words: words, button: open,
      menu: entries.isEmpty
        ? nil : AnyView(DraftsRowMenu(label: "More for the draft “\(name)”", entries: entries, working: working))
    )
    .opacity(working ? Measure.Hub.busyOpacity : 1)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("draft-row-\(row["id"]?.jsString ?? "")")
  }

  /// What a draft can do beyond Open: post it, schedule it, and deleting it
  /// last. A step that can't be taken just now isn't offered; the line
  /// under the draft says why.
  private func menuEntries(_ row: JSONValue, postBlock: String, scheduleBlock: String) -> [MenuEntry] {
    var items: [MenuEntry] = []
    if postBlock.isEmpty {
      items.append(.item(MenuItem("Post now", key: "post", systemImage: HubGlyph.post, accessibilityIdentifier: "draft-post-now") { postNow(row) }))
    }
    if scheduleBlock.isEmpty {
      items.append(
        .item(MenuItem("Schedule…", key: "schedule", systemImage: HubGlyph.schedule, accessibilityIdentifier: "draft-schedule") {
          if busy == nil { scheduling = row }
        }))
    }
    if caps.canPost {
      if !items.isEmpty { items.append(.separator) }
      items.append(
        .item(
          MenuItem("Delete draft", key: "delete", systemImage: HubGlyph.trash, destructive: true, accessibilityIdentifier: "draft-delete") {
            if busy == nil { deleting = row }
          }))
    }
    return items
  }

  // MARK: Actions

  private func openComposer(_ intent: JSONValue) {
    if let composer { composer.open(intent) } else { navigate("/posting/compose") }
  }

  private func openDraft(_ row: JSONValue) {
    openComposer(PostingPages.draftIntent(row["id"], did))
  }

  /// /posting/drafts/<id> opens that draft in the composer.
  private func openFromAddress() {
    guard let id, !opened else { return }
    opened = true
    openComposer(PostingPages.draftIntent(.string(id), did))
    navigate(PostingRoutes.postingPageByKey["drafts"]?.path ?? "/posting/drafts")
  }

  /// Files kept for drafts that were posted or deleted in another app are
  /// cleared out once a launch, after the list reads; not while the
  /// composer is open (a save there may be between keeping its files and
  /// writing the draft).
  private func prune() {
    guard let did, !did.isEmpty, composer?.isOpen != true, !Self.prunedMedia.contains(did) else { return }
    Self.prunedMedia.insert(did)
    let app = self.app
    Task {
      do {
        let agent = try await app.session.agentFor(did)
        _ = try await Drafts.pruneOrphanedDraftMedia(agent, did, media: PostingPages.draftMedia(app, did), store: app.stores.keyValue)
      } catch {
        Self.prunedMedia.remove(did)
      }
    }
  }

  private func deps(_ did: String) async throws -> DraftActionDeps<PublishTarget?> {
    let target = try await PostingPages.target(app, did)
    let req = caps.canSchedule ? app.session.backendFor(did) : nil
    return DraftActionDeps<PublishTarget?>.live(
      did: did, target: target, requester: req, timers: req, media: PostingPages.media(app),
      draftMedia: PostingPages.draftMedia(app, did), makePreviewUrl: ComposerController.previewOfFile,
      resolveMention: Mentions.resolveMention, now: { Date().timeIntervalSince1970 * 1000 })
  }

  private func handle() -> String {
    let account = app.session.accounts.first { Optional($0.did).jsEquals(did) }
    return Accounts.accountHandle(account) ?? Accounts.accountName(account)
  }

  private func postNow(_ row: JSONValue) {
    guard busy == nil, let did, let view = list.views.first(where: { PostingPages.sameValue($0["id"], row["id"]) }) else { return }
    busy = row["id"]?.jsString
    notice = nil
    let settings = PostingPages.settings(app, did).json
    Task {
      defer { busy = nil }
      do {
        let agent = try await app.session.agentFor(did)
        let out = try await DraftActions.postDraftNow(view, did: did, settings: settings, agent: agent, deps: try await deps(did))
        toasts?.push("Posted as \(handle()).")
        if !out.notes.isEmpty { notice = DraftsNotice(danger: false, text: out.notes.joined(separator: " ")) }
      } catch {
        let code = ScheduledPostError.errorObject(error)["code"]?.stringValue
        notice = DraftsNotice(
          danger: true, text: DraftActions.draftActionMessage(error, action: "post"),
          scope: Scopes.isMissingScopeError(error) || code == "MISSING_SCOPE")
      }
    }
  }

  private func schedule(_ row: JSONValue, scheduledFor: String, queued: Bool) async throws {
    guard let did, let view = list.views.first(where: { PostingPages.sameValue($0["id"], row["id"]) }) else { return }
    busy = row["id"]?.jsString
    notice = nil
    defer { busy = nil }
    let settings = PostingPages.settings(app, did).json
    do {
      let agent = try await app.session.agentFor(did)
      let now = SyncStatus.now()
      let out = try await DraftActions.scheduleDraft(
        view, did: did, settings: settings, agent: agent, scheduledFor: .string(scheduledFor), queued: queued, now: now,
        deps: try await deps(did))
      let given = out.row["scheduledFor"]
      let at: JSONValue = given?.isTruthy == true ? given ?? .null : .string(scheduledFor)
      toasts?.push(
        queued
          ? "Added to your queue for \(HubModel.whenLabel(at, now: now))."
          : "Scheduled for \(HubModel.whenLabel(.string(scheduledFor), now: now)).")
      if !out.notes.isEmpty { notice = DraftsNotice(danger: false, text: out.notes.joined(separator: " ")) }
      scheduling = nil
    } catch {
      let object = ScheduledPostError.errorObject(error)
      let code = object["code"]?.stringValue ?? ""
      if code == "MEDIA_MISSING" || code == "NEEDS_BACKEND" {
        throw PostingPagesError(object["message"]?.stringValue ?? "")
      }
      let said = ScheduledPostError.scheduleErrorMessage(error)
      throw PostingPagesError(said.isEmpty ? DraftActions.draftActionMessage(error, action: "schedule") : said)
    }
  }

  private func remove(_ row: JSONValue) async throws {
    guard let did else { return }
    // The account first, as the web's does: a failure there is said as it is.
    let agent = try await app.session.agentFor(did)
    do {
      try await Drafts.deleteDraft(agent, row["id"]?.stringValue, media: PostingPages.draftMedia(app, did))
    } catch {
      if Scopes.isMissingScopeError(error) {
        throw PostingPagesError("Virga needs permission to delete drafts. Sign in again to grant it.")
      }
      let message = PostingPages.message(error)
      throw PostingPagesError("The draft couldn’t be deleted. \(message.isEmpty ? "Try again." : message)")
    }
    toasts?.push("Draft deleted.")
  }
}

/// A sentence a posting page throws to its dialog, which shows it.
struct PostingPagesError: Error, LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

/// The kit's ⋯ for a row (MoreMenu's menu and glyph), with a spinner in
/// place of the dots while the row works. It stays the one labelled menu
/// throughout, as the web's Menu does, so VoiceOver keeps it and its focus.
struct DraftsRowMenu: View {
  @Environment(\.virgaTheme) private var theme
  let label: String
  let entries: [MenuEntry]
  let working: Bool

  var body: some View {
    let side = theme.points(ThemeKit.touchGhostIconButtonSize)
    Menu {
      MenuContent(entries: entries)
    } label: {
      glyph(side: side)
        .frame(width: side, height: side)
        .contentShape(Circle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
    .menuOrder(.fixed)
    .virgaFocusOutline(Circle())
    .accessibilityLabel(label)
    .accessibilityIdentifier("row-menu")
  }

  @ViewBuilder
  private func glyph(side: CGFloat) -> some View {
    if working {
      HubSpinner()
    } else {
      // MoreMenu's dots: grown with Dynamic Type, kept inside the circle.
      Image(systemName: Glyph.more)
        .virgaGlyph(theme.points(ThemeKit.menuItemIconSize), weight: .medium, upTo: side / 2)
        .foregroundStyle(theme.color(ThemeKit.ghostButtonInk))
    }
  }
}

/// A row led by its words (`.has-corner-menu`): the words, then its one
/// small button and its ⋯ at the end; on a phone the ⋯ goes to the row's
/// top corner and the button under the words, so the words keep the width.
struct HubCornerRow<Words: View, Action: View>: View {
  @Environment(\.virgaTheme) private var theme
  let words: Words
  let button: Action?
  let menu: AnyView?

  var body: some View {
    Group {
      if theme.isPhone {
        HStack(alignment: .top, spacing: Measure.Hub.rowColumnGap) {
          VStack(alignment: .leading, spacing: Measure.Hub.rowRowGap) {
            words
            if let button { button }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          if let menu {
            // Centred on the words' first line, its dots on the column's edge.
            menu
              .padding(.trailing, -Measure.Settings.dashMenuOutset)
              .padding(.top, Measure.Hub.cornerMenuCentre - theme.points(ThemeKit.touchGhostIconButtonSize) / 2)
          }
        }
      } else {
        HStack(alignment: .top, spacing: Measure.Hub.rowColumnGap) {
          words.frame(maxWidth: .infinity, alignment: .leading)
          // `.row-actions { margin-top: -6px }`, and the 44-point ⋯ reaching
          // 6 past it above and below (`.row-actions .btn--ghost.btn--icon {
          // margin-block: -6px }`), so the group is the 32 of a small button,
          // centred on the words' first line.
          HStack(spacing: theme.points(ThemeKit.rowActionsGap)) {
            if let button { button }
            if let menu { menu.padding(.vertical, -Measure.Section.rowActionsLift) }
          }
          .padding(.top, -Measure.Section.rowActionsLift)
        }
      }
    }
    .padding(.vertical, theme.rowPad)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: Measure.Section.hairline) }
  }
}

// MARK: - Schedule this draft

/// `ScheduleDraftDialog`: a set time of one's own, or the queue's next open
/// time on its button. The account's scheduled posts and limits are read
/// as it opens.
struct ScheduleDraftDialog: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  let row: JSONValue
  let did: String?
  /// The account's weekly schedule (`settings.queue`): the picker's clock
  /// and the queue's next open time.
  let queueSettings: JSONValue
  let onClose: () -> Void
  let onSchedule: (_ scheduledFor: String, _ queued: Bool) async throws -> Void

  enum Phase {
    case idle, loading, ready, failed
  }

  /// An ISO string, or nil while the picker's date or time is incomplete.
  @State private var when: String?
  @State private var phase = Phase.idle
  @State private var slot: Double?
  @State private var usage = ""
  @State private var room = ""
  @State private var busy = false
  @State private var error = ""
  @State private var now = SyncStatus.now()

  var body: some View {
    let whenMs = TimeValue.ms(when.map(JSONValue.string))
    let tooSoon = !whenMs.isFinite || whenMs < now + 60_000
    let words = (row["text"]?.stringValue ?? "").jsTrimmed()
    // `.dialog--stack-actions`: on a phone the three buttons go one under
    // another, Schedule first and Cancel last.
    DialogFrame(title: "Schedule this draft", onClose: { if !busy { onClose() } }, stackActions: true) {
      // `.hub-confirm { gap: 12px }`
      VStack(alignment: .leading, spacing: Measure.Hub.confirmGap) {
        if !words.isEmpty { HubQuote(text: words.jsSlice(0, Measure.Hub.scheduleQuoteMax)) }
        WhenPicker(schedule: queueSettings, value: when, onChange: { when = $0 }, requester: req)
        if tooSoon && !(when ?? "").isEmpty {
          // `.field-hint.lib-question-error`: the hint's weight, in red.
          Text("Choose a time at least a minute from now.")
            .virgaText(.textSm)
            .foregroundStyle(theme.danger)
        }
        if phase == .loading { FieldHint("Looking for the next open time in your queue…") }
        if phase == .ready && slot == nil {
          FieldHint("Your weekly schedule has no open times. Set some in Posting › Weekly schedule to use the queue.")
        }
        if !usage.isEmpty { FieldHint("\(usage).") }
        if !room.isEmpty {
          // `role="status"`: read out as it arrives.
          Callout(tone: .warn, room)
            .toolAnnounces(room, onAppear: true)
        }
        if phase == .failed { Callout(tone: .warn, "Your queue couldn’t be read, so only a set time can be chosen.") }
        FieldHint("Once it’s scheduled, the draft is deleted: the scheduled post takes its place.")
        if !error.isEmpty { Callout(tone: .danger, error) }
      }
    } actions: {
      actions(tooSoon: tooSoon)
    }
    .interactiveDismissDisabled(busy)
    .task { await read() }
    // The web reads the clock on every render: whether the time is too soon
    // is judged against now, not when the dialog opened.
    .onChange(of: when) { _, _ in now = SyncStatus.now() }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("schedule-draft-dialog")
  }

  /// `req`: Virga's server for the account, when it can schedule.
  private var req: VirgaBackend? {
    app.session.capabilitiesFor(did).canSchedule ? app.session.backendFor(did) : nil
  }

  /// Cancel, Add to queue, Schedule: side by side wider than a phone, and on
  /// a phone the dialog's stacked foot puts the last (Schedule) first.
  @ViewBuilder
  private func actions(tooSoon: Bool) -> some View {
    let cancel = Button("Cancel", action: onClose).buttonStyle(.virga).disabled(busy)
    // The web's `title` on the button while the schedule has no open time.
    let queueHelp: String = slot == nil ? "Your weekly schedule has no open time" : ""
    let queue = Button(slot.map { "Add to queue · \(HubModel.whenLabel(JSDate.toISOString($0).map(JSONValue.string), now: now))" } ?? "Add to queue") {
      go(queued: true)
    }
    .buttonStyle(.virga)
    .disabled(busy || slot == nil || !room.isEmpty)
    .help(queueHelp)
    .accessibilityIdentifier("schedule-draft-queue")
    let confirm = Button(busy ? "Scheduling…" : "Schedule") { go(queued: false) }
      .buttonStyle(.virga(.primary))
      .disabled(busy || tooSoon || !room.isEmpty)
      .accessibilityIdentifier("schedule-draft-confirm")
    cancel
    queue
    confirm
  }

  private func read() async {
    now = SyncStatus.now()
    guard let req else { return }
    error = ""
    when = JSDate.toISOString(now + 60 * 60 * 1000)
    phase = .loading
    do {
      let list = try await ScheduleService.listScheduled(req)
      let limits = try? await ScheduleService.getLimits(req)
      let queued = list.rows.filter { r in
        r["queued"]?.isTruthy == true && (r["status"] == "pending" || r["status"] == "publishing")
      }
      slot = try PostingQueue.nextOpenSlot(queueSettings, queued, now: SyncStatus.now())
      usage = ScheduleService.scheduledUsageLine(limits)
      room = ScheduleService.scheduledRoomProblem(limits)
      phase = .ready
    } catch {
      phase = .failed
    }
  }

  private func go(queued: Bool) {
    let at = queued ? slot.flatMap { JSDate.toISOString($0) } : when
    guard let at else { return }
    busy = true
    error = ""
    Task {
      defer { busy = false }
      do {
        try await onSchedule(at, queued)
      } catch {
        let said = (error as? LocalizedError)?.errorDescription ?? ""
        self.error = said.isEmpty ? "The draft couldn’t be scheduled. Try again." : said
      }
    }
  }
}
#endif
