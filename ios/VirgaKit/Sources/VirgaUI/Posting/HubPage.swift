// Ports src/posting/pages/HubPage.jsx
// Ports src/posting/pages/hub.css (.posting-nav, .hub-columns, .hub-column, .hub-card, .hub-row--when, .hub-when, .hub-inline-action, .hub-row--open, .hub-row-link)
//
// The posting overview: what goes out next (and what didn't go out), the
// drafts waiting and what went out last, each leading to its page. Where
// there is no sidebar, the posting pages are a row of words under the
// header, each with how many it holds once that has been read. An account
// without a long session sees what it can use, and NeedsBackend where
// scheduling would be.
//
// Each list is a read of its own (PostingLoad, the web's useLoad), read
// again when the posting events say it changed: the drafts (Bluesky's, the
// latest edit first), the scheduled posts (Virga's server, with a long
// session), the timers (only for the row of pages, without the sidebar),
// and the author feed's latest posts laid over the archive's.
//
// iOS: Retry and "see what happened" sit in their sentence as words with a
// line under them, each pressed through a finger's reach.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights
import VirgaPosting
import VirgaSession

/// What the overview reads of the drafts: the rows, and whether there are more.
struct HubDraftsRead {
  var rows: [JSONValue]
  var more: Bool
}

/// What it reads of the scheduled posts.
struct HubScheduledRead {
  var overview: ScheduledOverview
  var failedRows: [JSONValue]
  var unavailable: Bool
}

