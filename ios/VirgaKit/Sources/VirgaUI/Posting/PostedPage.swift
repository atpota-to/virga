// Ports src/posting/pages/PostedPage.jsx
// Ports src/posting/pages/hub.css (.posted-row, the list's toolbar over its heading)
//
// What the account has posted, from its archive plus a fresh read of its
// latest posts that the archive hasn't synced yet. Each post can be replied
// to, quoted, posted again, saved as a template, given new reply and quote
// settings, put on a timer (with a long session) or deleted, all from its
// ⋯, and every action reads the post as it is now first (PostedModel's
// readPostNow). Published posts aren't edited in place: Post again opens
// one in the composer, with its words, links, tags, languages, quote or
// link card and pictures, to change and post, schedule or queue.
//
// Before the archive is built only the latest posts are listed, a page of
// the author feed at a time; once it is, the whole archive, searched by the
// words it keeps.
//
// iOS: the focus after a post goes is the system's to place.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaNetwork
import VirgaPosting
import VirgaSession

/// The author feed's first page: its rows and its cursor.
struct PostedFeedRead {
  var rows: [JSONValue]
  var cursor: String?
}

/// Who can reply and quote, as the gates dialog holds them while it's open.
struct PostedGatesState: Identifiable {
  var post: PostNow
  var value: PostGates
  var quotesOnly: Bool
  var id: String { post.uri }
}

/// What "Save as a template" opens the editor with.
struct PostedTemplateSeed: Identifiable {
  var seed: TemplateSeed
  let id = UUID()
}