struct HubPage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(\.openURL) private var openURL
  @Environment(ComposerHost.self) private var composer: ComposerHost?
  @Environment(AppModel.self) private var app
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  let did: String?
  @State private var templates: TemplatesModel
  @State private var drafts = PostingLoad<HubDraftsRead>()
  @State private var scheduled = PostingLoad<HubScheduledRead>()
  @State private var timers = PostingLoad<TimersOverview>()
  @State private var fresh = PostingLoad<[JSONValue]>()
  @State private var retrying: String?

  init(session: SessionModel, did: String?) {
    self.did = did
    _templates = State(initialValue: TemplatesModel(session: session, did: did))
  }

  private var caps: AccountCapabilities { app.session.capabilitiesFor(did) }
  private var hasServer: Bool { caps.canSchedule && app.session.backendFor(did) != nil }

  var body: some View {
    let narrow = !theme.hasSidebar
    let header = PostingHeader.header("hub", extra: narrow ? AnyView(HubPostingNav(counts: counts)) : nil)
    VirgaPage(header: header) {
      PostingPermissionNotice(did: did ?? "")
      columns
    }
    .task(id: "\(did ?? "")|\(hasServer)|\(narrow)") { start(narrow: narrow) }
    .task { templates.start() }
    .onDisappear {
      templates.stop()
      drafts.stop()
      scheduled.stop()
      timers.stop()
      fresh.stop()
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("posting-hub")
  }

  // MARK: Reads

  private func start(narrow: Bool) {
    let session = app.session
    let did = self.did
    let req: VirgaBackend? = session.capabilitiesFor(did).canSchedule ? session.backendFor(did) : nil
    let device = PostingPages.deviceId(app)
    let transport = app.archiveEnvironment.transport
    let key = did ?? ""
    drafts.follow(key: key, did: did, events: [PostingEvents.draftsChangedEvent]) {
      let agent = try await session.agentFor(did)
      let page = try await Drafts.listDrafts(agent, limit: .number(Double(Measure.Hub.hubDraftsRead)))
      return HubDraftsRead(rows: HubModel.draftRows(.array(page.drafts), deviceId: device), more: page.cursor.isTruthy)
    }
    scheduled.follow(key: "\(key):\(req != nil)", did: did, events: [PostingEvents.scheduledChangedEvent], enabled: req != nil) {
      let list = try await ScheduleService.listScheduled(req)
      return HubScheduledRead(
        overview: HubModel.scheduledOverview(.array(list.rows)),
        failedRows: list.rows.filter { $0["status"] == "failed" }, unavailable: list.unavailable)
    }
    // Only the row of pages shows how many timers count down, and it is
    // only there without the sidebar.
    timers.follow(
      key: "\(key):\(req != nil)", did: did, events: [PostingEvents.timersChangedEvent], enabled: req != nil && narrow
    ) {
      let list = try await TimerService.listTimers(req)
      return HubModel.timersOverview(.array(list.rows))
    }
    fresh.follow(key: key, did: did, events: [PostingEvents.postsChangedEvent]) {
      guard let did else { return [] }
      return try await PostingPages.authorFeed(did, limit: Measure.Hub.hubFeedPage, transport: transport).rows
    }
  }

  /// What each page holds, after its name in the row of pages: only what
  /// has been read and isn't nothing; Scheduled and Timers only with a long
  /// session.
  private var counts: [String: String] {
    var out: [String: String] = [:]
    if let read = drafts.data, !read.rows.isEmpty {
      out["drafts"] = "\(AppLocale.formatNumber(read.rows.count))\(read.more ? "+" : "")"
    }
    if hasServer, let read = scheduled.data, read.overview.waiting > 0 {
      out["scheduled"] = AppLocale.formatNumber(read.overview.waiting)
    }
    if hasServer, let read = timers.data, read.live > 0 { out["timers"] = AppLocale.formatNumber(read.live) }
    if !templates.templates.isEmpty { out["templates"] = AppLocale.formatNumber(templates.templates.count) }
    return out
  }

  // MARK: Layout

  @ViewBuilder
  private var columns: some View {
    if theme.windowWidth > Measure.Hub.oneColumnMax {
      HStack(alignment: .top, spacing: theme.gridGapX) {
        VStack(alignment: .leading, spacing: theme.gridGap) {
          nextSection
          draftsSection
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        postedSection
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    } else {
      VStack(alignment: .leading, spacing: theme.gridGap) {
        nextSection
        draftsSection
        postedSection
      }
    }
  }

  /// `SectionCard`: a list of the overview, its name over a rule in ink and
  /// the way to the whole of it.
  private func card<Content: View>(
    _ title: String, to: String?, link: String, id: String, @ViewBuilder content: () -> Content
  ) -> some View {
    VirgaSection(title: title, trailing: to.map { AnyView(MoreLink(link, to: $0)) }, flush: true) {
      content()
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier(id)
  }

  private func path(_ key: String) -> String { PostingRoutes.postingPageByKey[key]?.path ?? PostingRoutes.postingBase }

  // MARK: Going out next

  private var nextSection: some View {
    card("Going out next", to: hasServer ? path("scheduled") : nil, link: "All scheduled", id: "hub-next") {
      nextContent
    }
  }

  @ViewBuilder
  private var nextContent: some View {
    if !hasServer {
      NeedsBackendNotice(did: did)
        .padding(.top, Measure.Hub.noticeAbove)
    } else if scheduled.phase == .loading || scheduled.phase == .idle {
      RowSkeleton(rows: 3)
    } else if let read = scheduled.data {
      if read.unavailable {
        EmptyState("Scheduling isn’t available on Virga’s server just now.")
          .padding(.top, theme.space4)
      } else if read.overview.next.isEmpty && read.failedRows.isEmpty {
        EmptyState("Nothing is scheduled. Write a post and choose Schedule, or add it to your queue.")
          .padding(.top, theme.space4)
      } else {
        let now = SyncStatus.now()
        VStack(alignment: .leading, spacing: 0) {
          ForEach(read.overview.next, id: \.self) { row in
            HubNextRow(row: row, now: now)
          }
          ForEach(read.failedRows, id: \.self) { row in
            HubFailedRow(row: row, now: now, retrying: retrying, onRetry: { retry(row) }, onSee: { navigate(path("scheduled")) })
          }
        }
      }
    } else {
      LoadError(message: "Your scheduled posts couldn’t be read from Virga’s server.") { scheduled.reload() }
        .padding(.top, Measure.Hub.errorAbove)
    }
  }

  private func retry(_ row: JSONValue) {
    guard retrying == nil, let id = row["id"] else { return }
    let req = app.session.backendFor(did)
    retrying = id.jsString
    Task {
      defer { retrying = nil }
      do {
        _ = try await ScheduleService.retryScheduled(req, id)
        toasts?.push(row["partial"]?.isTruthy == true ? "The rest of the thread goes out in a moment." : "It goes out again in a moment.")
      } catch {
        toasts?.push(ScheduledPostError.scheduleErrorMessage(error))
      }
    }
  }

  // MARK: Latest drafts

  private var draftsSection: some View {
    card("Latest drafts", to: path("drafts"), link: "All drafts", id: "hub-drafts") {
      draftsContent
    }
  }

  @ViewBuilder
  private var draftsContent: some View {
    if drafts.phase == .loading || drafts.phase == .idle {
      RowSkeleton(rows: 3)
    } else if let read = drafts.data {
      if read.rows.isEmpty {
        EmptyState("No drafts. In the composer, Save draft keeps a post here until you’re ready.")
          .padding(.top, theme.space4)
      } else {
        let now = SyncStatus.now()
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(read.rows.prefix(Measure.Hub.hubDrafts)), id: \.self) { row in
            HubDraftRow(row: row, now: now) { openDraft(row) }
          }
        }
      }
    } else if Scopes.isMissingScopeError(drafts.error) {
      // The notice at the top of the page already asks for the permission
      // when posting lacks it too; it isn't said twice.
      if caps.canPost {
        PostingPermissionNotice(did: did ?? "", force: true)
          .padding(.top, Measure.Hub.errorAbove)
      } else {
        EmptyState("Your drafts can’t be read until Virga has permission.")
          .padding(.top, theme.space4)
      }
    } else {
      LoadError(message: "Your drafts couldn’t be read from Bluesky.") { drafts.reload() }
        .padding(.top, Measure.Hub.errorAbove)
    }
  }

  private func openDraft(_ row: JSONValue) {
    let intent: JSONValue = [
      "draftId": row["id"] ?? .null, "draftOwnerDid": did.map(JSONValue.string) ?? .null, "asDid": did.map(JSONValue.string) ?? .null,
    ]
    if let composer { composer.open(intent) } else { navigate("/posting/compose") }
  }

  // MARK: Recently posted

  private var postedSection: some View {
    card("Recently posted", to: path("posted"), link: "All posts", id: "hub-posted") {
      postedContent
    }
  }

  @ViewBuilder
  private var postedContent: some View {
    let built = archive.map { $0.isBuilt && !$0.data.posts.isEmpty } ?? false
    let recent = Array(
      HubModel.mergePostRows(PostingPages.archivePosts(archive, did), fresh.data ?? []).prefix(Measure.Hub.hubPosts))
    if fresh.phase == .loading && !built {
      RowSkeleton(rows: 5)
    } else if !recent.isEmpty {
      let now = SyncStatus.now()
      VStack(alignment: .leading, spacing: 0) {
        ForEach(recent, id: \.self) { row in
          HubPostedRow(row: row, did: did, now: now)
        }
      }
    } else if fresh.phase == .failed {
      LoadError(message: "Your latest posts couldn’t be read from Bluesky.") { fresh.reload() }
        .padding(.top, Measure.Hub.errorAbove)
    } else {
      EmptyState("Nothing posted yet. New post starts one.")
        .padding(.top, theme.space4)
    }
  }
}

// MARK: - The row of pages

/// `PostingNav`: the posting pages as a row of words, for a screen without
/// the sidebar that lists them: the overview pressed, and after a page's
/// name how many it holds. It scrolls sideways when it doesn't fit.
struct HubPostingNav: View {
  @Environment(\.virgaTheme) private var theme
  let counts: [String: String]

  var body: some View {
    ViewThatFits(in: .horizontal) {
      keys.fixedSize()
      ScrollRow(focus: AnyHashable("hub")) { keys }
    }
    .padding(.horizontal, -Measure.Touch.segmentedReach)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Posting pages")
    .accessibilityIdentifier("posting-nav")
  }

  private var keys: some View {
    HStack(spacing: theme.points(ThemeKit.touchSegmentedGap)) {
      ForEach(PostingRoutes.postingPages) { page in
        HubPostingNavKey(page: page, count: counts[page.key], isOn: page.key == "hub")
          .id(AnyHashable(page.key))
      }
    }
    .padding(.horizontal, Measure.Touch.segmentedReach)
  }
}

/// One page in the row: the kit's Segmented key, as a link, with its count
/// after its name, quieter, not taking the pressed key's weight.
struct HubPostingNavKey: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  let page: PostingPage
  let count: String?
  let isOn: Bool

  var body: some View {
    let size = theme.points(ThemeKit.segmentedKeyFontSize)
    let underline = theme.isHighContrast ? ThemeKit.highContrastSegmentedOnUnderline : ThemeKit.segmentedOnUnderline
    let lineWidth = abs(theme.points(underline.first?.y ?? .px(-2)))
    Button {
      if !isOn { navigate(page.path) }
    } label: {
      HStack(spacing: theme.points(ThemeKit.linkActionGap)) {
        ZStack {
          Text(page.label).virgaText(size: size, weight: ThemeKit.segmentedOnWeight).hidden()
          Text(page.label).virgaText(size: size, weight: isOn ? ThemeKit.segmentedOnWeight : ThemeKit.segmentedKeyWeight)
        }
        .foregroundStyle(theme.color(isOn ? ThemeKit.segmentedOnInk : ThemeKit.segmentedKeyInk))
        if let count {
          Text(count)
            .virgaText(size: size, weight: VirgaWeight.regular)
            .monospacedDigit()
            .foregroundStyle(theme.muted)
        }
      }
      .lineLimit(1)
      .frame(minHeight: theme.points(ThemeKit.touchSegmentedKeyHeight))
      .overlay(alignment: .bottom) {
        if isOn {
          Rectangle()
            .fill(theme.color(underline.first?.color ?? .color(.transparent)))
            .frame(height: lineWidth)
        }
      }
      .touchReach(horizontal: Measure.Touch.segmentedReach, vertical: 0)
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm), placement: .inside)
    .accessibilityLabel(count.map { "\(page.label), \($0)" } ?? page.label)
    .accessibilityAddTraits(isOn ? [.isSelected, .isLink] : .isLink)
    .accessibilityIdentifier("posting-nav-\(page.key)")
  }
}

// MARK: - Rows

/// "Tomorrow, 10:00 AM" as its day and its hour, for a row that leads with them.
enum HubWhen {
  static func parts(_ label: String) -> (day: String, hour: String) {
    let units = Array(label.utf16)
    var at: Int?
    if units.count >= 2 {
      for i in stride(from: units.count - 2, through: 0, by: -1) where units[i] == 0x2C && units[i + 1] == 0x20 {
        at = i
        break
      }
    }
    guard let at else { return (label, "") }
    return (label.jsSlice(0, at), label.jsSlice(at + 2))
  }

  /// `failedLead(row)`: why a scheduled post didn't go out, as the start of
  /// a sentence that ends "retry or see what happened". The session ending
  /// is said in the fewest words; anything else in the Scheduled page's own.
  static func failedLead(_ row: JSONValue, now: Double) -> (text: String, retry: String) {
    let code = (row["lastErrorCode"].flatMap { $0.isTruthy ? $0.jsString : nil } ?? "").uppercased()
    let lastError = row["lastError"].flatMap { $0.isTruthy ? $0.jsString : nil } ?? ""
    let session = !code.isEmpty ? code == "SESSION_UNAVAILABLE" : lastError.range(of: "session", options: .caseInsensitive) != nil
    if session { return ("Its session had ended. Sign in again, then", "retry") }
    return (ScheduleModel.rowStatus(row, now: now).detail, "Retry")
  }
}