struct PostedPage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(\.openURL) private var openURL
  @Environment(ComposerHost.self) private var composer: ComposerHost?
  @Environment(AppModel.self) private var app
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  let did: String?
  @State private var query = ""
  @State private var filter = "all"
  @State private var shown = Measure.Hub.postedStep
  @State private var removed: [JSONValue] = []
  @State private var working: String?
  @State private var error: String?
  @State private var gates: PostedGatesState?
  @State private var timer: PostTimerTarget?
  @State private var seed: PostedTemplateSeed?
  @State private var deleting: JSONValue?
  @State private var fresh = PostingLoad<PostedFeedRead>()
  @State private var moreRows: [JSONValue] = []
  /// The next page's cursor once one has been read ('' at the end), else nil.
  @State private var moreCursor: String?
  @State private var loadingMore = false

  private var caps: AccountCapabilities { app.session.capabilitiesFor(did) }
  private var own: Bool { archive.map { $0.did.jsEquals(did ?? "") } ?? false }
  private var built: Bool { own && (archive?.isBuilt ?? false) }
  private var feedCursor: String? {
    let cursor = moreCursor ?? fresh.data?.cursor
    return cursor.flatMap { $0.isEmpty ? nil : $0 }
  }

  var body: some View {
    let all = HubModel.mergePostRows(
      own ? PostingPages.archivePosts(archive, did) : [], (fresh.data?.rows ?? []) + moreRows, removed: removed)
    let rows = PostedModel.filterPostRows(all, did: did, filter: filter, query: query)
    let visible = Array(rows.prefix(shown))
    let archiveLoaded = archive?.data.loaded ?? true
    let loading = !archiveLoaded || (fresh.phase == .loading && !built)
    // Nothing could be read at all: no list to search, count or head.
    let failed = !loading && fresh.phase == .failed && !built && all.isEmpty
    VirgaPage(PostingHeader.model("posted")) {
      PostingPermissionNotice(did: did ?? "")
      if archiveLoaded && !built { buildNotice }
      if let error {
        Callout(tone: .danger) { Text(error) }
          .accessibilityIdentifier("posted-error")
      }
      if failed {
        LoadError(message: "Your posts couldn’t be read from Bluesky.") { fresh.reload() }
      } else {
        VStack(alignment: .leading, spacing: theme.space4) {
          toolbar
          list(rows: rows, visible: visible, loading: loading)
        }
      }
    }
    .task(id: did ?? "") { start() }
    .onDisappear { fresh.stop() }
    .onChange(of: fresh.data?.rows ?? []) { _, _ in
      moreRows = []
      moreCursor = nil
    }
    .onChange(of: filter) { _, _ in shown = Measure.Hub.postedStep }
    .onChange(of: query) { _, _ in shown = Measure.Hub.postedStep }
    .sheet(item: $gates) { state in
      PostedGatesDialog(state: state, did: did ?? "", onClose: { gates = nil }) {
        toasts?.push("Saved. Bluesky shows the change at once.")
      }
      .presentationDetents([.large])
      .presentationBackground(theme.surface)
      .presentationCornerRadius(Measure.Dialog.radius)
    }
    .postTimerDialog($timer, did: did) { _ in
      toasts?.push("The timer is set. Posting › Timers shows it.")
    }
    .templateEditor(
      isPresented: Binding(get: { seed != nil }, set: { if !$0 { seed = nil } }), did: did, template: nil, seed: seed?.seed)
    .postingConfirm(
      isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), title: "Delete this post?",
      onConfirm: { if let row = deleting { try await confirmDelete(row) } }
    ) {
      VStack(alignment: .leading, spacing: Measure.Hub.confirmGap) {
        Text("It’s deleted from your repo and goes from Bluesky. Replies and quotes stay, showing it as deleted. This can’t be undone.")
          .fixedSize(horizontal: false, vertical: true)
        let words = (deleting?["text"]?.stringValue ?? "").jsTrimmed()
        if !words.isEmpty { HubQuote(text: words) }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("posted-page")
  }

  private func start() {
    let transport = app.archiveEnvironment.transport
    let did = self.did
    fresh.follow(key: did ?? "", did: did, events: [PostingEvents.postsChangedEvent]) {
      guard let did else { return PostedFeedRead(rows: [], cursor: nil) }
      let page = try await PostingPages.authorFeed(did, limit: Measure.Hub.postedFeedPage, transport: transport)
      return PostedFeedRead(rows: page.rows, cursor: page.cursor)
    }
  }

  // MARK: The parts

  /// Only the latest posts are listed until the archive is built.
  private var buildNotice: some View {
    var words = AttributedString("Only your latest posts are listed. ")
    var link = AttributedString("Build your archive")
    link.link = URL(string: "virga-route:build")
    words += link
    words += AttributedString(" to list and search everything you’ve posted.")
    return Callout {
      Text(words)
        .tint(theme.ink)
        .fixedSize(horizontal: false, vertical: true)
    }
    .environment(\.openURL, OpenURLAction { _ in
      navigate("/")
      return .handled
    })
    .accessibilityIdentifier("posted-build-notice")
  }

  /// What narrows the list sits over its heading, so the count is right
  /// over the rows it counts.
  @ViewBuilder
  private var toolbar: some View {
    let segmented = Segmented(
      label: "Show", options: PostedModel.postedFilters.map { SegmentedOption($0.value, $0.label) }, selection: $filter, size: .small)
    if theme.isPhone {
      VStack(alignment: .leading, spacing: theme.space3) {
        SearchField("Search your posts", text: $query).accessibilityIdentifier("posted-search")
        segmented
      }
    } else {
      HStack(alignment: .center, spacing: theme.space4) {
        SearchField("Search your posts", text: $query)
          .frame(maxWidth: Measure.Settings.selectMaxWidth)
          .accessibilityIdentifier("posted-search")
        segmented
        Spacer(minLength: 0)
      }
    }
  }

  private func list(rows: [JSONValue], visible: [JSONValue], loading: Bool) -> some View {
    VirgaSection(title: loading ? "Your posts" : PostingWords.countPhrase(rows.count, "post"), sub: "Newest first.", flush: true) {
      if loading {
        RowSkeleton(rows: 6)
      } else if !visible.isEmpty {
        let now = SyncStatus.now()
        VStack(alignment: .leading, spacing: 0) {
          ForEach(visible, id: \.self) { row in
            postRow(row, now: now)
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("posted-list")
      } else {
        EmptyState(
          !query.isEmpty || filter != "all"
            ? "Nothing matches. Clear the search or choose All." : "Nothing posted yet. New post starts one."
        )
        .padding(.top, theme.space4)
      }
      if !loading && (rows.count > shown || (!built && feedCursor != nil)) {
        foot(rows: rows, visible: visible)
      }
      if !caps.canSchedule {
        Text("Putting a post on a timer needs a long session. Settings › Account offers one.")
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: theme.measure, alignment: .leading)
          .padding(.top, theme.points(ThemeKit.cardCaptionSpaceAbove))
      }
    }
  }

  private func foot(rows: [JSONValue], visible: [JSONValue]) -> some View {
    // "30 of 1,031" only when that is the whole of it: before the archive
    // is built, Bluesky has more than the list knows of.
    let knownTotal = built || feedCursor == nil
    let more = rows.count > shown
    let label =
      loadingMore
      ? "Loading…"
      : more ? "Show \(AppLocale.formatNumber(min(Measure.Hub.postedStep, rows.count - shown))) more" : "Show more"
    return SectionFoot(count: knownTotal ? "\(AppLocale.formatNumber(visible.count)) of \(AppLocale.formatNumber(rows.count))" : nil) {
      Button(label) {
        if more { shown += Measure.Hub.postedStep } else { Task { await loadMoreFeed() } }
      }
      .buttonStyle(.virga(.ghost, size: .small))
      .disabled(loadingMore)
      .accessibilityIdentifier("posted-more")
    }
  }

  private func postRow(_ row: JSONValue, now: Double) -> some View {
    let uri = row["uri"]?.stringValue ?? ""
    let busy = working != nil && working == uri
    let date = Time.formatDateShort(row["at"]?.stringValue ?? "")
    let unsynced = row["fresh"]?.isTruthy == true && built
    return HubCornerRow(
      words: HubPostWords(row: row, did: did, now: now, extra: unsynced ? "Not in the archive yet" : nil),
      button: Optional<EmptyView>.none,
      menu: AnyView(DraftsRowMenu(label: "More for the post from \(date)", entries: menuEntries(row), working: busy))
    )
    .opacity(busy ? Measure.Hub.busyOpacity : 1)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("posted-row")
  }

  // MARK: The ⋯

  /// Everything a post can do, in the order a person reaches for it: answer
  /// it, post it again, change who can answer, then keep or look at it, and
  /// deleting it last.
  private func menuEntries(_ row: JSONValue) -> [MenuEntry] {
    let offer = PostedModel.postRowActions(row, canPost: caps.canPost, canSchedule: caps.canSchedule)
    let did = self.did
    var items: [MenuEntry] = []
    if offer.reply {
      items.append(
        .item(MenuItem("Reply", key: "reply", systemImage: HubGlyph.reply) {
          act(row, "The post couldn’t be read.") { post, _ in
            openComposer(["asDid": did.map(JSONValue.string) ?? .null, "reply": ["uri": .string(post.uri)]])
          }
        }))
    }
    if offer.quote {
      items.append(
        .item(MenuItem("Quote", key: "quote", systemImage: HubGlyph.quote) {
          act(row, "The post couldn’t be read.") { post, _ in
            openComposer(["asDid": did.map(JSONValue.string) ?? .null, "quote": ["uri": .string(post.uri)]])
          }
        }))
    }
    if offer.again {
      items.append(
        .item(
          MenuItem(
            "Post again", key: "again", hint: "Opens it as a new post, to change, post, schedule or queue", systemImage: HubGlyph.again,
            accessibilityIdentifier: "posted-again"
          ) {
            act(row, "The post couldn’t be read.") { post, _ in await postAgain(post) }
          }))
    }
    if offer.gates {
      items.append(
        .item(MenuItem(offer.gatesQuotesOnly ? "Who can quote" : "Who can reply and quote", key: "gates", systemImage: HubGlyph.gates) {
          act(row, "Its settings couldn’t be read.") { post, agent in
            let value = try await PostedModel.readPostGates(post.uri, agent: agent)
            gates = PostedGatesState(post: post, value: value, quotesOnly: PostedModel.gatesQuotesOnlyFor(offer, post.record))
          }
        }))
    }
    if offer.timer {
      items.append(
        .item(
          MenuItem(
            "Put on a timer", key: "timer", hint: "Delete it after a while, or when something happens", systemImage: HubGlyph.timer,
            accessibilityIdentifier: "posted-timer"
          ) {
            act(row, "The post couldn’t be read.") { post, _ in
              let createdAt = post.record["createdAt"].flatMap { $0.isTruthy ? $0.stringValue : nil }
              timer = PostTimerTarget(
                uri: post.uri, cid: post.cid.stringValue, text: post.record["text"]?.stringValue ?? "",
                postedAt: createdAt ?? row["at"]?.stringValue, reply: post.record["reply"]?.isTruthy ?? false)
            }
          }))
    }
    if offer.template {
      items.append(
        .item(MenuItem("Save as a template", key: "template", systemImage: HubGlyph.template) {
          act(row, "The post couldn’t be read.") { post, _ in
            let from = PostedModel.templateSeedFrom(post.record)
            let embed = from["embed"].flatMap { $0.isNull ? nil : $0 }
            seed = PostedTemplateSeed(seed: TemplateSeed(text: from["text"]?.stringValue ?? "", embed: embed))
          }
        }))
    }
    items.append(
      .item(MenuItem("Open on Bluesky", key: "open", systemImage: HubGlyph.external) {
        if let link = PostLink.bskyUrlFor(row["uri"]?.stringValue), let url = URL(string: link) { openURL(url) }
      }))
    if offer.delete {
      items.append(.separator)
      items.append(
        .item(MenuItem("Delete", key: "delete", systemImage: HubGlyph.trash, destructive: true, accessibilityIdentifier: "posted-delete") {
          deleting = row
        }))
    }
    return items
  }

  private func openComposer(_ intent: JSONValue) {
    if let composer { composer.open(intent) } else { navigate("/posting/compose") }
  }

  /// `actionError(err, what)`.
  private func actionError(_ error: any Error, _ what: String) -> String {
    if PostingPages.code(error) == "GONE" { return PostingPages.message(error) }
    if Scopes.isMissingScopeError(error) { return "Virga needs permission to do that. Sign in again to grant it." }
    let message = PostingPages.message(error)
    return "\(what) \(message.isEmpty ? "Try again." : message)"
  }

  /// Every action reads the post as it is now before acting on it.
  private func act(
    _ row: JSONValue, _ what: String, _ fn: @escaping @MainActor (PostNow, XRPCAgent) async throws -> Void
  ) {
    guard working == nil, let did, let uri = row["uri"]?.stringValue else { return }
    working = uri
    error = nil
    let transport = app.archiveEnvironment.transport
    Task {
      defer { working = nil }
      do {
        let agent = try await app.session.agentFor(did)
        let post = try await PostedModel.readPostNow(uri, agent: agent, transport: transport)
        try await fn(post, agent)
      } catch {
        if PostingPages.code(error) == "GONE" { removed.append(.string(uri)) }
        self.error = actionError(error, what)
      }
    }
  }

  /// The post as a new one in the composer: its words, links, tags,
  /// languages and quote or link card, and its pictures read back from the
  /// repo.
  private func postAgain(_ post: PostNow) async {
    guard let did else { return }
    let seed = PostedModel.postAgainSeed(post.record)
    var fetched = PostedImages(files: [], missing: 0)
    if !seed.images.isEmpty && !seed.labelled {
      let target = try? await app.session.targetFor(did)
      fetched = await PostedModel.fetchPostImages(
        seed.images, did: did, pdsUrl: target?.pdsUrl, transport: app.archiveEnvironment.transport, files: TemporaryComposerFiles())
    }
    let out = PostedModel.postAgainIntent(seed, did: did, files: fetched.files, missing: fetched.missing)
    guard let intent = out.intent else {
      error = "This post is only pictures or video, and they couldn’t be fetched. Start a new post and add them again."
      return
    }
    openComposer(intent)
    if !out.notes.isEmpty { toasts?.push(out.notes.joined(separator: " "), seconds: 10) }
  }

  private func confirmDelete(_ row: JSONValue) async throws {
    guard let did, let uri = row["uri"]?.stringValue else { return }
    let agent = try await app.session.agentFor(did)
    do {
      _ = try await PostedModel.readPostNow(uri, agent: agent, transport: app.archiveEnvironment.transport)
    } catch {
      if PostingPages.code(error) != "GONE" { throw PostingPagesError(actionError(error, "The post couldn’t be read.")) }
    }
    do {
      try await PostedModel.deletePost(uri, agent: agent)
    } catch {
      throw PostingPagesError(actionError(error, "The post couldn’t be deleted."))
    }
    removed.append(.string(uri))
    _ = try? PostingEvents.emitPostsChanged(did, removed: [.string(uri)])
    toasts?.push("Post deleted.")
  }

  /// The next page of the author feed, before the archive is built.
  private func loadMoreFeed() async {
    guard let did, let cursor = feedCursor else { return }
    loadingMore = true
    defer { loadingMore = false }
    do {
      let page = try await PostingPages.authorFeed(
        did, limit: Measure.Hub.postedFeedPage, cursor: cursor, transport: app.archiveEnvironment.transport)
      moreRows += page.rows
      moreCursor = page.cursor.flatMap { $0 == cursor ? nil : $0 } ?? ""
    } catch {
      self.error = "Older posts couldn’t be read from Bluesky. Try again."
    }
  }
}

// MARK: - Who can reply and quote

/// Posted's `GatesDialog`: who can reply to and quote a post that's out; a
/// reply's quoting only (who can reply is set on the thread's first post).
struct PostedGatesDialog: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  let state: PostedGatesState
  let did: String
  let onClose: () -> Void
  let onSaved: () -> Void
  @State private var reply: [JSONValue]?
  @State private var quotes = true
  @State private var ready = false
  @State private var busy = false
  @State private var error = ""

  var body: some View {
    DialogFrame(title: state.quotesOnly ? "Who can quote this reply" : "Who can reply and quote", onClose: { if !busy { onClose() } }) {
      VStack(alignment: .leading, spacing: Measure.Hub.confirmGap) {
        let text = state.post.record["text"]?.stringValue ?? ""
        if !text.isEmpty { HubQuote(text: text.jsSlice(0, Measure.Hub.scheduleQuoteMax)) }
        if ready {
          if state.quotesOnly {
            Toggle("Allow quote posts", isOn: $quotes)
              .toggleStyle(.virgaCheck)
              .disabled(busy)
            FieldHint("Who can reply is set on the post that starts the thread.")
          } else {
            GatesEditor(did: did, reply: $reply, quotes: $quotes, transport: app.archiveEnvironment.transport)
              .disabled(busy)
          }
        }
        FieldHint("Changing who can quote doesn’t remove quotes already made.")
        if !error.isEmpty { Callout(tone: .danger) { Text(error) } }
      }
    } actions: {
      Button("Cancel", action: onClose)
        .buttonStyle(.virga)
        .disabled(busy)
      Button(busy ? "Saving…" : "Save") { Task { await save() } }
        .buttonStyle(.virga(.primary))
        .disabled(busy || !ready)
        .accessibilityIdentifier("posted-gates-save")
    }
    .interactiveDismissDisabled(busy)
    .onAppear {
      reply = state.value.json["reply"]?.arrayValue
      quotes = state.value.quotes
      error = ""
      ready = true
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("posted-gates-dialog")
  }

  private func save() async {
    busy = true
    error = ""
    defer { busy = false }
    do {
      let agent = try await app.session.agentFor(did)
      let kept: JSONValue? = state.quotesOnly ? state.value.json["reply"] : reply.map(JSONValue.array) ?? .null
      try await Gates.updatePostGates(agent.gatesAgent, uri: state.post.uri, reply: kept, quotes: quotes)
      onSaved()
      onClose()
    } catch {
      if Scopes.isMissingScopeError(error) {
        self.error = "Virga needs permission to do that. Sign in again to grant it."
      } else {
        let message = PostingPages.message(error)
        self.error = "The settings couldn’t be saved. \(message.isEmpty ? "Try again." : message)"
      }
    }
  }
}
#endif