/// A post going out at a time: its day over its hour (on a phone, its first
/// line of meta), then its words.
struct HubNextRow: View {
  @Environment(\.virgaTheme) private var theme
  let row: JSONValue
  let now: Double

  var body: some View {
    let when = HubWhen.parts(HubModel.whenLabel(row["scheduledFor"], now: now))
    var time: [String] = []
    if !when.hour.isEmpty { time.append(when.hour) }
    if row["queued"]?.isTruthy == true { time.append("Queue") }
    if row["status"] == "publishing" { time.append("Going out now") }
    let words = HubRowText(text: HubModel.scheduledSnippet(row), placeholder: "")
    return HubTimedRow(day: when.day, time: time, dayTone: .plain) { words }
      .accessibilityElement(children: .combine)
  }
}

/// One that didn't go out: says so where its day would be, in red, with
/// when it was due under it, and what to do about it in a sentence.
struct HubFailedRow: View {
  @Environment(\.virgaTheme) private var theme
  let row: JSONValue
  let now: Double
  let retrying: String?
  let onRetry: () -> Void
  let onSee: () -> Void

  var body: some View {
    let when = HubWhen.parts(HubModel.whenLabel(row["scheduledFor"], now: now, weekday: false))
    let lead = HubWhen.failedLead(row, now: now)
    let busy = retrying != nil && retrying == row["id"]?.jsString
    HubTimedRow(
      day: ScheduleModel.rowStatus(row, now: now).label, time: [when.hour.isEmpty ? when.day : "\(when.day), \(when.hour)"],
      dayTone: .failed, joinTime: true
    ) {
      VStack(alignment: .leading, spacing: Measure.Hub.rowLineGap) {
        HubRowText(text: HubModel.scheduledSnippet(row), placeholder: "")
        // One run of words, so the two actions wrap with them.
        FlowLayout(spacing: theme.space1, lineSpacing: 0, alignment: .firstTextBaseline) {
          ForEach(Array(lead.text.split(separator: " ").enumerated()), id: \.offset) { _, word in
            Text(String(word))
          }
          HubInlineAction(title: lead.retry, disabled: retrying != nil, action: onRetry)
            .accessibilityIdentifier("hub-retry")
          Text("or")
          HStack(spacing: 0) {
            HubInlineAction(title: "see what happened", disabled: false, action: onSee)
            Text(".")
          }
        }
        .virgaText(.textSm, lineHeight: Measure.Hub.whyLineHeight)
        .foregroundStyle(theme.muted)
      }
    }
    .opacity(busy ? Measure.Hub.busyOpacity : 1)
    .accessibilityElement(children: .contain)
  }
}

/// `.hub-inline-action`: words in ink with a line under them, inside a
/// sentence; a finger's reach round them.
struct HubInlineAction: View {
  @Environment(\.virgaTheme) private var theme
  let title: String
  let disabled: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Text(title)
        .virgaText(.textSm, weight: VirgaWeight.medium, lineHeight: Measure.Hub.whyLineHeight)
        .foregroundStyle(theme.ink)
        .underline()
    }
    .buttonStyle(.plain)
    .disabled(disabled)
    .opacity(disabled ? ThemeKit.disabledOpacity : 1)
    .touchReach(horizontal: Measure.Hub.inlineReachHorizontal, vertical: Measure.Hub.inlineReachVertical)
  }
}

/// `.hub-row--when`: a row led by its time, the day over the hour in the
/// `--time-col` column; on a phone, the time as the row's first line of meta
/// (the day a step louder), then the words.
struct HubTimedRow<Words: View>: View {
  enum DayTone {
    case plain, failed
  }

  @Environment(\.virgaTheme) private var theme
  let day: String
  let time: [String]
  let dayTone: DayTone
  /// A failed row's date and hour are one piece.
  var joinTime = false
  @ViewBuilder let words: () -> Words

  var body: some View {
    Group {
      if theme.isPhone {
        VStack(alignment: .leading, spacing: Measure.Hub.rowLineGap) {
          phoneWhen
          words()
        }
      } else {
        HStack(alignment: .top, spacing: Measure.Hub.rowColumnGap) {
          deskWhen
            .frame(width: theme.timeCol, alignment: .leading)
          words()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }
    .padding(.vertical, theme.rowPad)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }

  private var dayInk: Color { dayTone == .failed ? theme.danger : theme.ink }

  private var deskWhen: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(day)
        .virgaText(.textMd, weight: dayTone == .failed ? VirgaWeight.semibold : VirgaWeight.medium, lineHeight: Measure.Hub.whenLineHeight)
        .foregroundStyle(dayInk)
      if !time.isEmpty {
        FlowLayout(spacing: 0, lineSpacing: 0, alignment: .center) {
          ForEach(Array(time.enumerated()), id: \.offset) { index, part in
            if joinTime {
              Text(part).virgaText(.textSm, lineHeight: Measure.Hub.whenLineHeight).foregroundStyle(theme.muted)
            } else {
              MetaPiece(isLast: index == time.count - 1) { Text(part).lineLimit(1) }
            }
          }
        }
      }
    }
  }

  private var phoneWhen: some View {
    FlowLayout(spacing: 0, lineSpacing: 0, alignment: .center) {
      HStack(spacing: 0) {
        Text(day)
          .virgaText(.textSm, weight: dayTone == .failed ? VirgaWeight.semibold : VirgaWeight.medium, lineHeight: Measure.Hub.whyLineHeight)
          .foregroundStyle(dayTone == .failed ? theme.danger : theme.ink2)
        if !time.isEmpty {
          Text("·")
            .virgaText(.textSm, lineHeight: Measure.Hub.whyLineHeight)
            .foregroundStyle(theme.muted)
            .padding(.horizontal, Measure.Hub.whenDotMargin)
            .accessibilityHidden(true)
        }
      }
      ForEach(Array(time.enumerated()), id: \.offset) { index, part in
        MetaPiece(isLast: index == time.count - 1) { Text(part).lineLimit(1) }
      }
    }
  }
}

/// A draft on the overview: its words, its first three facts, and Open
/// beside them on their first line.
struct HubDraftRow: View {
  @Environment(\.virgaTheme) private var theme
  let row: JSONValue
  let now: Double
  let onOpen: () -> Void

  var body: some View {
    let text = row["text"]?.stringValue ?? ""
    let name = text.jsTrimmed().jsSlice(0, Measure.Hub.draftName)
    HStack(alignment: .firstTextBaseline, spacing: Measure.Hub.rowColumnGap) {
      VStack(alignment: .leading, spacing: Measure.Hub.rowLineGap) {
        HubRowText(text: text, placeholder: "No text yet")
        MetaLine(Array(DraftActions.draftMeta(row, now: now).prefix(3)))
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      Button("Open", action: onOpen)
        .buttonStyle(.linkAction)
        .accessibilityLabel("Open the draft “\(name.isEmpty ? "with no text" : name)”")
        .accessibilityIdentifier("hub-draft-open")
    }
    .padding(.vertical, theme.rowPad)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .contain)
  }
}

/// A post that went out: its words, the way to it on Bluesky, and its line.
/// A post in a thread of the account's own isn't called a reply.
struct HubPostedRow: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  let row: JSONValue
  let did: String?
  let now: Double
  var extra: String? = nil

  var body: some View {
    var meta = row
    if !PostedModel.isReplyRow(row, did) { meta["replyTo"] = .null }
    let post = PostRow(json: meta) ?? PostRow(uri: row["uri"]?.stringValue ?? "")
    let placeholder = row["hasMedia"]?.isTruthy == true ? "A post with media" : "No text"
    return VStack(alignment: .leading, spacing: Measure.Hub.rowLineGap) {
      Button {
        if let link = PostLink.bskyUrlFor(row["uri"]?.stringValue), let url = URL(string: link) { openURL(url) }
      } label: {
        HubRowText(text: row["text"]?.stringValue ?? "", placeholder: placeholder)
      }
      .buttonStyle(.plain)
      .accessibilityAddTraits(.isLink)
      .accessibilityHint("Open on Bluesky")
      HubPostMeta(post: post, now: now, extra: extra)
    }
    .padding(.vertical, theme.rowPad)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}
#endif
